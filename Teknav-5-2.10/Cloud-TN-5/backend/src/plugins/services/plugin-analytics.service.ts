import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobType, JobPriority } from '../../queue/types/job-envelope';
import { ProducerService } from '../../queue/services/producer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { Logger } from '@nestjs/common';

/**
 * Plugin Analytics Attribution Service (Redis + Postgres)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Sign Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Features:
 * - Track plugin hook invocations, failures, avg duration
 * - Track outbound HTTP calls count
 * - Track content changes count (article updates)
 * - Track webhooks emitted count
 * - Redis counters + Postgres aggregates via analytics queue
 */

export interface PluginAnalyticsSummary {
  pluginId: number;
  workspaceId?: number;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalInvocations: number;
    completedInvocations: number;
    failedInvocations: number;
    avgDurationMs: number;
    totalDurationMs: number;
    successRate: number;
  };
  breakdown: {
    byHookType: Record<string, { count: number; avgDurationMs: number }>;
    byStatus: Record<string, number>;
  };
  attribution: {
    outboundHttpCalls: number;
    articleUpdates: number;
    webhooksEmitted: number;
    notificationsSent: number;
    kvOperations: number;
  };
}

export interface PluginAnalyticsRange {
  hours?: number; // Rolling window (default 24h)
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class PluginAnalyticsService {
  private readonly logger = new Logger(PluginAnalyticsService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: ProducerService,
    private readonly auditLog: AuditLogService,
  ) {
    this.redis = prisma.redis;
  }

  // ==========================================================================
  // REDIS FLUSH TO POSTGRES (Scheduled)
  // ==========================================================================

  /**
   * Flush Redis counters to Postgres (every 5 minutes)
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async flushToPostgres(): Promise<void> {
    this.logger.log('Flushing plugin analytics from Redis to Postgres');

    // Get all workspaces with installed plugins
    const workspaces = await this.prisma.workspace.findMany({
      include: {
        plugins: {
          where: { enabled: true },
        },
      },
    });

    for (const workspace of workspaces) {
      for (const installation of workspace.plugins) {
        await this.flushWorkspacePluginAnalytics(workspace.id, installation.pluginId, installation.pluginId);
      }
    }

    this.logger.log('Plugin analytics flush completed');
  }

  /**
   * Flush analytics for specific workspace/plugin
   */
  private async flushWorkspacePluginAnalytics(
    workspaceId: number,
    pluginId: number,
  ): Promise<void> {
    this.logger.debug(`Flushing analytics: workspace ${workspaceId}, plugin ${pluginId}`);

    const now = Date.now();
    const periodStart = new Date(now - 24 * 60 * 60 * 1000); // 24 hours ago

    // Get Redis counters
    const key = `teknav:plugin:analytics:${workspaceId}:${pluginId}`;

    const [totalCount, completedCount, failedCount, totalDuration] = await Promise.all([
      this.redis.hget(key, 'totalCount'),
      this.redis.hget(key, 'completed'),
      this.redis.hget(key, 'failed'),
      this.redis.hget(key, 'totalDurationMs'),
    ]);

    const totalInvocations = parseInt(totalCount || '0');
    const completedInvocations = parseInt(completedCount || '0');
    const failedInvocations = parseInt(failedCount || '0');
    const totalDuration = parseInt(totalDuration || '0');

    if (totalInvocations === 0) {
      return; // No data to flush
    }

    // Get breakdown by hook type
    const hookTypes = ['onArticlePublish', 'onUserSignup', 'onAIResult', 'onSchedule', 'onWebhook'];
    const byHookType: any = {};

    for (const hookType of hookTypes) {
      const [hookCount, hookDuration] = await Promise.all([
        this.redis.hget(key, `hook:${hookType}:count`),
        this.redis.hget(key, `hook:${hookType}:durationMs`),
      ]);

      if (hookCount) {
        byHookType[hookType] = {
          count: parseInt(hookCount),
          avgDurationMs: parseInt(hookDuration || '0'),
        };
      }
    }

    // Get breakdown by status
    const statuses = ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];
    const byStatus: any = {};

    for (const status of statuses) {
      const count = await this.redis.hget(key, `status:${status}`);
      if (count) {
        byStatus[status] = parseInt(count);
      }
    }

    // Get attribution metrics
    const [outboundCalls, articleUpdates, webhooksEmitted, notificationsSent, kvOps] = await Promise.all([
      this.redis.hget(key, 'attribution:outboundHttpCalls'),
      this.redis.hget(key, 'attribution:articleUpdates'),
      this.redis.hget(key, 'attribution:webhooksEmitted'),
      this.redis.hget(key, 'attribution:notificationsSent'),
      this.redis.hget(key, 'attribution:kvOperations'),
    ]);

    const attribution = {
      outboundHttpCalls: parseInt(outboundCalls || '0'),
      articleUpdates: parseInt(articleUpdates || '0'),
      webhooksEmitted: parseInt(webhooksEmitted || '0'),
      notificationsSent: parseInt(notificationsSent || '0'),
      kvOperations: parseInt(kvOps || '0'),
    };

    // Flush to Postgres (AnalyticsAggregate)
    const avgDuration = totalInvocations > 0 ? totalDuration / totalInvocations : 0;
    const successRate = totalInvocations > 0 ? completedInvocations / totalInvocations : 0;

    await this.prisma.analyticsAggregate.create({
      data: {
        workspaceId,
        pluginId,
        bucket: 'day',
        period: '24h',
        eventType: 'plugin_hook_invocation',
        count: totalInvocations,
        meta: JSON.stringify({
          avgDurationMs,
          successRate,
          breakdown: {
            byHookType,
            byStatus,
          },
          attribution,
        }),
        createdAt: new Date(),
      },
    });

    // Clear Redis counters
    await this.redis.del(key);
    await this.redis.del(`${key}:*`); // Delete all subkeys

    this.logger.debug(`Flushed ${totalInvocations} analytics records for plugin ${pluginId}`);
  }

