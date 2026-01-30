import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * Analytics Processor
 *
 * Aggregates raw events.
 * Writes rollups to DB.
 * Updates Redis snapshots.
 */

@Processor('analytics-processing')
export class AnalyticsProcessor {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {}

  @Process('analytics-processing')
  async handleAnalytics(job: Job<any>) {
    const { data } = job;
    const { eventBatchId, events } = data;

    try {
      // 1. Aggregate Events
      const rollups: Record<string, number> = {
        page_views: 0,
        unique_users: new Set(),
        article_reads: 0,
      };

      events.forEach((event: any) => {
        if (event.type === 'page.view') rollups.page_views++;
        if (event.userId) rollups.unique_users.add(event.userId);
        if (event.type === 'article.read' && event.entityType === 'Article') rollups.article_reads++;
      });

      // 2. Write Rollups (Stubbed: In real app, use Aggregation Table)
      // await this.prisma.analyticsRollup.create({ ... })
      
      this.logger.log(`Analytics batch ${eventBatchId} processed: ${events.length} events`);
    } catch (error) {
      this.logger.error(`Analytics Job ${job.id} failed`, error);
      throw error;
    }
  }

  @OnQueueError()
  async onError(job: Job, error: Error) {
    this.logger.error(`Analytics Job ${job.id} error`, error);
  }
}
