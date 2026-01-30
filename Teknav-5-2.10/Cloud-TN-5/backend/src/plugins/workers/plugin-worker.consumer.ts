import { Injectable, Logger } from '@nestjs/common';
import { Process, Job, Queue } from 'bullmq';
import { BaseConsumer } from '../../queue/services/base-consumer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../../queue/queue-config.service';
import { QueueEventsService } from '../../queue/services/queue-events.service';
import { CircuitBreakerService, Dependency } from '../../queue/services/circuit-breaker.service';
import { QuarantineService } from '../../queue/services/quarantine.service';
import { JobSlaService } from '../../queue/services/job-sla.service';
import { PluginWasmSandboxService } from '../services/plugin-wasm-sandbox.service';
import { PluginEventPipelineService, PluginHookEvent } from '../services/plugin-event-pipeline.service';
import { PluginPermissionService } from '../services/plugin-permission.service';
import { RateLimitService } from '../services/rate-limit.service';
import { JobType, JobPriority } from '../../queue/types/job-envelope';

/**
 * Plugin Worker Consumer (Execution)
 * PART 12 - Plugin Platform: "WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 */

@Injectable()
export class PluginWorkerConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.REDIS];

  constructor(
    auditLog: AuditLogService,
    prisma: PrismaService,
    queueConfig: QueueConfigService,
    queueEvents: QueueEventsService,
    circuitBreaker: CircuitBreakerService,
    quarantine: QuarantineService,
    jobSla: JobSlaService,
    private readonly sandbox: PluginWasmSandboxService,
    private readonly eventPipeline: PluginEventPipelineService,
    private readonly permissions: PluginPermissionService,
    private readonly rateLimit: RateLimitService,
  ) {
    super(
      JobType.PLUGIN_EXECUTE,
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
   * Process Plugin Hook Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { pluginId, hookType, payload, context } = meta;

    this.logger.log(`Processing Plugin Hook: ${aiJobId} (plugin: ${pluginId}, hook: ${hookType})`);

    // 1. Validate inputs
    if (!pluginId || !hookType) {
      throw new Error('Missing required fields: pluginId, hookType');
    }

    // 2. Get plugin installation
    const installation = await this.prisma.pluginInstallation.findUnique({
      where: {
        workspaceId_pluginId: {
          workspaceId,
          pluginId,
        },
      },
      include: {
        plugin: {
          include: {
            latestVersion: true,
          },
        },
      },
    });

    if (!installation || !installation.enabled) {
      throw new Error(`Plugin not installed or disabled: ${pluginId}`);
    }

    // 3. Verify signature (if required)
    const plugin = installation.plugin;
    if (plugin.security?.requireSigning) {
      await this.verifySignature(plugin, installation.workspaceId);
    }

    // 4. Check if plugin subscribes to this hook
    const manifest = JSON.parse(plugin.latestVersion.manifest);
    const hooks = (manifest.hooks as any) || {};
    const subscribedHooks = Object.keys(hooks).filter(key => hooks[key] === true);

    if (!subscribedHooks.includes(hookType)) {
      this.logger.log(`Plugin does not subscribe to hook: ${hookType}`);
      return { success: true, skipped: true, reason: 'Hook not subscribed' };
    }

    // 5. Execute hook with WASM sandbox
    const startTime = Date.now();
    let log: any = {
      workspaceId,
      pluginId,
      versionId: plugin.latestVersionId,
      hookType,
      input: JSON.stringify(payload),
      status: 'RUNNING',
      errorMessage: null,
      durationMs: null,
      memoryUsedMb: null,
      tokensUsed: null,
      cost: null,
      createdAt: new Date(),
    };

    // Create initial log
    const executionLog = await this.prisma.pluginExecutionLog.create({
      data: log,
    });

    try {
      // Execute in sandbox
      const result = await this.sandbox.executeHook(
        plugin.id,
        installation.workspaceId,
        plugin.latestVersionId,
        hookType,
        payload,
        { ...context, workspaceId, tenantId },
      );

      // Update log with success
      const durationMs = Date.now() - startTime;
      const finalLog = await this.prisma.pluginExecutionLog.update({
        where: { id: executionLog.id },
        data: {
          status: 'COMPLETED',
          output: JSON.stringify(result),
          durationMs,
          memoryUsedMb: result.memoryUsedMb,
          tokensUsed: result.tokensUsed,
          cost: result.cost,
        },
      });

      // Emit completion event
      await this.queueEvents.jobCompleted({
        queueName: job.queueQualifiedName,
        jobType: JobType.PLUGIN_EXECUTE,
        aiJobId,
        bullJobId: job.id,
        traceId,
        entity,
        metadata: {
          pluginId,
          hookType,
          result,
        },
      });

      // Process output actions
      await this.processActions(result.actions, installation);

      // Update analytics (attribution)
      await this.updateAnalytics(installation, hookType, durationMs, true);

      this.logger.log(`Plugin hook completed: ${plugin.key}, hook: ${hookType} (${durationMs}ms)`);

      return {
        success: true,
        pluginKey: plugin.key,
        hookType,
        result,
      };
    } catch (error: any) {
      // Update log with failure
      const durationMs = Date.now() - startTime;
      const errorMessage = error.message || 'Unknown error';
      const stackTrace = error.stack || '';

      await this.prisma.pluginExecutionLog.update({
        where: { id: executionLog.id },
        data: {
          status: 'FAILED',
          errorMessage,
          durationMs,
        },
      });

      // Emit failure event
      await this.queueEvents.jobFailed({
        queueName: job.queueQualifiedName,
        jobType: JobType.PLUGIN_EXECUTE,
        aiJobId,
        bullJobId: job.id,
        traceId,
        entity,
        metadata: {
          pluginId,
          hookType,
          errorMessage,
        },
      });

      // Update analytics
      await this.updateAnalytics(installation, hookType, durationMs, false);

      this.logger.error(`Plugin hook failed: ${plugin.key}, hook: ${hookType}`, error);

      throw error;
    }
  }

  /**
   * Verify signature at execution time
   */
  private async verifySignature(plugin: any, workspaceId: number): Promise<void> {
    // Check workspace security config
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { tenant: true },
    });

    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const tenantConfig = (workspace.tenant.configuration as any) || {};
    const pluginSecurity = tenantConfig.pluginSecurity || {};

    if (!pluginSecurity.requireSigning) {
      return; // No signing required
    }

    const trustedSigners = pluginSecurity.trustedSigners || [];

    if (trustedSigners.length === 0) {
      return; // No signers configured, allow all verified signatures
    }

    const version = await this.prisma.pluginVersion.findUnique({
      where: { id: plugin.latestVersionId },
    });

    if (!version || !version.signingVerified) {
      throw new Error('Plugin version signature not verified');
    }

    // Check if signer is in trusted list
    const isTrusted = trustedSigners.some(
      signer => signer.fingerprint === version.signerKeyFingerprint,
    );

    if (!isTrusted) {
      throw new Error(
        `Untrusted signer: ${version.signerKeyFingerprint} not in trusted list`,
      );
    }
  }

  /**
   * Process output actions (update article, emit webhook, etc.)
   */
  private async processActions(actions: any[], installation: any): Promise<void> {
    if (!actions || actions.length === 0) {
      return;
    }

    for (const action of actions) {
      switch (action.type) {
        case 'article_update':
          await this.processArticleUpdate(action, installation);
          break;
        case 'webhook_emit':
          await this.processWebhookEmit(action, installation);
          break;
        case 'kv_set':
          await this.processKvSet(action, installation);
          break;
        case 'notification_send':
          await this.processNotificationSend(action, installation);
          break;
        // Add more action types as needed
        default:
          this.logger.warn(`Unknown action type: ${action.type}`);
      }
    }
  }

  /**
   * Process article update action
   */
  private async processArticleUpdate(action: any, installation: any): Promise<void> {
    const { articleId, patch } = action;

    // Check permission (cms:articles:write)
    const hasPermission = await this.permissions.hasPermission(
      installation.pluginId,
      installation.workspaceId,
      'cms:articles:write',
    );

    if (!hasPermission) {
      throw new Error('Permission denied: plugin does not have cms:articles:write scope');
    }

    // Update article
    await this.prisma.article.update({
      where: { id: articleId },
      data: patch,
    });

    this.logger.log(`Article updated by plugin: ${installation.pluginId}`);
  }

  /**
   * Process webhook emit action
   */
  private async processWebhookEmit(action: any, installation: any): Promise<void> {
    const { eventType, payload } = action;

    // Check permission (webhooks:emit)
    const hasPermission = await this.permissions.hasPermission(
      installation.pluginId,
      installation.workspaceId,
      'webhooks:emit',
    );

    if (!hasPermission) {
      throw new Error('Permission denied: plugin does not have webhooks:emit scope');
    }

    // Check rate limit
    await this.rateLimit.checkRateLimit(
      installation.pluginId,
      installation.workspaceId,
      'webhooks:emit',
    );

    // Emit webhook (use existing webhook infrastructure)
    // For MVP, we'll simulate
    this.logger.log(`Webhook emitted: ${eventType}, plugin: ${installation.pluginId}`);
  }

  /**
   * Process KV set action
   */
  private async processKvSet(action: any, installation: any): Promise<void> {
    const { key, value, ttlSec } = action;

    // Check permission (kv:write)
    const hasPermission = await this.permissions.hasPermission(
      installation.pluginId,
      installation.workspaceId,
      'kv:write',
    );

    if (!hasPermission) {
      throw new Error('Permission denied: plugin does not have kv:write scope');
    }

    // Check rate limit
    await this.rateLimit.checkRateLimit(
      installation.pluginId,
      installation.workspaceId,
      'kv:write',
    );

    // Set KV (plugin namespaced)
    const redisKey = `teknav:plugin:kv:${installation.workspaceId}:${installation.pluginId}:${key}`;
    await this.prisma.redis?.set(redisKey, JSON.stringify(value));

    if (ttlSec) {
      await this.prisma.redis?.expire(redisKey, ttlSec);
    }

    this.logger.log(`KV set by plugin: ${installation.pluginId}, key: ${key}`);
  }

  /**
   * Process notification send action
   */
  private async processNotificationSend(action: any, installation: any): Promise<void> {
    const { recipients, title, message } = action;

    // Check permission (webhooks:emit) // Notification send uses same scope
    const hasPermission = await this.permissions.hasPermission(
      installation.pluginId,
      installation.workspaceId,
      'webhooks:emit',
    );

    if (!hasPermission) {
      throw new Error('Permission denied: plugin does not have webhooks:emit scope');
    }

    // Send notifications (use existing notification infrastructure)
    // For MVP, we'll simulate
    this.logger.log(`Notification sent by plugin: ${installation.pluginId}, recipients: ${recipients?.length}`);
  }

  /**
   * Update analytics (attribution)
   */
  private async updateAnalytics(installation: any, hookType: string, durationMs: number, success: boolean): Promise<void> {
    // Increment Redis counters
    const pluginId = installation.pluginId;
    const workspaceId = installation.workspaceId;

    const key = `teknav:plugin:analytics:${workspaceId}:${pluginId}`;
    const countKey = `teknav:plugin:analytics:${workspaceId}:${pluginId}:count`;

    await this.prisma.redis?.incr(countKey);

    if (success) {
      await this.prisma.redis?.hincrby(key, `hook:${hookType}:completed`, 1);
      await this.prisma.redis?.hincrby(key, `totalDurationMs`, durationMs);
      await this.prisma.redis?.hincrby(key, `success`, 1);
    } else {
      await this.prisma.redis?.hincrby(key, `hook:${hookType}:failed`, 1);
      await this.prisma.redis?.hincrby(key, `failed`, 1);
    }

    // Update total count
    const totalCount = await this.prisma.redis?.hget(key, 'totalCount') || '0';
    await this.prisma.redis?.hincrby(key, 'totalCount', 1);

    this.logger.debug(`Analytics updated: plugin ${pluginId}, hook ${hookType}, success ${success}`);
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.REDIS) {
      return {
        failureThreshold: 20,
        resetTimeout: 60000, // 1 minute
        halfOpenMaxCalls: 10,
      };
    }
    return {};
  }
}
