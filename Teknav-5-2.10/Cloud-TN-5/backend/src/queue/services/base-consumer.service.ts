import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService, QueueEventType } from './queue-events.service';
import { ErrorClassifier, ErrorClass } from './error-classifier.service';
import { CircuitBreakerService, Dependency } from './circuit-breaker.service';
import { QuarantineService, QuarantineReason } from './quarantine.service';
import { JobSlaService } from './job-sla.service';
import { JobType } from '../types/job-envelope';

/**
 * Consumer Service (Base Template)
 * M11 - Queue Platform: "Consumers (Full Coverage)"
 *
 * Features:
 * - Job processing with error classification
 * - Smart retry with backoff strategies
 * - DLQ routing for poison/repeated failures
 * - Circuit breaker protection
 * - Quarantine lane for suspicious jobs
 * - SLA monitoring
 * - Progress updates
 * - Audit logging
 */

@Injectable()
export abstract class BaseConsumer {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly errorClassifier = new ErrorClassifier();
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [];

  constructor(
    protected readonly jobType: JobType,
    protected readonly auditLog: AuditLogService,
    protected readonly prisma: PrismaService,
    protected readonly queueConfig: QueueConfigService,
    protected readonly queueEvents: QueueEventsService,
    protected readonly circuitBreaker: CircuitBreakerService,
    protected readonly quarantine: QuarantineService,
    protected readonly jobSla: JobSlaService,
  ) {}

  /**
   * Process job (main entry point - to be implemented by subclasses)
   */
  protected abstract process(job: Job<any>): Promise<any>;

  /**
   * Get circuit breaker dependencies for this consumer
   */
  protected getDependencies(): Dependency[] {
    return this.DEFAULT_DEPENDENCIES;
  }

  /**
   * Get circuit breaker config (override if needed)
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    return {}; // Use defaults
  }

  /**
   * BullMQ processor
   */
  @Process({ name: '*', concurrency: 5 })
  async handleJob(job: Job<any>): Promise<void> {
    const { aiJobId, traceId, entity, jobType } = job.data;

    this.logger.debug(`Processing job: ${job.id} (aiJobId: ${aiJobId}, trace: ${traceId})`);

    // 1. Update AiJob status to ACTIVE
    await this.updateJobStatus(aiJobId, 'ACTIVE');

    // 2. Publish job started event
    await this.queueEvents.jobStarted({
      queueName: job.queueQualifiedName,
      jobType,
      aiJobId,
      bullJobId: job.id,
      traceId,
    });

    // 3. Record start time for SLA
    const startedAt = new Date();

    try {
      // 4. Execute job processing
      const result = await this.executeJob(job);

      // 5. Check SLA
      const finishedAt = new Date();
      await this.jobSla.checkSla(aiJobId, jobType, job.queueQualifiedName, startedAt, finishedAt);

      // 6. Update AiJob status to COMPLETED
      await this.updateJobStatus(aiJobId, 'COMPLETED', finishedAt, null);

      // 7. Publish job completed event
      await this.queueEvents.jobCompleted({
        queueName: job.queueQualifiedName,
        jobType,
        aiJobId,
        bullJobId: job.id,
        traceId,
        entity,
        metadata: { result },
      });

      this.logger.log(`Job completed: ${job.id} (aiJobId: ${aiJobId})`);
    } catch (error: any) {
      const finishedAt = new Date();

      // Check SLA
      await this.jobSla.checkSla(aiJobId, jobType, job.queueQualifiedName, startedAt, finishedAt);

      // Classify error
      const classification = this.errorClassifier.classify(error);
      const attemptsMade = job.attemptsMade || 0;

      this.logger.error(`Job failed: ${job.id} (aiJobId: ${aiJobId}, error: ${classification.message}, class: ${classification.class})`);

      // Update AiJob status to FAILED
      await this.updateJobStatus(aiJobId, 'FAILED', finishedAt, error.message);

      // Publish job failed event
      await this.queueEvents.jobFailed({
        queueName: job.queueQualifiedName,
        jobType,
        aiJobId,
        bullJobId: job.id,
        traceId,
        errorSummary: error.message,
        attemptsMade,
      });

      // Check if should move to DLQ immediately
      if (classification.moveToDlq) {
        await this.moveToDlq(job, error, classification);
        return; // Don't throw, move to DLQ is handled
      }

      // Check if should retry
      if (classification.shouldRetry) {
        // Calculate delay
        const delay = this.errorClassifier.calculateDelay(classification, attemptsMade);

        this.logger.log(`Retrying job: ${job.id} (attempt ${attemptsMade}, delay: ${delay}ms)`);

        // Publish retry event
        await this.queueEvents.jobRetried({
          queueName: job.queueQualifiedName,
          jobType,
          aiJobId,
          bullJobId: job.id,
          traceId,
          attemptsMade,
          retryDelay: delay,
        });

        // Retry (throw error with delay - BullMQ handles this)
        throw error;
      }

      // No retry - move to DLQ
      await this.moveToDlq(job, error, classification);
    }
  }

