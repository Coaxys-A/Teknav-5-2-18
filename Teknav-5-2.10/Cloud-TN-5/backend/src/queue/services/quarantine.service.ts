import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Quarantine Service
 * M11 - Queue Platform: "Quarantine Lane (Innovation)"
 *
 * Features:
 * - Redis sorted set for suspicious jobs
 * - Triggers: repeated error signatures, large payloads, suspicious patterns
 * - Actions: promote to DLQ, retry anyway, delete
 * - Quarantine reasons: REPEATED_FAILURE, SUSPICIOUS_PAYLOAD, SIGNATURE_MISMATCH, RATE_ABUSE
 */

export enum QuarantineReason {
  REPEATED_FAILURE = 'repeated_failure',
  SUSPICIOUS_PAYLOAD = 'suspicious_payload',
  SIGNATURE_MISMATCH = 'signature_mismatch',
  RATE_ABUSE = 'rate_abuse',
  POISON_PILL = 'poison_pill',
}

export interface QuarantinedJob {
  jobType: string;
  jobId: string;
  aiJobId?: number;
  reason: QuarantineReason;
  errorMessage: string;
  failedAt: string;
  attempts: number;
  payload?: any;
}

@Injectable()
export class QuarantineService {
  private readonly logger = new Logger(QuarantineService.name);
  private readonly QUARANTINE_PREFIX = 'teknav:quarantine';
  private readonly ERROR_SIGNATURE_WINDOW = 5 * 60 * 1000; // 5 minutes
  private readonly ERROR_SIGNATURE_THRESHOLD = 3; // 3 same errors in 5 mins = quarantine
  private readonly PAYLOAD_SIZE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  constructor(private readonly redis: Redis) {}

  /**
   * Check if job should be quarantined
   */
  async shouldQuarantine(job: {
    jobType: string;
    jobId: string;
    attempts: number;
    error: Error;
    payload?: any;
  }): Promise<{ quarantine: boolean; reason?: QuarantineReason }> {
    const { jobType, jobId, attempts, error, payload } = job;

    // Check 1: Repeated failure signature
    const repeated = await this.checkRepeatedFailure(jobType, error);
    if (repeated) {
      return { quarantine: true, reason: QuarantineReason.REPEATED_FAILURE };
    }

    // Check 2: Suspicious payload size
    if (payload) {
      const payloadSize = JSON.stringify(payload).length;
      if (payloadSize > this.PAYLOAD_SIZE_THRESHOLD) {
        this.logger.warn(`Payload too large for job ${jobId}: ${payloadSize} bytes`);
        return { quarantine: true, reason: QuarantineReason.SUSPICIOUS_PAYLOAD };
      }
    }

    // Check 3: Poison pill errors (from ErrorClassifier)
    const isPoison = await this.isPoisonPill(error);
    if (isPoison) {
      return { quarantine: true, reason: QuarantineReason.POISON_PILL };
    }

    // Check 4: Rate abuse (too many failures from same entity)
    const abused = await this.checkRateAbuse(jobType, payload);
    if (abused) {
      return { quarantine: true, reason: QuarantineReason.RATE_ABUSE };
    }

    return { quarantine: false };
  }

  /**
   * Add job to quarantine
   */
  async addJob(
    jobType: string,
    jobId: string,
    reason: QuarantineReason,
    error: Error,
    attempts: number,
    payload?: any,
  ): Promise<void> {
    const key = `${this.QUARANTINE_PREFIX}:${jobType}`;
    const score = Date.now();

    const quarantinedJob: QuarantinedJob = {
      jobType,
      jobId,
      reason,
      errorMessage: error.message,
      failedAt: new Date().toISOString(),
      attempts,
      payload: payload ? this.sanitizePayload(payload) : undefined,
    };

    // Add to sorted set (score = timestamp)
    await this.redis.zadd(key, score, JSON.stringify(quarantinedJob));

    // Set TTL (30 days)
    await this.redis.expire(key, 30 * 24 * 60 * 60);

    this.logger.warn(`Job quarantined: ${jobId} (${reason})`);

    // Publish event
    await this.publishQuarantineEvent('QUARANTINED', quarantinedJob);
  }

  /**
   * Get quarantined jobs for queue
   */
  async getQuarantinedJobs(jobType: string, limit: number = 50): Promise<QuarantinedJob[]> {
    const key = `${this.QUARANTINE_PREFIX}:${jobType}`;

    // Get jobs with highest scores (most recent)
    const jobs = await this.redis.zrange(key, 0, limit - 1, 'REV');

    return jobs.map(job => JSON.parse(job));
  }

  /**
   * Remove job from quarantine
   */
  async removeJob(jobType: string, jobId: string): Promise<void> {
    const key = `${this.QUARANTINE_PREFIX}:${jobType}`;
    const jobs = await this.getQuarantinedJobs(jobType, 1000);

    // Find and remove job
    for (const job of jobs) {
      if (job.jobId === jobId) {
        await this.redis.zrem(key, JSON.stringify(job));
        this.logger.log(`Job removed from quarantine: ${jobId}`);
        return;
      }
    }
  }

