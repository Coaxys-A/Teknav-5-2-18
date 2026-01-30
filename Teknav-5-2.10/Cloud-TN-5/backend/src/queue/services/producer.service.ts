import { Injectable, Logger } from '@nestjs/common';
import { QueueConfigService } from '../queue-config.service';
import { JobType, JobEnvelopeCreate, JobPriority } from '../types/job-envelope';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { QueueEventsService } from './queue-events.service';
import { ErrorClassifier } from './error-classifier.service';

/**
 * Producer Service (Base)
 * M11 - Queue Platform: "Producers (Real Integrations)"
 *
 * Features:
 * - Enqueue jobs with idempotency check
 * - Dedupe prevention
 * - AiJob record creation
 * - Queue events publishing
 * - RBAC enforcement
 * - Trace ID propagation
 */

@Injectable()
export class ProducerService {
  private readonly logger = new Logger(ProducerService.name);

  constructor(
    private readonly queueConfig: QueueConfigService,
    private readonly auditLog: AuditLogService,
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly queueEvents: QueueEventsService,
  ) {}

  /**
   * Enqueue job (general method)
   */
  async enqueueJob<T extends JobEnvelopeCreate>(
    jobType: JobType,
    envelope: T,
    options: {
      dedupeWindowSeconds?: number;
      delay?: number;
      priority?: JobPriority;
    } = {},
  ): Promise<{ aiJobId: number; bullJobId: string; isNew: boolean }> {
    const { idempotencyKey, traceId, actorId, tenantId, workspaceId } = envelope;

    this.logger.debug(`Enqueuing job: ${jobType} (idempotency: ${idempotencyKey}, trace: ${traceId})`);

    // 1. Check short-window dedupe (spam prevention)
    if (options.dedupeWindowSeconds) {
      const entityKey = `${envelope.entity.type}:${envelope.entity.id}`;
      const deduped = await this.idempotency.checkDedupe(
        jobType,
        entityKey,
        options.dedupeWindowSeconds,
      );

      if (deduped.deduped) {
        this.logger.warn(`Job deduped: ${jobType} (entity: ${entityKey})`);
        throw new Error(`Job deduped: recent duplicate job exists`);
      }
    }

    // 2. Create AiJob record
    const aiJob = await this.prisma.aiJob.create({
      data: {
        type: jobType,
        status: 'WAITING',
        queue: this.queueConfig.getQueuePrefix(),
        attempts: 0,
        maxAttempts: 5,
        priority: options.priority || JobPriority.NORMAL,
        scheduledFor: options.delay ? new Date(Date.now() + options.delay) : null,
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
        cost: 0,
        task: envelope as any, // Store envelope in task relation (if available)
      },
    });

    // 3. Enqueue with idempotency check
    const { jobId: bullJobId, isNew } = await this.idempotency.checkOrCreate(
      idempotencyKey,
      async () => {
        const queue = this.queueConfig.getQueue(jobType);

        // Add job to BullMQ
        const job = await queue.add(
          `${jobType}-${aiJob.id}`,
          {
            ...envelope,
            aiJobId: aiJob.id,
            traceId: traceId || this.generateTraceId(),
            createdAt: new Date().toISOString(),
          },
          {
            jobId: `${jobType}-${aiJob.id}-${Date.now()}`,
            delay: options.delay || 0,
            priority: options.priority || JobPriority.NORMAL,
          },
        );

        return job.id;
      },
    );

    // 4. Store mapping in Redis
    await this.storeJobMapping(aiJob.id, bullJobId, idempotencyKey);

    // 5. Log enqueue event
    await this.auditLog.logAction({
      actorUserId: actorId || null,
      action: 'queue.job.enqueued',
      resource: `Job:${jobType}`,
      payload: {
        aiJobId: aiJob.id,
        bullJobId,
        jobType,
        idempotencyKey,
        traceId,
        tenantId,
        workspaceId,
        entity: envelope.entity,
      },
    });

    // 6. Publish queue event
    await this.queueEvents.jobEnqueued({
      queueName: this.queueConfig.getQueueName(jobType),
      jobType,
      aiJobId: aiJob.id,
      bullJobId,
      traceId: traceId || this.generateTraceId(),
      entity: envelope.entity,
      actorId,
      tenantId,
      workspaceId,
    });

    this.logger.log(`Job enqueued: ${jobType} (aiJobId: ${aiJob.id}, bullJobId: ${bullJobId})`);

    return {
      aiJobId: aiJob.id,
      bullJobId,
      isNew,
    };
  }

  /**
   * Get job mapping (AiJob ID <-> BullJob ID)
   */
  async getJobMapping(aiJobId: number): Promise<{ bullJobId: string; idempotencyKey: string } | null> {
    const mappingKey = `teknav:jobmapping:${aiJobId}`;
    const mapping = await this.prisma.redis?.get(mappingKey);

    return mapping ? JSON.parse(mapping) : null;
  }

  /**
   * Store job mapping in Redis
   */
  private async storeJobMapping(aiJobId: number, bullJobId: string, idempotencyKey: string): Promise<void> {
    const mappingKey = `teknav:jobmapping:${aiJobId}`;
    const mapping = { bullJobId, idempotencyKey, aiJobId };

    await this.prisma.redis?.set(mappingKey, JSON.stringify(mapping), 'EX', 7 * 24 * 60 * 60); // 7 days
  }

  /**
   * Generate trace ID
   */
  private generateTraceId(): string {
    return `trace-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Get queue name from job type
   */
  private getQueueName(jobType: JobType): string {
    return `${this.queueConfig.getQueuePrefix()}:${jobType}`;
  }
}
