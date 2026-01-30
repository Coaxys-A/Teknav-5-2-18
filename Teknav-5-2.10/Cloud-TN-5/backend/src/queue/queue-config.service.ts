import { Queue, Worker, Job, QueueScheduler } from 'bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { JobType, JobPriority, JobStatus } from '../types/job-envelope';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * BullMQ Queue Configuration
 * M11 - Queue Platform: "Full Consumers + DLQ + Replay UI"
 */

@Injectable()
export class QueueConfigService implements OnModuleInit {
  private readonly QUEUE_PREFIX = 'teknav:queue';
  private readonly DLQ_PREFIX = 'teknav:dlq';

  private queues: Map<JobType, Queue> = new Map();
  private dlqs: Map<JobType, Queue> = new Map();
  private workers: Map<JobType, Worker> = new Map();

  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit() {
    await this.initializeQueues();
    await this.logQueueInitialization();
  }

  /**
   * Initialize all BullMQ queues and DLQs
   */
  private async initializeQueues() {
    const queueNames = Object.values(JobType);

    for (const jobType of queueNames) {
      const queueName = `${this.QUEUE_PREFIX}:${jobType}`;
      const dlqName = `${this.DLQ_PREFIX}:${jobType}`;

      // Create main queue
      const queue = new Queue(queueName, {
        connection: this.redis,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: {
            count: 1000,
            age: 7 * 24 * 60 * 60, // 7 days
          },
          removeOnFail: {
            count: 5000,
            age: 30 * 24 * 60 * 60, // 30 days
          },
        },
      });

      // Create DLQ
      const dlq = new Queue(dlqName, {
        connection: this.redis,
      });

      this.queues.set(jobType, queue);
      this.dlqs.set(jobType, dlq);

      // Error handler to move failed jobs to DLQ
      await queue.add('global:failed', this.handleJobFailed.bind(this, jobType, dlq));
    }
  }

  /**
   * Handle job failure - move to DLQ if attempts exceeded
   */
  private async handleJobFailed(
    jobType: JobType,
    dlq: Queue,
    job: Job,
    error: Error,
  ) {
    const attemptsMade = job.attemptsMade || 0;
    const maxAttempts = job.opts.attempts || 5;

    if (attemptsMade >= maxAttempts) {
      // Move to DLQ
      const dlqJob = {
        ...job.data,
        originalJobId: job.id,
        originalQueue: job.queueQualifiedName,
        attemptsMade,
        failedAt: new Date().toISOString(),
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      };

      await dlq.add(`${jobType}-failed`, dlqJob);

      // Log to AuditLog
      await this.auditLog.logAction({
        actorUserId: job.data.actorId || null,
        action: 'queue.job.moved_to_dlq',
        resource: `Job:${jobType}`,
        payload: {
          jobId: job.id,
          queue: job.queueQualifiedName,
          attempts: attemptsMade,
          error: error.message,
        },
      });
    }
  }

  /**
   * Get queue instance by job type
   */
  getQueue(jobType: JobType): Queue {
    const queue = this.queues.get(jobType);
    if (!queue) {
      throw new Error(`Queue not found for job type: ${jobType}`);
    }
    return queue;
  }

  /**
   * Get DLQ instance by job type
   */
  getDlq(jobType: JobType): Queue {
    const dlq = this.dlqs.get(jobType);
    if (!dlq) {
      throw new Error(`DLQ not found for job type: ${jobType}`);
    }
    return dlq;
  }

  /**
   * Get queue name prefix
   */
  getQueuePrefix(): string {
    return this.QUEUE_PREFIX;
  }

  /**
   * Get DLQ name prefix
   */
  getDlqPrefix(): string {
    return this.DLQ_PREFIX;
  }

  /**
   * Log queue initialization
   */
  private async logQueueInitialization() {
    await this.auditLog.logAction({
      actorUserId: null,
      action: 'queue.initialized',
      resource: 'QueuePlatform',
      payload: {
        queues: Object.keys(this.queues),
        dlqs: Object.keys(this.dlqs),
        prefix: this.QUEUE_PREFIX,
      },
    });
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy() {
    const closingPromises: Promise<void>[] = [];

    this.workers.forEach((worker) => {
      closingPromises.push(worker.close());
    });

    this.queues.forEach((queue) => {
      closingPromises.push(queue.close());
    });

    this.dlqs.forEach((dlq) => {
      closingPromises.push(dlq.close());
    });

    await Promise.all(closingPromises);
  }
}