  /**
   * Promote job to DLQ (retry from quarantine)
   */
  async promoteToDlq(jobType: string, jobId: string, aiJobId: number, actorId?: number): Promise<void> {
    // Remove from quarantine
    await this.removeJob(jobType, jobId);

    // Add to DLQ (this is done by the caller usually, but we log it)
    this.logger.log(`Job promoted to DLQ from quarantine: ${jobId}`);

    // Publish event
    await this.publishQuarantineEvent('PROMOTED_TO_DLQ', { jobType, jobId, aiJobId, actorId });
  }

  /**
   * Delete quarantined job
   */
  async deleteJob(jobType: string, jobId: string): Promise<void> {
    await this.removeJob(jobType, jobId);
    this.logger.log(`Quarantined job deleted: ${jobId}`);

    // Publish event
    await this.publishQuarantineEvent('DELETED', { jobType, jobId });
  }

  /**
   * Clear quarantine for queue (admin action)
   */
  async clearQuarantine(jobType: string): Promise<void> {
    const key = `${this.QUARANTINE_PREFIX}:${jobType}`;
    await this.redis.del(key);
    this.logger.log(`Quarantine cleared for queue: ${jobType}`);

    // Publish event
    await this.publishQuarantineEvent('CLEARED', { jobType });
  }

  /**
   * Get quarantine stats
   */
  async getStats(jobType: string): Promise<{ total: number; byReason: Record<QuarantineReason, number> }> {
    const key = `${this.QUARANTINE_PREFIX}:${jobType}`;
    const jobs = await this.getQuarantinedJobs(jobType, 1000);

    const byReason: Record<QuarantineReason, number> = {
      [QuarantineReason.REPEATED_FAILURE]: 0,
      [QuarantineReason.SUSPICIOUS_PAYLOAD]: 0,
      [QuarantineReason.SIGNATURE_MISMATCH]: 0,
      [QuarantineReason.RATE_ABUSE]: 0,
      [QuarantineReason.POISON_PILL]: 0,
    };

    for (const job of jobs) {
      byReason[job.reason]++;
    }

    return {
      total: jobs.length,
      byReason,
    };
  }

  /**
   * Check for repeated failure signature
   */
  private async checkRepeatedFailure(jobType: string, error: Error): Promise<boolean> {
    const signature = this.getErrorSignature(error);
    const key = `teknav:error_signature:${jobType}:${signature}`;

    // Increment counter
    const count = await this.redis.incr(key);

    // Set expiry
    await this.redis.expire(key, this.ERROR_SIGNATURE_WINDOW / 1000);

    // Check threshold
    if (count >= this.ERROR_SIGNATURE_THRESHOLD) {
      this.logger.warn(`Repeated error signature detected: ${signature} (${count} times)`);
      return true;
    }

    return false;
  }

  /**
   * Get error signature for deduplication
   */
  private getErrorSignature(error: Error): string {
    // Combine error name, message, and stack trace hash
    const name = error.name;
    const message = error.message.substring(0, 100); // First 100 chars
    const stackTrace = error.stack ? error.stack.substring(0, 200) : '';

    // Simple hash
    return `${name}:${message}:${stackTrace}`;
  }

  /**
   * Check if error is a poison pill
   */
  private async isPoisonPill(error: Error): Promise<boolean> {
    const poisonPatterns = [
      /poison/i,
      /corrupted/i,
      /malformed/i,
      /unexpected/i,
      /EPARSE/,
      /EBADMSG/,
      /EMSGSIZE/,
    ];

    return poisonPatterns.some(pattern => pattern.test(error.message || ''));
  }

  /**
   * Check for rate abuse
   */
  private async checkRateAbuse(jobType: string, payload?: any): Promise<boolean> {
    if (!payload) return false;

    const entityId = payload.entity?.id;
    if (!entityId) return false;

    const key = `teknav:rate_abuse:${jobType}:${entityId}`;

    // Increment counter
    const count = await this.redis.incr(key);

    // Set expiry (5 minutes)
    await this.redis.expire(key, 300);

    // Threshold: 10 failures in 5 minutes for same entity
    if (count >= 10) {
      this.logger.warn(`Rate abuse detected: ${jobType}:${entityId} (${count} times)`);
      return true;
    }

    return false;
  }

  /**
   * Sanitize payload for storage
   */
  private sanitizePayload(payload: any): any {
    // Remove sensitive fields
    const sanitized = { ...payload };

    // Remove passwords, tokens, etc.
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.apiKey;
    delete sanitized.accessToken;
    delete sanitized.refreshToken;

    // Truncate large arrays/objects
    const jsonString = JSON.stringify(sanitized);
    if (jsonString.length > 10000) {
      return {
        _truncated: true,
        _originalSize: jsonString.length,
        preview: jsonString.substring(0, 500) + '...',
      };
    }

    return sanitized;
  }

  /**
   * Publish quarantine event
   */
  private async publishQuarantineEvent(eventType: string, data: any): Promise<void> {
    const event = {
      id: `quarantine-${Date.now()}-${Math.random()}`,
      type: `quarantine.${eventType}`,
      timestamp: new Date().toISOString(),
      data,
    };

    await this.redis.publish('teknav:queue:events', JSON.stringify(event));
  }
}
