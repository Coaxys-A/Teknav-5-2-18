import { Injectable, BadRequestException } from '@nestjs/common';
import { QueueRegistryService, QUEUES } from './queue-registry.service';
import { AuditLogService } from '../logging/audit-log.service';
import { EventBusService } from '../notifications/event-bus.service';
import { ZodError } from 'zod';
import * as Schemas from './dto/job-schemas';

/**
 * Queue Producer Service
 *
 * Centralized methods to enqueue jobs.
 * Enforces:
 * - Zod Validation
 * - RBAC (via Guard in Controller)
 * - Audit Logs
 * - Publish Pub/Sub Events
 */

@Injectable()
export class QueueProducerService {
  constructor(
    private readonly registry: QueueRegistryService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * AI Content
   */
  async enqueueAiContent(actor: any, data: Schemas.AiContentJob) {
    const jobData = Schemas.AiContentJobSchema.parse(data);
    
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.ai.content.enqueue',
      resource: 'Queue',
      payload: jobData,
    });

    const job = await this.registry.add(QUEUES.AI_CONTENT, 'ai-content', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      timeout: 120000, // 2 mins
    });

    await this.publishQueueEvent(QUEUES.AI_CONTENT, job.id, 'job.enqueued', jobData);
    return job;
  }

  /**
   * AI SEO
   */
  async enqueueAiSeo(actor: any, data: Schemas.AiSeoJob) {
    const jobData = Schemas.AiSeoJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.AI_SEO, 'ai-seo', jobData);
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.ai.seo.enqueue',
      resource: 'Queue',
      payload: jobData,
    });
    await this.publishQueueEvent(QUEUES.AI_SEO, job.id, 'job.enqueued', jobData);
    return job;
  }

  /**
   * AI Translation
   */
  async enqueueAiTranslation(actor: any, data: Schemas.AiTranslationJob) {
    const jobData = Schemas.AiTranslationJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.AI_TRANSLATION, 'ai-translation', jobData);
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.ai.translation.enqueue',
      resource: 'Queue',
      payload: jobData,
    });
    await this.publishQueueEvent(QUEUES.AI_TRANSLATION, job.id, 'job.enqueued', jobData);
    return job;
  }

  /**
   * Workflow Execution
   */
  async enqueueWorkflow(actor: any, data: Schemas.WorkflowJob) {
    const jobData = Schemas.WorkflowJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.WORKFLOW_EXECUTION, 'workflow-execution', jobData, {
      attempts: 2, // Retry once if transient failure
      removeOnComplete: 500, // Keep history
      removeOnFail: 500,
    });
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.workflow.enqueue',
      resource: 'Queue',
      payload: jobData,
    });
    await this.publishQueueEvent(QUEUES.WORKFLOW_EXECUTION, job.id, 'job.enqueued', jobData);
    return job;
  }

  /**
   * Plugin Execution
   */
  async enqueuePlugin(actor: any, data: Schemas.PluginJob) {
    const jobData = Schemas.PluginJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.PLUGIN_EXECUTION, 'plugin-execution', jobData, {
      attempts: 1, // Plugins usually fail fast; 1 retry enough
      timeout: 300000, // 5 mins sandbox timeout
    });
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.plugin.enqueue',
      resource: 'Queue',
      payload: jobData,
    });
    await this.publishQueueEvent(QUEUES.PLUGIN_EXECUTION, job.id, 'job.enqueued', jobData);
    return job;
  }

  /**
   * Analytics Processing
   */
  async enqueueAnalytics(actor: any, data: Schemas.AnalyticsJob) {
    const jobData = Schemas.AnalyticsJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.ANALYTICS_PROCESSING, 'analytics-processing', jobData);
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.analytics.enqueue',
      resource: 'Queue',
      payload: { eventBatchId: jobData.eventBatchId, count: jobData.events.length },
    });
    return job;
  }

  /**
   * Email Notification
   */
  async enqueueEmail(actor: any, data: Schemas.EmailJob) {
    const jobData = Schemas.EmailJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.EMAIL_NOTIFICATION, 'email-notification', jobData, {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
    });
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.email.enqueue',
      resource: 'Queue',
      payload: { templateKey: jobData.templateKey, to: jobData.to },
    });
    return job;
  }

  /**
   * Billing Events
   */
  async enqueueBilling(actor: any, data: Schemas.BillingJob) {
    const jobData = Schemas.BillingJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.BILLING_EVENTS, 'billing-events', jobData, {
      attempts: 3,
      removeOnComplete: 1000, // Keep billing events longer
    });
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.billing.enqueue',
      resource: 'Queue',
      payload: jobData,
    });
    await this.publishQueueEvent(QUEUES.BILLING_EVENTS, job.id, 'job.enqueued', jobData);
    return job;
  }

  /**
   * Media Processing
   */
  async enqueueMedia(actor: any, data: Schemas.MediaJob) {
    const jobData = Schemas.MediaJobSchema.parse(data);
    
    const job = await this.registry.add(QUEUES.MEDIA_PROCESSING, 'media-processing', jobData, {
      attempts: 2,
      timeout: 300000, // 5 mins
    });
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'queue.media.enqueue',
      resource: 'Queue',
      payload: jobData,
    });
    return job;
  }

  private async publishQueueEvent(queueName: string, jobId: number, type: string, payload: any) {
    await this.eventBus.publish('teknav:queue:events', {
      id: `${queueName}-${jobId}`,
      type,
      queueName,
      jobId,
      timestamp: new Date(),
      payload,
    });
  }
}
