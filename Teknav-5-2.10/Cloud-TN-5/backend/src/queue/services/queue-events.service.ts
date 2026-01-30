import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Realtime Queue Events Service
 * M11 - Queue Platform: "Realtime Queue Events + SSE"
 *
 * Features:
 * - Redis Pub/Sub for queue state transitions
 * - Publish events for every job state change
 * - SSE endpoint support for Owner Observatory
 * - Event types: JOB_ENQUEUED, JOB_STARTED, JOB_COMPLETED, JOB_FAILED, JOB_RETRIED, JOB_MOVED_TO_DLQ, JOB_REPLAYED, JOB_CANCELLED, QUEUE_PAUSED, QUEUE_RESUMED
 */

export enum QueueEventType {
  JOB_ENQUEUED = 'job.enqueued',
  JOB_STARTED = 'job.started',
  JOB_COMPLETED = 'job.completed',
  JOB_FAILED = 'job.failed',
  JOB_RETRIED = 'job.retried',
  JOB_MOVED_TO_DLQ = 'job.moved_to_dlq',
  JOB_REPLAYED = 'job.replayed',
  JOB_CANCELLED = 'job.cancelled',
  JOB_PROGRESS = 'job.progress',
  QUEUE_PAUSED = 'queue.paused',
  QUEUE_RESUMED = 'queue.resumed',
  WORKER_ADDED = 'worker.added',
  WORKER_REMOVED = 'worker.removed',
  CIRCUIT_OPENED = 'circuit.opened',
  CIRCUIT_CLOSED = 'circuit.closed',
  QUARANTINED = 'job.quarantined',
}

