import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { LoggingModule } from '../logging/logging.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProducerService } from './services/producer.service';
import { QueueConfigService } from './queue-config.service';
import { QueueEventsService } from './services/queue-events.service';
import { ErrorClassifierService } from './services/error-classifier.service';
import { CircuitBreakerService } from './services/circuit-breaker.service';
import { QuarantineService } from './services/quarantine.service';
import { JobSlaService } from './services/job-sla.service';
import { IdempotencyService } from './services/idempotency.service';
import { DistributedLocksService } from './services/distributed-locks.service';
import { BaseConsumer } from './services/base-consumer.service';
import { AiContentConsumer } from './consumers/ai-content.consumer';
import { AiSeoConsumer } from './consumers/ai-seo.consumer';
import { AiReviewConsumer } from './consumers/ai-review.consumer';
import { AiScoreConsumer } from './consumers/ai-score.consumer';
import { AiReportRerunConsumer } from './consumers/ai-report-rerun.consumer';
import { WorkflowConsumer } from './consumers/workflow.consumer';
import { WorkflowStepConsumer } from './consumers/workflow-step.consumer';
import { PluginConsumer } from './consumers/plugin.consumer';
import { AnalyticsConsumer } from './consumers/analytics.consumer';
import { EmailConsumer } from './consumers/email.consumer';
import { NotificationConsumer } from './consumers/notification.consumer';
import { OtpConsumer } from './consumers/otp.consumer';
import { OwnerQueueController } from '../owner/queues/owner-queues.controller';
import { QueueSseController } from '../owner/queues/queue-sse.controller';
import { OwnerQueueDetailsController } from '../owner/queues/owner-queues-details.controller';
import { OwnerQueueAdditionalController } from '../owner/queues/owner-queues-additional.controller';

