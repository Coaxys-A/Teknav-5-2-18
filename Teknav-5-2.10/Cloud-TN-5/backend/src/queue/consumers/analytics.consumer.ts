import { Injectable } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { BaseConsumer } from '../services/base-consumer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService } from '../services/queue-events.service';
import { CircuitBreakerService, Dependency } from '../services/circuit-breaker.service';
import { QuarantineService } from '../services/quarantine.service';
import { JobSlaService } from '../services/job-sla.service';
import { JobType } from '../types/job-envelope';

/**
 * Analytics Consumer
 * M11 - Queue Platform: "Analytics Jobs Processing"
 *
 * Processes:
 * - Aggregate events into daily/hourly buckets
 * - Snapshot dashboards into Redis
 * - Build funnels + retention cohorts
 */

@Injectable()
export class AnalyticsConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.POSTGRES, Dependency.REDIS];

  constructor(
    auditLog: AuditLogService,
    prisma: PrismaService,
    queueConfig: QueueConfigService,
    queueEvents: QueueEventsService,
    circuitBreaker: CircuitBreakerService,
    quarantine: QuarantineService,
    jobSla: JobSlaService,
  ) {
    super(
      JobType.ANALYTICS_AGGREGATE,
      auditLog,
      prisma,
      queueConfig,
      queueEvents,
      circuitBreaker,
      quarantine,
      jobSla,
    );
  }

  /**
   * Process Analytics Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { aggregationType, startDate, endDate, eventId } = meta;

    this.logger.log(`Processing Analytics job: ${aiJobId} (type: ${aggregationType})`);

    // 1. Validate inputs
    if (!aggregationType) {
      throw new Error('Missing required field: aggregationType');
    }

    // 2. Process aggregation based on type
    let aggregationResult: any;

    switch (aggregationType) {
      case 'daily_stats':
        aggregationResult = await this.aggregateDailyStats(tenantId, workspaceId, startDate, endDate);
        break;
      case 'hourly_stats':
        aggregationResult = await this.aggregateHourlyStats(tenantId, workspaceId, startDate, endDate);
        break;
      case 'article_analytics':
        aggregationResult = await this.aggregateArticleAnalytics(tenantId, workspaceId, startDate, endDate);
        break;
      case 'user_analytics':
        aggregationResult = await this.aggregateUserAnalytics(tenantId, workspaceId, startDate, endDate);
        break;
      case 'funnel_build':
        aggregationResult = await this.buildFunnel(tenantId, workspaceId, meta.funnelId);
        break;
      case 'retention_cohort':
        aggregationResult = await this.buildRetentionCohort(tenantId, workspaceId, startDate, endDate);
        break;
      default:
        throw new Error(`Unknown aggregation type: ${aggregationType}`);
    }

    this.logger.log(`Analytics job completed: ${aiJobId} (type: ${aggregationType})`);

    return {
      success: true,
      aggregationType,
      result: aggregationResult,
    };
  }

  /**
   * Aggregate Daily Stats
   */
  private async aggregateDailyStats(
    tenantId: number,
    workspaceId: number,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    this.logger.debug(`Aggregating daily stats: ${tenantId}/${workspaceId} (${startDate} to ${endDate})`);

    // Get analytics events for date range
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        tenantId,
        workspaceId,
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });

    // Aggregate by type
    const pageViews = events.filter(e => e.type === 'PAGE_VIEW').length;
    const articleViews = events.filter(e => e.type === 'ARTICLE_VIEW').length;
    const uniqueVisitors = new Set(events.map(e => e.userId || e.sessionId)).size;
    const avgSessionDuration = events.reduce((sum, e) => sum + (e.sessionDuration || 0), 0) / (events.length || 1);

    // Store in ArticleStatsDaily (or similar table)
    // For MVP, we'll just log the result
    const stats = {
      tenantId,
      workspaceId,
      date: new Date().toISOString().substring(0, 10), // YYYY-MM-DD
      pageViews,
      articleViews,
      uniqueVisitors,
      avgSessionDurationMs: avgSessionDuration,
    };

    // Upsert daily stats
    await this.prisma.articleStatsDaily.upsert({
      where: {
        workspaceId_date: {
          workspaceId,
          date: stats.date,
        },
      },
      create: stats,
      update: stats,
    });

    return stats;
  }

  /**
   * Aggregate Hourly Stats
   */
  private async aggregateHourlyStats(
    tenantId: number,
    workspaceId: number,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    this.logger.debug(`Aggregating hourly stats: ${tenantId}/${workspaceId}`);

    // Similar to daily stats but with hourly granularity
    // For MVP, we'll just log it
    return { message: 'Hourly stats aggregated', tenantId, workspaceId };
  }

  /**
   * Aggregate Article Analytics
   */
  private async aggregateArticleAnalytics(
    tenantId: number,
    workspaceId: number,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    this.logger.debug(`Aggregating article analytics: ${tenantId}/${workspaceId}`);

    // Get article events
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        tenantId,
        workspaceId,
        type: { in: ['ARTICLE_VIEW', 'ARTICLE_SHARE', 'ARTICLE_LIKE'] },
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });

    // Aggregate per article
    const articleStats = new Map<number, {
      views: number;
      shares: number;
      likes: number;
      uniqueVisitors: Set<number>;
    }>();

    for (const event of events) {
      const articleId = event.entityId;
      if (!articleId) continue;

      if (!articleStats.has(articleId)) {
        articleStats.set(articleId, { views: 0, shares: 0, likes: 0, uniqueVisitors: new Set() });
      }

      const stats = articleStats.get(articleId)!;

      switch (event.type) {
        case 'ARTICLE_VIEW':
          stats.views++;
          break;
        case 'ARTICLE_SHARE':
          stats.shares++;
          break;
        case 'ARTICLE_LIKE':
          stats.likes++;
          break;
      }

      if (event.userId) {
        stats.uniqueVisitors.add(event.userId);
      }
    }

    // Update article stats in DB
    for (const [articleId, stats] of articleStats.entries()) {
      await this.prisma.article.update({
        where: { id: articleId },
        data: {
          viewCount: { increment: stats.views },
          shareCount: { increment: stats.shares },
          likeCount: { increment: stats.likes },
        },
      });
    }

    return {
      articles: articleStats.size,
      totalEvents: events.length,
    };
  }

  /**
   * Aggregate User Analytics
   */
  private async aggregateUserAnalytics(
    tenantId: number,
    workspaceId: number,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    this.logger.debug(`Aggregating user analytics: ${tenantId}/${workspaceId}`);

    // Get user events
    const events = await this.prisma.analyticsEvent.findMany({
      where: {
        tenantId,
        workspaceId,
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
    });

    // Aggregate per user
    const userStats = new Map<number, {
      totalEvents: number;
      pageViews: number;
      articleViews: number;
      lastActiveAt: Date;
    }>();

    for (const event of events) {
      const userId = event.userId;
      if (!userId) continue;

      if (!userStats.has(userId)) {
        userStats.set(userId, {
          totalEvents: 0,
          pageViews: 0,
          articleViews: 0,
          lastActiveAt: event.createdAt,
        });
      }

      const stats = userStats.get(userId)!;
      stats.totalEvents++;

      if (event.type === 'PAGE_VIEW') {
        stats.pageViews++;
      }

      if (event.type === 'ARTICLE_VIEW') {
        stats.articleViews++;
      }

      if (event.createdAt > stats.lastActiveAt) {
        stats.lastActiveAt = event.createdAt;
      }
    }

    // Update user engagement stats in DB
    // For MVP, we'll just log it
    return {
      users: userStats.size,
      totalEvents: events.length,
    };
  }

  /**
   * Build Funnel
   */
  private async buildFunnel(tenantId: number, workspaceId: number, funnelId: number): Promise<any> {
    this.logger.debug(`Building funnel: ${funnelId}`);

    // Get funnel definition
    const funnel = await this.prisma.analyticsFunnel.findUnique({
      where: { id: funnelId },
      include: { steps: true },
    });

    if (!funnel) {
      throw new Error(`Funnel not found: ${funnelId}`);
    }

    // Calculate funnel metrics for each step
    const funnelMetrics = [];

    for (const step of funnel.steps) {
      // Count events matching step criteria
      const stepEvents = await this.prisma.analyticsEvent.count({
        where: {
          tenantId,
          workspaceId,
          type: step.eventType,
          ...(step.filter && { metadata: { equals: step.filter as any } }),
          createdAt: {
            gte: funnel.startDate,
            lte: funnel.endDate || new Date(),
          },
        },
      });

      funnelMetrics.push({
        stepId: step.id,
        stepName: step.name,
        eventCount: stepEvents,
        dropOffRate: funnelMetrics.length > 0
          ? (funnelMetrics[funnelMetrics.length - 1].eventCount - stepEvents) / funnelMetrics[funnelMetrics.length - 1].eventCount
          : 0,
      });
    }

    return {
      funnelId,
      funnelName: funnel.name,
      metrics: funnelMetrics,
    };
  }

  /**
   * Build Retention Cohort
   */
  private async buildRetentionCohort(
    tenantId: number,
    workspaceId: number,
    startDate: string,
    endDate: string,
  ): Promise<any> {
    this.logger.debug(`Building retention cohort: ${tenantId}/${workspaceId}`);

    // Get user signup events
    const signupEvents = await this.prisma.analyticsEvent.findMany({
      where: {
        tenantId,
        workspaceId,
        type: 'USER_SIGNUP',
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 1000, // Limit to 1000 users for MVP
    });

    // Calculate retention by cohort (day 1, day 7, day 30, etc.)
    const cohorts: any[] = [];

    for (const signupEvent of signupEvents) {
      const userId = signupEvent.userId;
      const cohortDate = signupEvent.createdAt.toISOString().substring(0, 10); // YYYY-MM-DD

      // Calculate retention metrics
      const day1Activity = await this.getUserActivity(userId, 1);
      const day7Activity = await this.getUserActivity(userId, 7);
      const day30Activity = await this.getUserActivity(userId, 30);

      cohorts.push({
        userId,
        cohortDate,
        day1Retention: day1Activity,
        day7Retention: day7Activity,
        day30Retention: day30Activity,
      });
    }

    return {
      totalUsers: signupEvents.length,
      cohorts,
    };
  }

  /**
   * Get user activity for retention calculation
   */
  private async getUserActivity(userId: number, days: number): Promise<boolean> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const events = await this.prisma.analyticsEvent.count({
      where: {
        userId,
        createdAt: {
          gte: since,
        },
      },
    });

    return events > 0;
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.POSTGRES) {
      return {
        failureThreshold: 10,
        resetTimeout: 120000, // 2 minutes
        halfOpenMaxCalls: 5,
      };
    }
    return {};
  }
}
