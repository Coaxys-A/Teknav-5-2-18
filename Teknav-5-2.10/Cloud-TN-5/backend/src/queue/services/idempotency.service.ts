import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { QueueConfigService } from '../queue-config.service';

/**
 * Idempotency Service
 * M11 - Queue Platform: "Idempotency + Dedupe"
 *
 * Features:
 * - Idempotency keys with TTL (24h)
 * - Store jobId + status for each key
 * - Return existing job if key exists and not terminal
 * - Allow new job if replay allowed
 */

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly IDEM_PREFIX = 'teknav:idem';
  private readonly DEDUPE_PREFIX = 'teknav:dedupe';
  private readonly DEFAULT_TTL = 24 * 60 * 60; // 24h
  private readonly SHORT_TTL = 2 * 60; // 2 min

  constructor(
    private readonly redis: Redis,
    private readonly queueConfig: QueueConfigService,
  ) {}

  /**
   * Check idempotency key and return existing job if exists
   */
  async checkOrCreate(
    idempotencyKey: string,
    createJobFn: () => Promise<string>, // Function to create job if needed
    options: {
      allowReplay?: boolean;
      ttl?: number;
    } = {},
  ): Promise<{ jobId: string; isNew: boolean }> {
    const key = `${this.IDEM_PREFIX}:${idempotencyKey}`;
    const ttl = options.ttl || this.DEFAULT_TTL;

    // Check if key exists
    const existing = await this.redis.get(key);

    if (existing) {
      const data = JSON.parse(existing as string);

      // If job is terminal (completed/cancelled) and replay not allowed, return existing
      if (!options.allowReplay && this.isTerminal(data.status)) {
        this.logger.log(`Idempotency hit: ${idempotencyKey} (status: ${data.status})`);
        return { jobId: data.jobId, isNew: false };
      }

      // If replay allowed or job not terminal, create new job
      this.logger.log(`Idempotency replay allowed: ${idempotencyKey}`);
    }

    // Create new job
    const jobId = await createJobFn();

    // Store idempotency key
    await this.redis.set(
      key,
      JSON.stringify({ jobId, status: 'waiting', createdAt: new Date().toISOString() }),
      'EX',
      ttl,
    );

    return { jobId, isNew: true };
  }

  /**
   * Update job status for idempotency key
   */
  async updateStatus(idempotencyKey: string, status: string): Promise<void> {
    const key = `${this.IDEM_PREFIX}:${idempotencyKey}`;
    const existing = await this.redis.get(key);

    if (existing) {
      const data = JSON.parse(existing as string);
      data.status = status;
      data.updatedAt = new Date().toISOString();

      await this.redis.set(key, JSON.stringify(data), 'EX', this.DEFAULT_TTL);
    }
  }

  /**
   * Get job data for idempotency key
   */
  async getJob(idempotencyKey: string): Promise<any> {
    const key = `${this.IDEM_PREFIX}:${idempotencyKey}`;
    const data = await this.redis.get(key);

    return data ? JSON.parse(data as string) : null;
  }

  /**
   * Check dedupe key for short-window spam prevention
   */
  async checkDedupe(
    jobType: string,
    entityKey: string,
    windowSeconds: number = 60,
  ): Promise<{ deduped: boolean; existingJobId?: string }> {
    const key = `${this.DEDUPE_PREFIX}:${jobType}:${entityKey}`;

    // Check if key exists
    const existing = await this.redis.get(key);

    if (existing) {
      this.logger.log(`Dedupe hit: ${jobType}:${entityKey}`);
      return { deduped: true, existingJobId: existing };
    }

    // Set dedupe key with short TTL
    await this.redis.set(key, '1', 'EX', windowSeconds);

    return { deduped: false };
  }

  /**
   * Check if status is terminal
   */
  private isTerminal(status: string): boolean {
    return ['completed', 'cancelled', 'moved_to_dlq'].includes(status);
  }
}