  /**
   * Execute job with circuit breaker protection
   */
  private async executeJob(job: Job<any>): Promise<any> {
    const dependencies = this.getDependencies();

    for (const dep of dependencies) {
      const config = this.getCircuitBreakerConfig(dep);

      const { success, result, error } = await this.circuitBreaker.execute(
        dep,
        () => this.process(job),
        config,
      );

      if (!success) {
        this.logger.error(`Circuit breaker blocked execution for ${dep}`);
        throw error || new Error(`Circuit blocked: ${dep}`);
      }

      return result;
    }

    // No dependencies - execute directly
    return await this.process(job);
  }

  /**
   * On Queue Active (job picked up by worker)
   */
  @OnQueueActive()
  async onActive(job: Job<any>): Promise<void> {
    this.logger.debug(`Job active: ${job.id} (worker: ${process.pid})`);

    // Record worker heartbeat
    await this.recordWorkerHeartbeat(job.queueQualifiedName);
  }

  /**
   * On Queue Completed (job finished successfully)
   */
  @OnQueueCompleted()
  async onCompleted(job: Job<any>, result: any): Promise<void> {
    this.logger.debug(`Job completed: ${job.id}`);
  }

  /**
   * On Queue Failed (job failed after all retries)
   */
  @OnQueueFailed()
  async onFailed(job: Job<any>, error: Error): Promise<void> {
    this.logger.debug(`Job failed (final): ${job.id} (error: ${error.message})`);

    // Check if should quarantine
    const { aiJobId, jobType } = job.data;
    const { quarantine } = await this.quarantine.shouldQuarantine({
      jobType,
      jobId: job.id,
      attempts: job.attemptsMade || 0,
      error,
    });

    if (quarantine) {
      await this.quarantine.addJob(
        jobType,
        job.id,
        quarantine.reason,
        error,
        job.attemptsMade || 0,
        job.data,
      );

      this.logger.warn(`Job quarantined: ${job.id} (${quarantine.reason})`);
    }
  }

  /**
   * Update job status in AiJob
   */
  private async updateJobStatus(
    aiJobId: number,
    status: string,
    finishedAt?: Date,
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.aiJob.update({
      where: { id: aiJobId },
      data: {
        status,
        finishedAt: finishedAt || null,
        errorMessage: errorMessage || null,
      },
    });
  }

  /**
   * Move job to DLQ
   */
  private async moveToDlq(
    job: Job<any>,
    error: Error,
    classification: any,
  ): Promise<void> {
    const dlq = this.queueConfig.getDlq(this.jobType);

    // Add to DLQ
    const dlqJob = {
      ...job.data,
      originalJobId: job.id,
      originalQueue: job.queueQualifiedName,
      attemptsMade: job.attemptsMade || 0,
      failedAt: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        code: (error as any).code,
        stack: error.stack,
      },
    };

    await dlq.add(`${this.jobType}-dlq`, dlqJob);

    // Update AiJob status
    await this.updateJobStatus(job.data.aiJobId, 'MOVED_TO_DLQ', new Date(), classification.message);

    // Publish moved to DLQ event
    await this.queueEvents.jobMovedToDlq({
      queueName: job.queueQualifiedName,
      jobType: this.jobType,
      aiJobId: job.data.aiJobId,
      bullJobId: job.id,
      traceId: job.data.traceId,
      attemptsMade: job.attemptsMade || 0,
      errorSummary: classification.message,
    });

    // Audit log
    await this.auditLog.logAction({
      actorUserId: job.data.actorId || null,
      action: 'queue.job.moved_to_dlq',
      resource: `Job:${this.jobType}`,
      payload: {
        aiJobId: job.data.aiJobId,
        bullJobId: job.id,
        error: classification.message,
        classification: classification.class,
      },
    });

    this.logger.warn(`Job moved to DLQ: ${job.id}`);
  }

  /**
   * Record worker heartbeat
   */
  private async recordWorkerHeartbeat(queueName: string): Promise<void> {
    const workerId = `worker-${process.pid}`;
    const heartbeatKey = `teknav:worker:${queueName}:${workerId}`;

    await this.prisma.redis?.set(heartbeatKey, JSON.stringify({
      pid: process.pid,
      queue: queueName,
      lastSeen: new Date().toISOString(),
    }), 'EX', 60); // 1 minute TTL
  }

  /**
   * Update job progress (for long-running jobs)
   */
  protected async updateProgress(
    aiJobId: number,
    current: number,
    total: number,
  ): Promise<void> {
    // Publish progress event
    await this.queueEvents.jobProgress({
      queueName: this.queueConfig.getQueueName(this.jobType),
      jobType: this.jobType,
      aiJobId,
      bullJobId: '', // Not available in this context
      progress: { current, total },
    });

    // Update AiJob metadata (if needed)
    await this.prisma.aiJob.update({
      where: { id: aiJobId },
      data: {
        task: {
          progress: { current, total, percentage: Math.round((current / total) * 100) },
        },
      } as any,
    });
  }
}
