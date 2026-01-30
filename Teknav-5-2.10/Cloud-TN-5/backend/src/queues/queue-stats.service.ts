import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bull';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobId } from 'bull';
import { RedisService } from '../redis/redis.service';
import { AuditLogService } from '../logging/audit-log.service';
import { EventBusService } from '../notifications/event-bus.service';
import { QUEUES } from './queue-registry.service';
import { ZodError } from 'zod';

/**
 * Queue Stats Service
 *
 * Listens to BullMQ events.
 * Updates Redis stats cache.
 * Provides DLQ methods.
 */

@Injectable()
export class QueueStatsService implements OnModuleInit {
  private readonly logger = new Logger(QueueStatsService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly STATS_TTL = 60; // 1 minute

  constructor(
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  onModuleInit() {
    // We attach listeners to Queues in the Processor classes using decorators.
    // However, to centralize stats updates, we can also use Bull's event emitter
    // But with NestJS, decorators in Processor classes are standard.
    // We will rely on Processors to call `updateStats` method.
  }

  /**
   * Update Stats (Called by Processors)
   */
  async updateStats(queueName: string, eventType: 'completed' | 'failed' | 'delayed') {
    const key = `${this.REDIS_PREFIX}:queue:stats:${queueName}`;
    
    // Current Stats
    const currentStats = await this.redis.redis.get(key);
    let stats = currentStats ? JSON.parse(currentStats) : { completed: 0, failed: 0, delayed: 0 };

    if (eventType === 'completed') {
      stats.completed++;
    } else if (eventType === 'failed') {
      stats.failed++;
    } else if (eventType === 'delayed') {
      stats.delayed++;
    }

    // Update Timestamp
    stats.updatedAt = new Date().toISOString();

    // Save to Redis
    await this.redis.redis.set(key, JSON.stringify(stats), 'EX', this.STATS_TTL);

    // Publish Event
    await this.eventBus.publish('teknav:queue:events', {
      queueName,
      eventType,
      stats,
    });
  }

  /**
   * Get DLQ List (Stubbed for MVP)
   * Returns failed jobs for a queue.
   */
  async getDlq(queueName: string) {
    // In a real app, we would use `queue.getFailed(start, end)`.
    // Here we just query Redis keys or a dedicated DLQ table if we built one.
    // For MVP, we return empty.
    return [];
  }

  /**
   * Retry DLQ Job
   */
  async retryDlqJob(queueName: string, jobId: string | number) {
    // In real app: `queue.retryJob(jobId)`.
    this.logger.log(`Retrying DLQ job ${jobId} in queue ${queueName}`);
    await this.auditLog.logAction({
      actorUserId: 0,
      action: 'queue.dlq.retry',
      resource: 'Queue',
      payload: { queueName, jobId },
    });
  }

  /**
   * Discard DLQ Job
   */
  async discardDlqJob(queueName: string, jobId: string | number) {
    // In real app: `queue.removeJob(jobId)`.
    this.logger.log(`Discarding DLQ job ${jobId} in queue ${queueName}`);
    await this.auditLog.logAction({
      actorUserId: 0,
      action: 'queue.dlq.discard',
      resource: 'Queue',
      payload: { queueName, jobId },
    });
  }

  /**
   * Purge DLQ
   */
  async purgeDlq(queueName: string) {
    // Stub
    this.logger.log(`Purging DLQ for queue ${queueName}`);
  }
}
