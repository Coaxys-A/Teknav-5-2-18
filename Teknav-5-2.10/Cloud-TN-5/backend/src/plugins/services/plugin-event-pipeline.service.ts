import { Injectable, Logger } from '@nestjs/common';
import { ProducerService } from '../../queue/services/producer.service';
import { JobType, JobPriority } from '../../queue/types/job-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../logging/audit-log.service';

/**
 * Plugin Event Pipeline Service (Hook Dispatch via BullMQ)
 * PART 12 - Plugin Platform: "Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Features:
 * - Hook dispatch on system events (Article published, User signup, AI run, Schedule, Webhook)
 * - Queue-driven execution via teknav:queue:plugins
 * - Idempotency per hook execution
 * - Workspace boundary enforcement
 * - Realtime events via Part 11 SSE
 */

export interface PluginHookEvent {
  eventType: string;
  workspaceId: number;
  tenantId: number;
  entityId: number;
  entityType: string;
  actorId?: number;
  payload: any;
  timestamp: Date;
}

@Injectable()
export class PluginEventPipelineService {
  private readonly logger = new Logger(PluginEventPipelineService.name);

  constructor(
    private readonly producer: ProducerService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // HOOK DISPATCH (QUEUE-DRIVEN)
  // ==========================================================================

  /**
   * Dispatch plugin hooks for event
   */
  async dispatchHook(event: PluginHookEvent): Promise<{ enqueuedJobs: number }> {
    this.logger.log(`Dispatching plugin hooks for event: ${event.eventType}, workspace: ${event.workspaceId}`);

    // 1. Get installed plugins for workspace
    const installations = await this.getInstalledPlugins(event.workspaceId);

    // 2. Determine which plugins subscribe to which hooks
    const pluginHooks = await this.getPluginHooks(installations, event.eventType);

    if (pluginHooks.length === 0) {
      return { enqueuedJobs: 0 };
    }

    // 3. Enqueue hook job for each plugin/hook combination
    let enqueuedJobs = 0;

    for (const { plugin, hooks, version } of pluginHooks) {
      for (const hookType of hooks) {
        if (hooks.includes(event.eventType)) {
          const result = await this.enqueueHookJob(event, plugin, hookType, version);

          if (result.isNew) {
            enqueuedJobs++;
          }
        }
      }
    }

    this.logger.log(`Plugin hooks dispatched: ${enqueuedJobs} jobs enqueued`);

    return { enqueuedJobs };
  }

  /**
   * Get installed plugins for workspace
   */
  private async getInstalledPlugins(workspaceId: number): Promise<any[]> {
    const installations = await this.prisma.pluginInstallation.findMany({
      where: {
        workspaceId,
        enabled: true,
      },
      include: {
        plugin: {
          include: {
            latestVersion: true,
          },
        },
      },
    });

    return installations;
  }

  /**
   * Get plugin hooks from manifest
   */
  private async getPluginHooks(installations: any[], eventType: string): Promise<any[]> {
    const pluginHooks = [];

    for (const installation of installations) {
      const plugin = installation.plugin;
      const version = plugin.latestVersion;

      if (!version) {
        continue;
      }

      // Parse manifest
      const manifest = JSON.parse(version.manifest);

      // Extract hooks from manifest
      // Format: { hooks: { "onArticlePublish": true, "onUserSignup": false, ... } }
      const manifestHooks = (manifest.hooks as any) || {};

      // Get subscribed hook types
      const subscribedHooks = Object.entries(manifestHooks)
        .filter(([_, enabled]) => enabled)
        .map(([hookType, _]) => hookType);

      if (subscribedHooks.length > 0) {
        pluginHooks.push({
          plugin,
          hooks: subscribedHooks,
          version,
        });
      }
    }

    return pluginHooks;
  }

  /**
   * Enqueue hook job (idempotent)
   */
  private async enqueueHookJob(
    event: PluginHookEvent,
    plugin: any,
    hookType: string,
    version: any,
  ): Promise<{ isNew: boolean; jobId?: string }> {
    // Build idempotency key
    const timestampBucket = Math.floor(Date.now() / 60000); // 1 minute bucket
    const idempotencyKey = `hook:${hookType}:${event.workspaceId}:${plugin.id}:${event.entityId}:${timestampBucket}`;

    // Build job envelope
    const envelope = {
      jobType: JobType.PLUGIN_EXECUTE,
      idempotencyKey,
      priority: JobPriority.NORMAL,
      traceId: `hook-${hookType}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      actorId: event.actorId,
      tenantId: event.tenantId,
      workspaceId: event.workspaceId,
      entity: {
        type: event.entityType,
        id: event.entityId,
      },
      meta: {
        pluginId: plugin.id,
        pluginKey: plugin.key,
        hookType,
        event: event.eventType,
        payload: event.payload,
        context: {
          timestamp: event.timestamp,
        },
      },
    };

    // Enqueue to plugins queue
    const result = await this.producer.enqueueJob(JobType.PLUGIN_EXECUTE, envelope);

    // Log hook dispatch
    await this.auditLog.logAction({
      actorUserId: event.actorId || null,
      action: 'plugin.hook.dispatched',
      resource: 'PluginHook',
      payload: {
        pluginId: plugin.id,
        pluginKey: plugin.key,
        hookType,
        eventType: event.eventType,
        entityId: event.entityId,
        workspaceId: event.workspaceId,
      },
    });

    return result;
  }

  // ==========================================================================
  // SYSTEM EVENT HANDLERS (Public API)
  // ==========================================================================

  /**
   * Article Published Event
   */
  async onArticlePublished(articleId: number, workspaceId: number, tenantId: number, actorId: number) {
    const event: PluginHookEvent = {
      eventType: 'onArticlePublish',
      workspaceId,
      tenantId,
      entityId: articleId,
      entityType: 'ARTICLE',
      actorId,
      payload: {
        articleId,
      },
      timestamp: new Date(),
    };

    return await this.dispatchHook(event);
  }

  /**
   * User Signup Event
   */
  async onUserSignup(userId: number, workspaceId: number, tenantId: number, actorId: number) {
    const event: PluginHookEvent = {
      eventType: 'onUserSignup',
      workspaceId,
      tenantId,
      entityId: userId,
      entityType: 'USER',
      actorId,
      payload: {
        userId,
      },
      timestamp: new Date(),
    };

    return await this.dispatchHook(event);
  }

  /**
   * AI Run Completed Event
   */
  async onAiRunCompleted(aiRunId: number, workspaceId: number, tenantId: number) {
    const event: PluginHookEvent = {
      eventType: 'onAIResult',
      workspaceId,
      tenantId,
      entityId: aiRunId,
      entityType: 'AI_RUN',
      payload: {
        aiRunId,
        status: 'COMPLETED',
      },
      timestamp: new Date(),
    };

    return await this.dispatchHook(event);
  }

  /**
   * Scheduled Timer Event
   */
  async onSchedule(workspaceId: number, tenantId: number, scheduleId: number) {
    const event: PluginHookEvent = {
      eventType: 'onSchedule',
      workspaceId,
      tenantId,
      entityId: scheduleId,
      entityType: 'SCHEDULE',
      payload: {
        scheduleId,
      },
      timestamp: new Date(),
    };

    return await this.dispatchHook(event);
  }

  /**
   * Webhook Received Event
   */
  async onWebhookReceived(webhookId: number, workspaceId: number, tenantId: number, payload: any) {
    const event: PluginHookEvent = {
      eventType: 'onWebhook',
      workspaceId,
      tenantId,
      entityId: webhookId,
      entityType: 'WEBHOOK',
      actorId: null,
      payload: {
        webhookId,
        payload,
      },
      timestamp: new Date(),
    };

    return await this.dispatchHook(event);
  }
}
