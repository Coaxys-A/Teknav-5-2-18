import { Injectable } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BaseConsumer } from '../services/base-consumer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService } from '../services/queue-events.service';
import { CircuitBreakerService, Dependency } from '../services/circuit-breaker.service';
import { QuarantineService } from '../services/quarantine.service';
import { JobSlaService } from '../services/job-sla.service';
import { JobType } from '../types/job-envelope';

/**
 * OTP Consumer
 * M11 - Queue Platform: "OTP Jobs Processing"
 *
 * Processes:
 * - OTP send (email, SMS)
 * - OTP verification
 * - OTP retry with backoff
 */

@Injectable()
export class OtpConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.OTP_PROVIDER, Dependency.REDIS];

  constructor(
    auditLog: AuditLogService,
    prisma: PrismaService,
    queueConfig: QueueConfigService,
    queueEvents: QueueEventsService,
    circuitBreaker: CircuitBreakerService,
    quarantine: QuarantineService,
    jobSla: JobSlaService,
  ) {
    super(
      JobType.OTP_SEND,
      auditLog,
      prisma,
      queueConfig,
      queueEvents,
      circuitBreaker,
      quarantine,
      jobSla,
    );
  }

  /**
   * Process OTP Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { userId, otpType, channel, reason } = meta;

    this.logger.log(`Processing OTP job: ${aiJobId} (user: ${userId}, type: ${otpType})`);

    // 1. Validate inputs
    if (!userId || !otpType || !channel) {
      throw new Error('Missing required fields: userId, otpType, channel');
    }

    // 2. Get user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true,
      },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // 3. Check recent OTP sends (rate limit)
    await this.checkOtpRateLimit(userId, otpType);

    // 4. Generate OTP code
    const otpCode = await this.generateOtpCode();

    // 5. Hash OTP for storage
    const otpHash = await this.hashOtpCode(otpCode, userId);

    // 6. Store OTP record
    const otpRecord = await this.prisma.otpRecord.create({
      data: {
        userId,
        type: otpType,
        channel, // EMAIL, SMS, WHATSAPP
        codeHash: otpHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
        attempts: 0,
        maxAttempts: 5,
        reason,
        createdAt: new Date(),
      },
    });

    // 7. Send OTP via channel (Circuit Breaker protected)
    const sendResult = await this.sendOtpViaChannel({
      userId,
      otpType,
      channel,
      otpCode,
      user,
    });

    // 8. Update OTP record
    await this.prisma.otpRecord.update({
      where: { id: otpRecord.id },
      data: {
        status: sendResult.success ? 'SENT' : 'FAILED',
        sentAt: new Date(),
        deliveredAt: sendResult.success ? new Date() : null,
        errorMessage: sendResult.success ? null : sendResult.error,
      },
    });

    // 9. Log OTP send event
    await this.auditLog.logAction({
      actorUserId: actorId || null,
      action: 'otp.sent',
      resource: 'OtpRecord',
      payload: {
        otpId: otpRecord.id,
        userId,
        channel,
        type: otpType,
        reason,
      },
    });

    // 10. Publish OTP sent event
    await this.queueEvents.jobCompleted({
      queueName: job.queueQualifiedName,
      jobType: JobType.OTP_SEND,
      aiJobId,
      bullJobId: job.id,
      traceId,
      entity: { type: 'User', id: userId },
      metadata: { otpId: otpRecord.id, channel, sendResult },
    });

    this.logger.log(`OTP job completed: ${aiJobId} (user: ${userId}, channel: ${channel})`);

    return {
      success: sendResult.success,
      otpId: otpRecord.id,
      channel,
      deliveryStatus: sendResult.success ? 'DELIVERED' : 'FAILED',
      expiresAt: otpRecord.expiresAt,
    };
  }

  /**
   * Check OTP rate limit (prevent abuse)
   */
  private async checkOtpRateLimit(userId: number, otpType: string): Promise<void> {
    const rateLimitKey = `teknav:otp:rate_limit:${userId}:${otpType}`;
    const windowSeconds = 60; // 1 minute window

    const currentCount = await this.prisma.redis?.incr(rateLimitKey) || 1;

    if (currentCount === 1) {
      // First request in window, set expiry
      await this.prisma.redis?.expire(rateLimitKey, windowSeconds);
    }

    const maxAttemptsPerMinute = 3; // Max 3 OTPs per minute

    if (currentCount > maxAttemptsPerMinute) {
      throw new Error('OTP rate limit exceeded. Please try again later.');
    }
  }

  /**
   * Generate OTP code
   */
  private async generateOtpCode(): Promise<string> {
    // In production, use secure random number generator
    // For MVP, we'll generate a 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    return code;
  }

  /**
   * Hash OTP code
   */
  private async hashOtpCode(otpCode: string, userId: number): Promise<string> {
    // In production, use bcrypt or similar
    // For MVP, we'll use simple hash
    const hash = require('crypto').createHash('sha256');
    hash.update(`${otpCode}:${userId}:${process.env.OTP_SALT || 'default-salt'}`);
    return hash.digest('hex');
  }

  /**
   * Send OTP via channel (simulated - would use SendGrid/Twilio/etc.)
   */
  private async sendOtpViaChannel(params: {
    userId: number;
    otpType: string;
    channel: string;
    otpCode: string;
    user: any;
  }): Promise<{ success: boolean; provider: string; messageId?: string; error?: string }> {
    const { channel, otpCode, user, otpType } = params;

    switch (channel) {
      case 'EMAIL':
        return await this.sendOtpEmail(user, otpCode, otpType);
      case 'SMS':
        return await this.sendOtpSms(user, otpCode, otpType);
      case 'WHATSAPP':
        return await this.sendOtpWhatsapp(user, otpCode, otpType);
      default:
        throw new Error(`Unknown OTP channel: ${channel}`);
    }
  }

  /**
   * Send OTP via email (SendGrid)
   */
  private async sendOtpEmail(user: any, otpCode: string, otpType: string): Promise<any> {
    // In production, use SendGrid/AWS SES/etc.
    // For MVP, we'll simulate success

    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

    return {
      success: true,
      provider: 'sendgrid',
      messageId: `email-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    };
  }

  /**
   * Send OTP via SMS (Twilio)
   */
  private async sendOtpSms(user: any, otpCode: string, otpType: string): Promise<any> {
    // In production, use Twilio/AWS SNS/etc.
    // For MVP, we'll simulate success

    await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay

    return {
      success: true,
      provider: 'twilio',
      messageId: `sms-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    };
  }

  /**
   * Send OTP via WhatsApp
   */
  private async sendOtpWhatsapp(user: any, otpCode: string, otpType: string): Promise<any> {
    // In production, use WhatsApp Business API
    // For MVP, we'll simulate success

    await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5s delay

    return {
      success: true,
      provider: 'whatsapp',
      messageId: `wa-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    };
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.OTP_PROVIDER) {
      return {
        failureThreshold: 10,
        resetTimeout: 180000, // 3 minutes
        halfOpenMaxCalls: 5,
      };
    }
    return {};
  }
}