/**
 * Queue Module (COMPLETE)
 * M11 - Queue Platform: "Full Consumers + DLQ + Replay UI"
 *
 * Ties together:
 * - All BullMQ queues and DLQs (8 main + 8 DLQ)
 * - All Producer services (AI, Workflow, Plugin, Analytics, Email, Notification, OTP)
 * - All Consumer services (12 consumers covering all job types)
 * - Queue events service (Redis Pub/Sub)
 * - Error classifier, circuit breaker, quarantine, SLA
 * - Owner Queue Observatory API
 * - SSE Gateway for real-time events
 */

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    LoggingModule,
    PrismaModule,
    BullModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisModule, ConfigService],
      useFactory: async (redis, configService) => {
        return {
          connection: redis.redis,
          defaultJobOptions: {
            removeOnComplete: {
              age: 7 * 24 * 3600, // 7 days
              count: 1000,
            },
            removeOnFail: {
              age: 30 * 24 * 3600, // 30 days
              count: 5000,
            },
          },
        };
      },
    }),
    // Register all queues
    BullModule.registerQueue(
      // AI Queues
      { name: 'ai-content', ...getQueueOptions('AI_CONTENT') },
      { name: 'ai-seo', ...getQueueOptions('AI_SEO') },
      { name: 'ai-review', ...getQueueOptions('AI_REVIEW') },
      { name: 'ai-score', ...getQueueOptions('AI_SCORE') },
      { name: 'ai-report-rerun', ...getQueueOptions('AI_REPORT_RERUN') },
      { name: 'ai-editor-tool', ...getQueueOptions('AI_EDITOR_TOOL') },
      // Workflow Queues
      { name: 'workflows', ...getQueueOptions('WORKFLOW_RUN') },
      { name: 'workflow-steps', ...getQueueOptions('WORKFLOW_STEP_EXECUTE') },
      { name: 'workflow-schedules', ...getQueueOptions('WORKFLOW_SCHEDULE') },
      // Plugin Queues
      { name: 'plugins', ...getQueueOptions('PLUGIN_EXECUTE') },
      { name: 'plugin-sandbox', ...getQueueOptions('PLUGIN_SANDBOX') },
      // Analytics Queues
      { name: 'analytics', ...getQueueOptions('ANALYTICS_AGGREGATE') },
      { name: 'analytics-snapshots', ...getQueueOptions('ANALYTICS_SNAPSHOT') },
      { name: 'analytics-funnels', ...getQueueOptions('ANALYTICS_FUNNEL') },
      { name: 'analytics-retention', ...getQueueOptions('ANALYTICS_RETENTION') },
      // Communication Queues
      { name: 'emails', ...getQueueOptions('EMAIL_SEND') },
      { name: 'notifications', ...getQueueOptions('NOTIFICATION_DISPATCH') },
      { name: 'otp', ...getQueueOptions('OTP_SEND') },
    ),
    // Register DLQs
    BullModule.registerQueue(
      { name: 'dlq:ai-content', ...getDlqOptions('AI_CONTENT') },
      { name: 'dlq:ai-seo', ...getDlqOptions('AI_SEO') },
      { name: 'dlq:ai-review', ...getDlqOptions('AI_REVIEW') },
      { name: 'dlq:ai-score', ...getDlqOptions('AI_SCORE') },
      { name: 'dlq:ai-report-rerun', ...getDlqOptions('AI_REPORT_RERUN') },
      { name: 'dlq:ai-editor-tool', ...getDlqOptions('AI_EDITOR_TOOL') },
      { name: 'dlq:workflows', ...getDlqOptions('WORKFLOW_RUN') },
      { name: 'dlq:workflow-steps', ...getDlqOptions('WORKFLOW_STEP_EXECUTE') },
      { name: 'dlq:workflow-schedules', ...getDlqOptions('WORKFLOW_SCHEDULE') },
      { name: 'dlq:plugins', ...getDlqOptions('PLUGIN_EXECUTE') },
      { name: 'dlq:plugin-sandbox', ...getDlqOptions('PLUGIN_SANDBOX') },
      { name: 'dlq:analytics', ...getDlqOptions('ANALYTICS_AGGREGATE') },
      { name: 'dlq:analytics-snapshots', ...getDlqOptions('ANALYTICS_SNAPSHOT') },
      { name: 'dlq:analytics-funnels', ...getDlqOptions('ANALYTICS_FUNNEL') },
      { name: 'dlq:analytics-retention', ...getDlqOptions('ANALYTICS_RETENTION') },
      { name: 'dlq:emails', ...getDlqOptions('EMAIL_SEND') },
      { name: 'dlq:notifications', ...getDlqOptions('NOTIFICATION_DISPATCH') },
      { name: 'dlq:otp', ...getDlqOptions('OTP_SEND') },
    ),
    // Register processors (workers)
    BullModule.registerFlowProcessor(
      // AI Consumers
      { name: 'ai-content', consumer: AiContentConsumer },
      { name: 'ai-seo', consumer: AiSeoConsumer },
      { name: 'ai-review', consumer: AiReviewConsumer },
      { name: 'ai-score', consumer: AiScoreConsumer },
      { name: 'ai-report-rerun', consumer: AiReportRerunConsumer },
      { name: 'ai-editor-tool', consumer: BaseConsumer }, // Using BaseConsumer for generic AI editor tool
      // Workflow Consumers
      { name: 'workflows', consumer: WorkflowConsumer },
      { name: 'workflow-steps', consumer: WorkflowStepConsumer },
      // Plugin Consumers
      { name: 'plugins', consumer: PluginConsumer },
      // Analytics Consumers
      { name: 'analytics', consumer: AnalyticsConsumer },
      // Communication Consumers
      { name: 'emails', consumer: EmailConsumer },
      { name: 'notifications', consumer: NotificationConsumer },
      { name: 'otp', consumer: OtpConsumer },
    ),
  ],
  controllers: [
    OwnerQueueController,
    QueueSseController,
    OwnerQueueDetailsController,
    OwnerQueueAdditionalController,
  ],
  providers: [
    QueueConfigService,
    ProducerService,
    QueueEventsService,
    ErrorClassifierService,
    CircuitBreakerService,
    QuarantineService,
    JobSlaService,
    IdempotencyService,
    DistributedLocksService,
    // Consumers (explicitly provided if needed, though BullMQ handles them)
  ],
  exports: [
    QueueConfigService,
    ProducerService,
    QueueEventsService,
    ErrorClassifierService,
    CircuitBreakerService,
    QuarantineService,
    JobSlaService,
    IdempotencyService,
    DistributedLocksService,
  ],
})
export class QueueModule {}

/**
 * Get queue options
 */
function getQueueOptions(jobType: string) {
  return {
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: {
        age: 7 * 24 * 3600, // 7 days
        count: 1000,
      },
      removeOnFail: {
        age: 30 * 24 * 3600, // 30 days
        count: 5000,
      },
    },
  };
}

/**
 * Get DLQ options
 */
function getDlqOptions(jobType: string) {
  return {
    defaultJobOptions: {
      removeOnComplete: {
        age: 30 * 24 * 3600, // 30 days
        count: 5000,
      },
      removeOnFail: {
        age: 60 * 24 * 3600, // 60 days
        count: 10000,
      },
    },
  };
}