export interface QueueEvent {
  id: string;
  type: string;
  timestamp: string;
  queueName?: string;
  jobType?: string;
  aiJobId?: number;
  bullJobId?: string;
  status?: string;
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
  traceId?: string;
  entity?: {
    type: string;
    id: string | number;
  };
  actorId?: number;
  tenantId?: number;
  workspaceId?: number;
  errorSummary?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class QueueEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueEventsService.name);
  private readonly CHANNEL = 'teknav:queue:events';
  private readonly PUB_SUB_PREFIX = 'teknav:ps';

  private publisher: Redis;
  private subscribers: Map<string, Redis> = new Map();

  constructor(private readonly redis: Redis) {
    // Create separate connection for pub/sub
    this.publisher = redis.duplicate();
    this.subscribers.set('main', redis.duplicate());
  }

  async onModuleInit() {
    // Subscribe to channel
    await this.subscribe('main');
  }

  /**
   * Publish queue event
   */
  async publish(event: Partial<QueueEvent>): Promise<void> {
    const fullEvent: QueueEvent = {
      id: this.generateEventId(),
      type: event.type,
      timestamp: new Date().toISOString(),
      queueName: event.queueName,
      jobType: event.jobType,
      aiJobId: event.aiJobId,
      bullJobId: event.bullJobId,
      status: event.status,
      progress: event.progress,
      traceId: event.traceId,
      entity: event.entity,
      actorId: event.actorId,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      errorSummary: event.errorSummary,
      metadata: event.metadata,
    };

    try {
      await this.publisher.publish(this.CHANNEL, JSON.stringify(fullEvent));
      this.logger.debug(`Published queue event: ${fullEvent.type}`);
    } catch (error: any) {
      this.logger.error('Failed to publish queue event', error);
    }
  }

  /**
   * Subscribe to queue events (for SSE server)
   */
  async subscribe(subscriberId: string = 'main', callback?: (event: QueueEvent) => void): Promise<void> {
    const redis = this.subscribers.get(subscriberId);

    if (!redis) {
      this.logger.error(`Subscriber not found: ${subscriberId}`);
      return;
    }

    try {
      await redis.subscribe(this.CHANNEL, (message: string) => {
        try {
          const event: QueueEvent = JSON.parse(message);

          if (callback) {
            callback(event);
          }
        } catch (error: any) {
          this.logger.error('Failed to parse queue event', error);
        }
      });

      this.logger.debug(`Subscribed to queue events: ${subscriberId}`);
    } catch (error: any) {
      this.logger.error('Failed to subscribe to queue events', error);
    }
  }

  /**
   * Unsubscribe from queue events
   */
  async unsubscribe(subscriberId: string): Promise<void> {
    const redis = this.subscribers.get(subscriberId);

    if (redis) {
      try {
        await redis.unsubscribe(this.CHANNEL);
        this.subscribers.delete(subscriberId);
        this.logger.debug(`Unsubscribed from queue events: ${subscriberId}`);
      } catch (error: any) {
        this.logger.error('Failed to unsubscribe from queue events', error);
      }
    }
  }

  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `evt-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  // ========================================================================
  // CONVENIENCE METHODS FOR SPECIFIC EVENT TYPES
  // ========================================================================

  /**
   * Job Enqueued Event
   */
  async jobEnqueued(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    entity: { type: string; id: string | number };
    actorId?: number;
    tenantId?: number;
    workspaceId?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_ENQUEUED,
      ...params,
    });
  }

  /**
   * Job Started Event
   */
  async jobStarted(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_STARTED,
      ...params,
    });
  }

  /**
   * Job Completed Event
   */
  async jobCompleted(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    entity: { type: string; id: string | number };
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_COMPLETED,
      ...params,
    });
  }

  /**
   * Job Failed Event
   */
  async jobFailed(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    errorSummary: string;
    attemptsMade: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_FAILED,
      ...params,
      metadata: { attemptsMade, ...params.metadata },
    });
  }

  /**
   * Job Retried Event
   */
  async jobRetried(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    attemptsMade: number;
    retryDelay: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_RETRIED,
      ...params,
      metadata: { attemptsMade, retryDelay, ...params.metadata },
    });
  }

  /**
   * Job Moved to DLQ Event
   */
  async jobMovedToDlq(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    attemptsMade: number;
    errorSummary: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_MOVED_TO_DLQ,
      ...params,
      metadata: { attemptsMade, ...params.metadata },
    });
  }

  /**
   * Job Replayed Event
   */
  async jobReplayed(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    oldBullJobId: string;
    newBullJobId: string;
    traceId: string;
    actorId?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_REPLAYED,
      ...params,
    });
  }

  /**
   * Job Cancelled Event
   */
  async jobCancelled(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    traceId: string;
    actorId: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_CANCELLED,
      ...params,
    });
  }

  /**
   * Job Progress Event
   */
  async jobProgress(params: {
    queueName: string;
    jobType: string;
    aiJobId: number;
    bullJobId: string;
    progress: { current: number; total: number };
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.JOB_PROGRESS,
      ...params,
      progress: {
        ...params.progress,
        percentage: Math.round((params.progress.current / params.progress.total) * 100),
      },
    });
  }

  /**
   * Queue Paused Event
   */
  async queuePaused(params: {
    queueName: string;
    actorId: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.QUEUE_PAUSED,
      ...params,
    });
  }

  /**
   * Queue Resumed Event
   */
  async queueResumed(params: {
    queueName: string;
    actorId: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.QUEUE_RESUMED,
      ...params,
    });
  }

  /**
   * Worker Added Event
   */
  async workerAdded(params: {
    queueName: string;
    workerId: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.WORKER_ADDED,
      ...params,
    });
  }

  /**
   * Worker Removed Event
   */
  async workerRemoved(params: {
    queueName: string;
    workerId: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.WORKER_REMOVED,
      ...params,
    });
  }

  /**
   * Circuit Opened Event
   */
  async circuitOpened(params: {
    dependency: string;
    failures: number;
    errorSummary: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.CIRCUIT_OPENED,
      ...params,
    });
  }

  /**
   * Circuit Closed Event
   */
  async circuitClosed(params: {
    dependency: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.CIRCUIT_CLOSED,
      ...params,
    });
  }

  /**
   * Job Quarantined Event
   */
  async jobQuarantined(params: {
    queueName: string;
    jobType: string;
    jobId: string;
    reason: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish({
      type: QueueEventType.QUARANTINED,
      ...params,
    });
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy() {
    this.logger.log('Unsubscribing from queue events...');

    for (const [subscriberId, redis] of this.subscribers.entries()) {
      try {
        await redis.unsubscribe(this.CHANNEL);
        await redis.quit();
      } catch (error: any) {
        this.logger.error(`Failed to close subscriber ${subscriberId}`, error);
      }
    }

    this.subscribers.clear();

    if (this.publisher) {
      try {
        await this.publisher.quit();
      } catch (error: any) {
        this.logger.error('Failed to close publisher', error);
      }
    }
  }
}
