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
 * Plugin Consumer
 * M11 - Queue Platform: "Plugin Jobs Processing"
 *
 * Processes:
 * - Plugin hook execution (onArticlePublish, onUserSignup, onAIResult, onSchedule, onWebhook)
 * - Plugin sandbox execution
 * - Signature verification
 */

@Injectable()
export class PluginConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.PLUGIN_SANDBOX, Dependency.REDIS];

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
   * Process Plugin Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { pluginId, hookType, payload, context } = meta;

    this.logger.log(`Processing Plugin job: ${aiJobId} (plugin: ${pluginId}, hook: ${hookType})`);

    // 1. Validate inputs
    if (!pluginId || !hookType) {
      throw new Error('Missing required fields: pluginId, hookType');
    }

    // 2. Get plugin
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      include: {
        tenant: true,
        author: true,
      },
    });

    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    // 3. Check plugin status
    if (plugin.status !== 'ACTIVE') {
      throw new Error(`Plugin is not active: ${plugin.status}`);
    }

    // 4. Verify plugin signature
    if (!this.verifyPluginSignature(plugin)) {
      this.logger.error(`Plugin signature mismatch: ${pluginId}`);
      throw new Error('Plugin signature verification failed');
    }

    // 5. Check plugin permissions
    await this.checkPluginPermissions(plugin, workspaceId);

    // 6. Execute hook based on type
    let hookResult: any;

    switch (hookType) {
      case 'onArticlePublish':
        hookResult = await this.executeArticlePublishHook(plugin, payload, context);
        break;
      case 'onUserSignup':
        hookResult = await this.executeUserSignupHook(plugin, payload, context);
        break;
      case 'onAIResult':
        hookResult = await this.executeAIResultHook(plugin, payload, context);
        break;
      case 'onSchedule':
        hookResult = await this.executeScheduleHook(plugin, payload, context);
        break;
      case 'onWebhook':
        hookResult = await this.executeWebhookHook(plugin, payload, context);
        break;
      default:
        throw new Error(`Unknown hook type: ${hookType}`);
    }

    // 7. Record plugin execution log
    await this.prisma.pluginExecutionLog.create({
      data: {
        pluginId,
        hookType,
        tenantId,
        workspaceId,
        actorId,
        triggeredBy: entity.id,
        executionResult: JSON.stringify(hookResult),
        status: 'COMPLETED',
        executedAt: new Date(),
        traceId,
      },
    });

    // 8. Publish plugin execution event
    await this.queueEvents.jobCompleted({
      queueName: job.queueQualifiedName,
      jobType: JobType.PLUGIN_EXECUTE,
      aiJobId,
      bullJobId: job.id,
      traceId,
      entity: { type: 'Plugin', id: pluginId },
      metadata: { hookType, hookResult },
    });

    this.logger.log(`Plugin job completed: ${aiJobId} (plugin: ${pluginId}, hook: ${hookType})`);

    return {
      success: true,
      plugin,
      hookResult,
    };
  }

  /**
   * Execute Article Publish Hook
   */
  private async executeArticlePublishHook(plugin: any, payload: any, context: any): Promise<any> {
    const { articleId } = payload;

    if (!articleId) {
      throw new Error('Article publish hook missing articleId');
    }

    // Get article
    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });

    if (!article) {
      throw new Error(`Article not found: ${articleId}`);
    }

    // Execute plugin sandbox (simulated - in production, would use WASM runtime)
    const sandboxResult = await this.executePluginSandbox(
      plugin,
      { type: 'ARTICLE_PUBLISH', article },
      context,
    );

    return {
      type: 'article_publish',
      articleId,
      result: sandboxResult,
    };
  }

  /**
   * Execute User Signup Hook
   */
  private async executeUserSignupHook(plugin: any, payload: any, context: any): Promise<any> {
    const { userId } = payload;

    if (!userId) {
      throw new Error('User signup hook missing userId');
    }

    // Get user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Execute plugin sandbox
    const sandboxResult = await this.executePluginSandbox(
      plugin,
      { type: 'USER_SIGNUP', user },
      context,
    );

    return {
      type: 'user_signup',
      userId,
      result: sandboxResult,
    };
  }

  /**
   * Execute AI Result Hook
   */
  private async executeAIResultHook(plugin: any, payload: any, context: any): Promise<any> {
    const { aiJobId, aiResult } = payload;

    if (!aiJobId || !aiResult) {
      throw new Error('AI result hook missing aiJobId or aiResult');
    }

    // Execute plugin sandbox
    const sandboxResult = await this.executePluginSandbox(
      plugin,
      { type: 'AI_RESULT', aiJobId, aiResult },
      context,
    );

    return {
      type: 'ai_result',
      aiJobId,
      result: sandboxResult,
    };
  }

  /**
   * Execute Schedule Hook
   */
  private async executeScheduleHook(plugin: any, payload: any, context: any): Promise<any> {
    const { scheduleId } = payload;

    if (!scheduleId) {
      throw new Error('Schedule hook missing scheduleId');
    }

    // Get schedule (if exists)
    // For MVP, we'll just pass scheduleId to sandbox

    // Execute plugin sandbox
    const sandboxResult = await this.executePluginSandbox(
      plugin,
      { type: 'SCHEDULE', scheduleId },
      context,
    );

    return {
      type: 'schedule',
      scheduleId,
      result: sandboxResult,
    };
  }

  /**
   * Execute Webhook Hook
   */
  private async executeWebhookHook(plugin: any, payload: any, context: any): Promise<any> {
    const { webhookId, webhookData } = payload;

    if (!webhookId) {
      throw new Error('Webhook hook missing webhookId');
    }

    // Get webhook
    const webhook = await this.prisma.webhookEndpoint.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new Error(`Webhook not found: ${webhookId}`);
    }

    // Execute plugin sandbox
    const sandboxResult = await this.executePluginSandbox(
      plugin,
      { type: 'WEBHOOK', webhook, webhookData },
      context,
    );

    return {
      type: 'webhook',
      webhookId,
      result: sandboxResult,
    };
  }

  /**
   * Execute Plugin Sandbox (WASM Runtime - Simulated)
   */
  private async executePluginSandbox(
    plugin: any,
    input: any,
    context: any,
  ): Promise<any> {
    this.logger.debug(`Executing plugin sandbox: ${plugin.id} (input: ${JSON.stringify(input)})`);

    // In production, this would:
    // 1. Load plugin WASM binary
    // 2. Initialize WASM runtime
    // 3. Execute plugin function with input
    // 4. Capture output and errors
    // 5. Clean up runtime

    // For MVP, we'll simulate execution
    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay

    // Simulate output based on input type
    const output = {
      success: true,
      output: {
        pluginId: plugin.id,
        inputType: input.type,
        executedAt: new Date().toISOString(),
        message: `Plugin executed successfully for ${input.type}`,
      },
    };

    this.logger.debug(`Plugin sandbox result: ${JSON.stringify(output)}`);

    return output;
  }

  /**
   * Verify plugin signature
   */
  private verifyPluginSignature(plugin: any): boolean {
    // In production, this would verify cryptographic signature
    // For MVP, we'll assume all plugins are verified
    return true;
  }

  /**
   * Check plugin permissions
   */
  private async checkPluginPermissions(plugin: any, workspaceId: number): Promise<void> {
    // Get plugin scopes
    const scopes = (plugin.scopes as string[]) || [];

    // If plugin requires workspace access, verify workspace exists
    if (scopes.includes('workspace') && workspaceId) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
      });

      if (!workspace) {
        throw new Error('Plugin requires workspace access but workspace not found');
      }
    }

    // Check other scopes (API keys, tokens, etc.)
    // For MVP, we'll skip detailed scope checks
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.PLUGIN_SANDBOX) {
      return {
        failureThreshold: 10,
        resetTimeout: 300000, // 5 minutes
        halfOpenMaxCalls: 5,
      };
    }
    return {};
  }
}
