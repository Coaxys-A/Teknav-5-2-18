import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bull';
import { Logger } from '@nestjs/common';

/**
 * Queue Registry Service
 *
 * Central access point for all BullMQ queue instances.
 * Provides helper methods to enqueue jobs with stats tracking.
 */

export const QUEUES = {
  AI_CONTENT: 'ai-content',
  AI_SEO: 'ai-seo',
  AI_TRANSLATION: 'ai-translation',
  WORKFLOW_EXECUTION: 'workflow-execution',
  PLUGIN_EXECUTION: 'plugin-execution',
  ANALYTICS_PROCESSING: 'analytics-processing',
  EMAIL_NOTIFICATION: 'email-notification',
  BILLING_EVENTS: 'billing-events',
  MEDIA_PROCESSING: 'media-processing',
} as const;

@Injectable()
export class QueueRegistryService implements OnModuleInit {
  private readonly logger = new Logger(QueueRegistryService.name);

  @Inject(getQueueToken(QUEUES.AI_CONTENT)) private readonly aiContentQueue: any;
  @Inject(getQueueToken(QUEUES.AI_SEO)) private readonly aiSeoQueue: any;
  @Inject(getQueueToken(QUEUES.AI_TRANSLATION)) private readonly aiTranslationQueue: any;
  @Inject(getQueueToken(QUEUES.WORKFLOW_EXECUTION)) private readonly workflowExecutionQueue: any;
  @Inject(getQueueToken(QUEUES.PLUGIN_EXECUTION)) private readonly pluginExecutionQueue: any;
  @Inject(getQueueToken(QUEUES.ANALYTICS_PROCESSING)) private readonly analyticsQueue: any;
  @Inject(getQueueToken(QUEUES.EMAIL_NOTIFICATION)) private readonly emailQueue: any;
  @Inject(getQueueToken(QUEUES.BILLING_EVENTS)) private readonly billingQueue: any;
  @Inject(getQueueToken(QUEUES.MEDIA_PROCESSING)) private readonly mediaQueue: any;

  onModuleInit() {
    this.logger.log('Queue Registry initialized');
  }

  /**
   * Add Job (Generic)
   */
  async add(queueName: string, name: string, data: any, opts?: any) {
    let queue: any;

    switch (queueName) {
      case QUEUES.AI_CONTENT: queue = this.aiContentQueue; break;
      case QUEUES.AI_SEO: queue = this.aiSeoQueue; break;
      case QUEUES.AI_TRANSLATION: queue = this.aiTranslationQueue; break;
      case QUEUES.WORKFLOW_EXECUTION: queue = this.workflowExecutionQueue; break;
      case QUEUES.PLUGIN_EXECUTION: queue = this.pluginExecutionQueue; break;
      case QUEUES.ANALYTICS_PROCESSING: queue = this.analyticsQueue; break;
      case QUEUES.EMAIL_NOTIFICATION: queue = this.emailQueue; break;
      case QUEUES.BILLING_EVENTS: queue = this.billingQueue; break;
      case QUEUES.MEDIA_PROCESSING: queue = this.mediaQueue; break;
      default: throw new Error(`Unknown queue: ${queueName}`);
    }

    const job = await queue.add(name, data, opts);

    this.logger.log(`Enqueued job ${job.id} to ${queueName}`);
    return job;
  }

  /**
   * Get Queue Instance
   * Used by DLQ/Stats services.
   */
  getQueue(queueName: string): any {
    switch (queueName) {
      case QUEUES.AI_CONTENT: return this.aiContentQueue;
      case QUEUES.AI_SEO: return this.aiSeoQueue;
      case QUEUES.AI_TRANSLATION: return this.aiTranslationQueue;
      case QUEUES.WORKFLOW_EXECUTION: return this.workflowExecutionQueue;
      case QUEUES.PLUGIN_EXECUTION: return this.pluginExecutionQueue;
      case QUEUES.ANALYTICS_PROCESSING: return this.analyticsQueue;
      case QUEUES.EMAIL_NOTIFICATION: return this.emailQueue;
      case QUEUES.BILLING_EVENTS: return this.billingQueue;
      case QUEUES.MEDIA_PROCESSING: return this.mediaQueue;
      default: throw new Error(`Unknown queue: ${queueName}`);
    }
  }

  /**
   * Get Queue Stats
   */
  async getStats(queueName: string) {
    const queue = this.getQueue(queueName);

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Get All Stats
   */
  async getAllStats() {
    const stats = await Promise.all([
      this.getStats(QUEUES.AI_CONTENT),
      this.getStats(QUEUES.AI_SEO),
      this.getStats(QUEUES.AI_TRANSLATION),
      this.getStats(QUEUES.WORKFLOW_EXECUTION),
      this.getStats(QUEUES.PLUGIN_EXECUTION),
      this.getStats(QUEUES.ANALYTICS_PROCESSING),
      this.getStats(QUEUES.EMAIL_NOTIFICATION),
      this.getStats(QUEUES.BILLING_EVENTS),
      this.getStats(QUEUES.MEDIA_PROCESSING),
    ]);
    return stats;
  }
}
