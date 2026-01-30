import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueRegistryService } from './queue-registry.service';
import { AiProcessor } from './processors/ai.processor';
import { WorkflowProcessor } from './processors/workflow.processor';
import { EmailProcessor } from './processors/email.processor';
import { BillingProcessor } from './processors/billing.processor';
import { PluginProcessor } from './processors/plugin.processor';
import { AnalyticsProcessor } from './processors/analytics.processor';
import { MediaProcessor } from './processors/media.processor';
import { QueueController } from './queue.controller';
import { QueueProducerService } from './queue-producer.service';
import { QueueStatsService } from './queue-stats.service';
import { RedisModule } from '../redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogModule } from '../logging/audit-log.module';
import { NotificationModule } from '../notifications/notification.module';
import { OpenRouterModule } from '../ai/openrouter/openrouter.module';
import { PluginExecutionModule } from '../plugins/execution/plugin-execution.module';

/**
 * Queue Module
 *
 * Manages BullMQ queues for AI, Workflows, Plugins, Analytics, Email, Billing, Media.
 */

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const QUEUES = [
  'ai-content',
  'ai-seo',
  'ai-translation',
  'workflow-execution',
  'plugin-execution',
  'analytics-processing',
  'email-notification',
  'billing-events',
  'media-processing',
] as const;

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    }),
    BullModule.registerQueue(
      { name: 'ai-content', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'ai-seo', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'ai-translation', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'workflow-execution', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'plugin-execution', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'analytics-processing', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'email-notification', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'billing-events', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    BullModule.registerQueue(
      { name: 'media-processing', defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } },
    PrismaModule,
    RedisModule,
    AuditLogModule,
    NotificationModule,
    OpenRouterModule,
    PluginExecutionModule,
  ],
  providers: [
    QueueRegistryService,
    QueueProducerService,
    QueueStatsService,
    AiProcessor,
    WorkflowProcessor,
    EmailProcessor,
    BillingProcessor,
    PluginProcessor,
    AnalyticsProcessor,
    MediaProcessor,
  ],
  controllers: [QueueController],
  exports: [
    QueueRegistryService,
    QueueProducerService,
    QueueStatsService,
    BullModule, // Export for other modules to add jobs
    PrismaModule,
    RedisModule,
  ],
})
export class QueueModule {}