  // ==========================================================================
  // ANALYTICS QUERY
  // ==========================================================================

  /**
   * Get plugin analytics (Owner scope - across all workspaces)
   */
  async getPluginAnalytics(pluginId: number, range?: PluginAnalyticsRange): Promise<PluginAnalyticsSummary> {
    const { hours = 24, dateFrom, dateTo } = range || {};
    const periodEnd = dateTo ? new Date(dateTo) : new Date();
    const periodStart = dateFrom ? new Date(dateFrom) : new Date(periodEnd.getTime() - hours * 60 * 60 * 1000);

    // Query Postgres analytics
    const aggregates = await this.prisma.analyticsAggregate.findMany({
      where: {
        pluginId,
        eventType: 'plugin_hook_invocation',
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Sum metrics
    let totalInvocations = 0;
    let completedInvocations = 0;
    let failedInvocations = 0;
    let totalDuration = 0;
    const byHookType: any = {};
    const byStatus: any = {};
    let totalOutboundCalls = 0;
    let totalArticleUpdates = 0;
    let totalWebhooksEmitted = 0;

    for (const agg of aggregates) {
      const meta = JSON.parse(agg.meta);

      totalInvocations += agg.count;
      completedInvocations += meta.breakdown?.byStatus?.COMPLETED || 0;
      failedInvocations += meta.breakdown?.byStatus?.FAILED || 0;
      totalDuration += (meta.avgDurationMs || 0) * agg.count;
      totalOutboundCalls += meta.attribution?.outboundHttpCalls || 0;
      totalArticleUpdates += meta.attribution?.articleUpdates || 0;
      totalWebhooksEmitted += meta.attribution?.webhooksEmitted || 0;

      // Merge byHookType
      for (const [hook, data] of Object.entries(meta.breakdown?.byHookType || {})) {
        if (!byHookType[hook]) {
          byHookType[hook] = { count: 0, avgDurationMs: 0 };
        }
        byHookType[hook].count += data.count;
        byHookType[hook].avgDurationMs = data.avgDurationMs;
      }

      // Merge byStatus
      for (const [status, count] of Object.entries(meta.breakdown?.byStatus || {})) {
        if (!byStatus[status]) {
          byStatus[status] = 0;
        }
        byStatus[status] += count;
      }
    }

    const avgDuration = totalInvocations > 0 ? totalDuration / totalInvocations : 0;
    const successRate = totalInvocations > 0 ? completedInvocations / totalInvocations : 0;

    return {
      pluginId,
      period: {
        start: periodStart,
        end: periodEnd,
      },
      metrics: {
        totalInvocations,
        completedInvocations,
        failedInvocations,
        avgDurationMs,
        totalDuration,
        successRate,
      },
      breakdown: {
        byHookType,
        byStatus,
      },
      attribution: {
        outboundHttpCalls: totalOutboundCalls,
        articleUpdates: totalArticleUpdates,
        webhooksEmitted: totalWebhooksEmitted,
        notificationsSent: meta?.attribution?.notificationsSent || 0,
        kvOperations: meta?.attribution?.kvOperations || 0,
      },
    };
  }

  /**
   * Get workspace plugin analytics
   */
  async getWorkspacePluginAnalytics(
    workspaceId: number,
    pluginId: number,
    range?: PluginAnalyticsRange,
  ): Promise<PluginAnalyticsSummary> {
    const { hours = 24, dateFrom, dateTo } = range || {};
    const periodEnd = dateTo ? new Date(dateTo) : new Date();
    const periodStart = dateFrom ? new Date(dateFrom) : new Date(periodEnd.getTime() - hours * 60 * 60 * 1000);

    // Query Postgres analytics
    const aggregates = await this.prisma.analyticsAggregate.findMany({
      where: {
        workspaceId,
        pluginId,
        eventType: 'plugin_hook_invocation',
        createdAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Sum metrics (same logic as owner scope)
    let totalInvocations = 0;
    let completedInvocations = 0;
    let failedInvocations = 0;
    let totalDuration = 0;
    const byHookType: any = {};
    const byStatus: any = {};
    let totalOutboundCalls = 0;
    let totalArticleUpdates = 0;
    let totalWebhooksEmitted = 0;

    for (const agg of aggregates) {
      const meta = JSON.parse(agg.meta);

      totalInvocations += agg.count;
      completedInvocations += meta.breakdown?.byStatus?.COMPLETED || 0;
      failedInvocations += meta.breakdown?.byStatus?.FAILED || 0;
      totalDuration += (meta.avgDurationMs || 0) * agg.count;
      totalOutboundCalls += meta.attribution?.outboundHttpCalls || 0;
      totalArticleUpdates += meta.attribution?.articleUpdates || 0;
      totalWebhooksEmitted += meta.attribution?.webhooksEmitted || 0;

      for (const [hook, data] of Object.entries(meta.breakdown?.byHookType || {})) {
        if (!byHookType[hook]) {
          byHookType[hook] = { count: 0, avgDurationMs: 0 };
        }
        byHookType[hook].count += data.count;
        byHookType[hook].avgDurationMs = data.avgDurationMs;
      }

      for (const [status, count] of Object.entries(meta.breakdown?.byStatus || {})) {
        if (!byStatus[status]) {
          byStatus[status] = 0;
        }
        byStatus[status] += count;
      }
    }

    const avgDuration = totalInvocations > 0 ? totalDuration / totalInvocations : 0;
    const successRate = totalInvocations > 0 ? completedInvocations / totalInvocations : 0;

    return {
      pluginId,
      workspaceId,
      period: {
        start: periodStart,
        end: periodEnd,
      },
      metrics: {
        totalInvocations,
        completedInvocations,
        failedInvocations,
        avgDurationMs,
        totalDuration,
        successRate,
      },
      breakdown: {
        byHookType,
        byStatus,
      },
      attribution: {
        outboundHttpCalls: totalOutboundCalls,
        articleUpdates: totalArticleUpdates,
        webhooksEmitted: totalWebhooksEmitted,
        notificationsSent: meta?.attribution?.notificationsSent || 0,
        kvOperations: meta?.attribution?.kvOperations || 0,
      },
    };
  }

  /**
   * Get all workspace plugins analytics
   */
  async getWorkspacePluginsAnalytics(
    workspaceId: number,
    range?: PluginAnalyticsRange,
  ): Promise<Record<number, PluginAnalyticsSummary>> {
    const installations = await this.prisma.pluginInstallation.findMany({
      where: {
        workspaceId,
        enabled: true,
      },
      include: {
        plugin: true,
      },
    });

    const analytics: Record<number, PluginAnalyticsSummary> = {};

    for (const installation of installations) {
      analytics[installation.pluginId] = await this.getWorkspacePluginAnalytics(
        workspaceId,
        installation.pluginId,
        range,
      );
    }

    return analytics;
  }

  /**
   * Get top plugins (by invocations)
   */
  async getTopPlugins(range?: PluginAnalyticsRange, limit: number = 10): Promise<any[]> {
    const { hours = 24, dateFrom, dateTo } = range || {};
    const periodEnd = dateTo ? new Date(dateTo) : new Date();
    const periodStart = dateFrom ? new Date(dateFrom) : new Date(periodEnd.getTime() - hours * 60 * 60 * 1000);

    // Query aggregates grouped by plugin
    const plugins = await this.prisma.plugin.findMany({
      include: {
        analyticsAggregates: {
          where: {
            eventType: 'plugin_hook_invocation',
            createdAt: {
              gte: periodStart,
              lte: periodEnd,
            },
          },
          take: 100, // Get recent data
        },
      },
    });

    const pluginStats = plugins.map(plugin => {
      let totalInvocations = 0;
      let avgDuration = 0;

      for (const agg of plugin.analyticsAggregates) {
        const meta = JSON.parse(agg.meta);
        totalInvocations += agg.count;
        avgDuration += (meta.avgDurationMs || 0) * agg.count;
      }

      return {
        plugin,
        totalInvocations,
        avgDuration: totalInvocations > 0 ? avgDuration / totalInvocations : 0,
      };
    });

    // Sort by totalInvocations
    pluginStats.sort((a, b) => b.totalInvocations - a.totalInvocations);

    return pluginStats.slice(0, limit);
  }

  // ==========================================================================
  // REDIS COUNTERS (FROM WASM SANDBOX)
  // ==========================================================================

  /**
   * Record analytics (from WASM sandbox)
   */
  async recordAnalytics(
    workspaceId: number,
    pluginId: number,
    hookType: string,
    durationMs: number,
    success: boolean,
  ): Promise<void> {
    const key = `teknav:plugin:analytics:${workspaceId}:${pluginId}`;

    await this.redis.hincrby(key, 'totalCount', 1);

    if (success) {
      await this.redis.hincrby(key, `hook:${hookType}:completed`, 1);
      await this.redis.hincrby(key, 'completed', 1);
      await this.redis.hincrby(key, 'success', 1);
    } else {
      await this.redis.hincrby(key, `hook:${hookType}:failed`, 1);
      await this.redis.hincrby(key, 'failed', 1);
    }

    await this.redis.hincrby(key, 'totalDurationMs', durationMs);
    await this.redis.hset(key, 'lastFlushAt', Date.now());
  }

  /**
   * Record attribution (from actions)
   */
  async recordAttribution(
    workspaceId: number,
    pluginId: number,
    type: 'outboundHttpCalls' | 'articleUpdates' | 'webhooksEmitted' | 'notificationsSent' | 'kvOperations',
    count: number,
  ): Promise<void> {
    const key = `teknav:plugin:analytics:${workspaceId}:${pluginId}`;
    const attributionKey = `attribution:${type}`;

    await this.redis.hincrby(key, attributionKey, count);
  }

  /**
   * Get real-time analytics (from Redis)
   */
  async getRealtimeAnalytics(
    workspaceId: number,
    pluginId: number,
  ): Promise<any> {
    const key = `teknav:plugin:analytics:${workspaceId}:${pluginId}`;

    const [totalCount, completed, failed, totalDuration, lastFlushAt] = await Promise.all([
      this.redis.hget(key, 'totalCount'),
      this.redis.hget(key, 'completed'),
      this.redis.hget(key, 'failed'),
      this.redis.hget(key, 'totalDurationMs'),
      this.redis.hget(key, 'lastFlushAt'),
    ]);

    const totalInvocations = parseInt(totalCount || '0');
    const completedInvocations = parseInt(completed || '0');
    const failedInvocations = parseInt(failed || '0');
    const avgDuration = totalInvocations > 0
      ? (parseInt(totalDuration || '0') / totalInvocations)
      : 0;

    // Get attribution
    const [outboundCalls, articleUpdates, webhooksEmitted, notificationsSent, kvOps] = await Promise.all([
      this.redis.hget(key, 'attribution:outboundHttpCalls'),
      this.redis.hget(key, 'attribution:articleUpdates'),
      this.redis.hget(key, 'attribution:webhooksEmitted'),
      this.redis.hget(key, 'attribution:notificationsSent'),
      this.redis.hget(key, 'attribution:kvOperations'),
    ]);

    return {
      totalInvocations,
      completedInvocations,
      failedInvocations,
      avgDurationMs,
      successRate: totalInvocations > 0 ? completedInvocations / totalInvocations : 0,
      attribution: {
        outboundHttpCalls: parseInt(outboundCalls || '0'),
        articleUpdates: parseInt(articleUpdates || '0'),
        webhooksEmitted: parseInt(webhooksEmitted || '0'),
        notificationsSent: parseInt(notificationsSent || '0'),
        kvOperations: parseInt(kvOps || '0'),
      },
      lastFlushAt: lastFlushAt ? new Date(parseInt(lastFlushAt)) : null,
    };
  }

  /**
   * Reset analytics (for uninstall)
   */
  async resetAnalytics(workspaceId: number, pluginId: number): Promise<void> {
    const key = `teknav:plugin:analytics:${workspaceId}:${pluginId}`;

    await this.redis.del(key);
    await this.redis.del(`${key}:*`);

    this.logger.log(`Analytics reset: workspace ${workspaceId}, plugin ${pluginId}`);
  }
}
