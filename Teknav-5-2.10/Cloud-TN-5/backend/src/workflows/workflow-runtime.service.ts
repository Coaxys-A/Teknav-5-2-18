import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject, PolicyResult } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { RedisService } from '../../redis/redis.service';
import { WorkflowLockService } from './workflow-lock.service';
import { NotificationService } from '../notifications/notification.service';

/**
 * Workflow Runtime Service
 *
 * Orchestrates workflow execution.
 * Features:
 * - Load Definition
 * - Create Instance
 * - Iterate Steps
 * - Map Input Variables
 * - Execute Actions
 * - Capture Output
 * - Persist State
 * - Retry Logic
 * - Locks
 */

@Injectable()
export class WorkflowRuntimeService {
  private readonly logger = new Logger(WorkflowRuntimeService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyEngine: PolicyEngineService,
    private readonly auditLog: AuditLogService,
    private readonly redis: RedisService,
    private readonly lockService: WorkflowLockService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Get Workflow Instances
   * Returns paginated list of workflow instances in workspace.
   */
  async getInstances(
    actor: any,
    workspaceId: number,
    filters: {
      workflowId?: number;
      status?: 'RUNNING' | 'FAILED' | 'COMPLETED' | 'CANCELLED';
      page: number;
      pageSize: number;
      sort?: 'createdAt' | 'updatedAt';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ data: any[]; total: number }> {
    // 1. Policy Check (READ WorkflowInstance)
    let policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.WORKFLOW,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ConflictException('Policy Denied');
    }

    // 2. Build Query
    const where: any = {
      workspaceId,
    };

    if (filters.workflowId) {
      where.definitionId = filters.workflowId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    const orderBy: any = {};
    if (filters.sort) {
      orderBy[filters.sort] = filters.order || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const skip = (filters.page - 1) * filters.pageSize;
    const take = filters.pageSize;

    // 3. Execute Query
    const [instances, total] = await Promise.all([
      this.prisma.workflowInstance.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          definitionId: true,
          status: true,
          startedBy: true,
          startedAt: true,
          finishedAt: true,
          errorMessage: true,
          definition: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
        },
      }),
      this.prisma.workflowInstance.count({ where }),
    ]);

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.instances.list',
      resource: 'WorkflowInstance',
      payload: {
        filters,
        count: instances.length,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    return { data: instances, total };
  }

  /**
   * Get Workflow Instance Detail
   */
  async getInstance(actor: any, workspaceId: number, instanceId: number): Promise<any> {
    // 1. Policy Check (READ)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.WORKFLOW,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ConflictException('Policy Denied');
    }

    // 2. Fetch Instance + Steps
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, workspaceId },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            name: true,
            type: true,
            config: true,
            inputMapping: true,
          },
        },
        definition: {
          select: {
            id: true,
            name: true,
            triggers: true,
            steps: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                name: true,
                type: true,
                config: true,
                inputMapping: true,
              },
            },
          },
        },
      },
    });

    if (!instance) {
      throw new NotFoundException('Workflow instance not found');
    }

    return instance;
  }

  /**
   * Get Workflow Instance Steps
   */
  async getInstanceSteps(actor: any, workspaceId: number, instanceId: number): Promise<any[]> {
    // 1. Policy Check (READ)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.WORKFLOW,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ConflictException('Policy Denied');
    }

    // 2. Fetch Steps
    const steps = await this.prisma.workflowStepExecution.findMany({
      where: { instanceId },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        order: true,
        name: true,
        type: true,
        status: true,
        input: true,
        output: true,
        error: true,
        retryCount: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    return steps;
  }

  /**
   * Get Workflow Definitions
   * Returns paginated list of workflow definitions in workspace.
   */
  async getDefinitions(
    actor: any,
    workspaceId: number,
    filters: {
      status?: 'ACTIVE' | 'INACTIVE';
      page: number;
      pageSize: number;
      sort?: 'createdAt' | 'updatedAt';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ data: any[]; total: number }> {
    // 1. Policy Check (READ)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.WORKFLOW,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ConflictException('Policy Denied');
    }

    // 2. Build Query
    const where: any = {
      workspaceId,
    };

    if (filters.status) {
      where.status = filters.status;
    }

    const orderBy: any = {};
    if (filters.sort) {
      orderBy[filters.sort] = filters.order || 'desc';
    } else {
      orderBy.createdAt = 'desc';
    }

    const skip = (filters.page - 1) * filters.pageSize;
    const take = filters.pageSize;

    // 3. Execute Query
    const [definitions, total] = await Promise.all([
      this.prisma.workflowDefinition.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          name: true,
          description: true,
          status,
          triggers: true,
          steps: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              name: true,
              type: true,
              config: true,
              inputMapping: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.workflowDefinition.count({ where }),
    ]);

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.definitions.list',
      resource: 'WorkflowDefinition',
      payload: {
        filters,
        count: definitions.length,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    return { data: definitions, total };
  }

  /**
   * Cancel Workflow Instance
   */
  async cancelInstance(actor: any, workspaceId: number, instanceId: number): Promise<void> {
    // 1. Policy Check (UPDATE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.RUN_WORKFLOW,
      subject: PolicySubject.WORKFLOW,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ConflictException('Policy Denied');
    }

    // 2. Acquire Lock on Instance
    const locked = await this.lockService.acquireLock(instanceId, 10);
    if (!locked) {
      throw new ConflictException('Workflow instance is currently being modified');
    }

    try {
      // 3. Fetch Instance
      const instance = await this.prisma.workflowInstance.findFirst({
        where: { id: instanceId, workspaceId },
      });

      if (!instance) {
        throw new NotFoundException('Workflow instance not found');
      }

      if (instance.status !== 'RUNNING') {
        throw new ConflictException('Can only cancel running instances');
      }

      // 4. Update Status
      await this.prisma.workflowInstance.update({
        where: { id: instanceId },
        data: {
          status: 'CANCELLED',
          finishedAt: new Date(),
        },
      });

      // 5. Audit Log
      await this.auditLog.logAction({
        actorUserId: actor.userId,
        action: 'workflow.cancel',
        resource: `WorkflowInstance:${instanceId}`,
        payload: {
          instanceId,
          policyDecisionId: policyResult.policyDecisionId,
        },
      });

      // 6. Publish Event
      await this.publishEvent('instance.cancelled', { instanceId });
    } finally {
      // 7. Release Lock
      await this.lockService.releaseLock(instanceId);
    }
  }

  /**
   * Main Run Workflow (Orchestrator)
   */
  async runWorkflow(
    actor: any,
    workspaceId: number,
    definitionId: number,
    input: Record<string, any>,
    triggerContext: any = {},
  ): Promise<any> {
    this.logger.log(`Starting workflow ${definitionId} for workspace ${workspaceId} by user ${actor.userId}`);

    // 1. Acquire Lock on Definition (Prevent multiple runs of same def)
    const locked = await this.lockService.acquireLock(definitionId, 60);
    if (!locked) {
      throw new ConflictException('Workflow is already running or locked');
    }

    let instanceId: number | null = null;

    try {
      // 2. Load Definition
      const definition = await this.prisma.workflowDefinition.findFirst({
        where: { id: definitionId, workspaceId },
        include: {
          triggers: true,
          steps: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              name: true,
              type: true,
              config: true,
              inputMapping: true,
            },
          },
        },
      });

      if (!definition) {
        throw new Error('Workflow definition not found');
      }

      // 3. Create WorkflowInstance
      const instance = await this.prisma.workflowInstance.create({
        data: {
          definitionId,
          workspaceId,
          status: 'RUNNING',
          startedBy: actor.userId,
          startedAt: new Date(),
          input: JSON.stringify(input),
          triggerContext: JSON.stringify(triggerContext),
        },
      });
      instanceId = instance.id;

      // 4. Publish Instance Start Event
      await this.publishEvent('instance.start', { instanceId, definitionId, status: 'RUNNING' });

      // 5. Execute Steps
      const steps = definition.steps;
      const stepExecutions = [];
      let workflowFailed = false;
      let errorMessage = '';

      for (const step of steps) {
        const stepExecution = await this.executeStep(actor, workspaceId, instanceId, step, input, triggerContext);
        stepExecutions.push(stepExecution);

        if (!stepExecution.success) {
          workflowFailed = true;
          errorMessage = `Step "${step.name}" failed: ${stepExecution.error}`;
          break;
        }
      }

      // 6. Finalize Instance
      const finalStatus = workflowFailed ? 'FAILED' : 'COMPLETED';
      const finishedAt = new Date();

      await this.prisma.workflowInstance.update({
        where: { id: instanceId },
        data: {
          status: finalStatus,
          finishedAt,
          output: JSON.stringify({
            failed: workflowFailed,
            error: errorMessage,
            steps: stepExecutions,
          }),
          errorMessage,
        },
      });

      // 7. Publish Instance Completion Event
      await this.publishEvent(finalStatus === 'COMPLETED' ? 'instance.success' : 'instance.failed', {
        instanceId,
        definitionId,
        status: finalStatus,
        error: errorMessage,
      });

      return instance;
    } catch (error) {
      this.logger.error(`Workflow ${definitionId} failed`, error);

      // Handle Failure
      if (instanceId) {
        await this.prisma.workflowInstance.update({
          where: { id: instanceId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorMessage: error.message,
            output: JSON.stringify({ failed: true, error: error.message }),
          },
        });
        await this.publishEvent('instance.failed', { instanceId, definitionId, status: 'FAILED', error: error.message });
      }

      throw error;
    } finally {
      // 8. Release Lock
      if (instanceId) {
        await this.lockService.releaseLock(instanceId);
      }
    }
  }

  /**
   * Execute Step
   * Executes single step, handles actions.
   */
  private async executeStep(
    actor: any,
    workspaceId: number,
    instanceId: number,
    step: any,
    input: Record<string, any>,
    triggerContext: any,
  ): Promise<{ success: boolean; error?: string; output?: any }> {
    this.logger.log(`Executing step ${step.id} (${step.type})`);

    const stepExecutionId = `step-${instanceId}-${step.id}-${Date.now()}`;

    try {
      // 1. Map Inputs
      const stepInput = this.mapStepInputs(step, input, triggerContext);

      // 2. Persist Step Execution (Start)
      await this.prisma.workflowStepExecution.create({
        data: {
          instanceId,
          stepId: step.id,
          status: 'RUNNING',
          input: JSON.stringify(stepInput),
          startedAt: new Date(),
          retryCount: 0,
        },
      });

      // 3. Publish Step Start Event
      await this.publishEvent('step.start', { instanceId, stepId: step.id, status: 'RUNNING' });

      // 4. Execute Action
      const result = await this.executeStepAction(actor, workspaceId, instanceId, step, stepInput);

      // 5. Persist Step Execution (Success/Fail)
      const finalStatus = result.success ? 'SUCCESS' : 'FAILED';
      const finishedAt = new Date();

      await this.prisma.workflowStepExecution.update({
        where: { id: stepExecutionId },
        data: {
          status: finalStatus,
          output: JSON.stringify(result.output),
          finishedAt,
          errorMessage: result.error,
        },
      });

      // 6. Publish Step Finish Event
      await this.publishEvent(finalStatus === 'SUCCESS' ? 'step.success' : 'step.failed', {
        instanceId,
        stepId: step.id,
        status: finalStatus,
      });

      return result;
    } catch (error) {
      this.logger.error(`Step ${step.id} failed`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute Step Action
   * Switch on step.type
   */
  private async executeStepAction(
    actor: any,
    workspaceId: number,
    instanceId: number,
    step: any,
    input: any,
  ): Promise<{ success: boolean; output?: any }> {
    switch (step.type) {
      case 'MANUAL_TASK':
        return { success: true, output: { status: 'completed', action: 'manual_task' } }; // Manual task handled offline

      case 'HTTP_REQUEST':
        return await this.handleHttpRequest(actor, workspaceId, step, input);

      case 'WEBHOOK':
        return await this.handleWebhook(actor, workspaceId, step, input);

      case 'NOTIFY_USER':
        return await this.handleNotifyUser(actor, workspaceId, step, input, instanceId);

      case 'AI_GENERATE':
        // AI Integration will be in later phase. For now, return success.
        return { success: true, output: { message: 'AI generation stubbed' } };

      case 'ARTICLE_PUBLISH':
        return await this.handleArticlePublish(actor, workspaceId, step, input, instanceId);

      case 'ARTICLE_REVIEW':
        return await this.handleArticleReview(actor, workspaceId, step, input, instanceId);

      default:
        this.logger.warn(`Unknown step type: ${step.type}`);
        return { success: true, output: { message: 'Unknown type' } };
    }
  }

  /**
   * Handle HTTP Request
   */
  private async handleHttpRequest(actor: any, workspaceId: number, step: any, input: any): Promise<any> {
    const { url, method, headers, body } = step.config;
    const response = await fetch(url, {
      method: method || 'GET',
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return await response.json();
  }

  /**
   * Handle Webhook
   */
  private async handleWebhook(actor: any, workspaceId: number, step: any, input: any): Promise<any> {
    const { url, secret } = step.config;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
      },
      body: JSON.stringify(input),
    });
    return await response.json();
  }

  /**
   * Handle Notify User
   */
  private async handleNotifyUser(actor: any, workspaceId: number, step: any, input: any, instanceId: number): Promise<any> {
    const { userIdKey, message, type } = step.config;
    const targetUserId = input[userIdKey];

    await this.notificationService.createNotification({
      recipientUserId: targetUserId,
      type: type || 'info',
      title: 'Workflow Notification',
      message: message || 'Workflow step completed',
      link: `/dashboard/writer/articles/${input.articleId}/edit`,
    });

    return { success: true, output: { notified: targetUserId } };
  }

  /**
   * Handle Article Publish
   */
  private async handleArticlePublish(actor: any, workspaceId: number, step: any, input: any, instanceId: number): Promise<any> {
    const { articleIdKey } = step.config;
    const targetArticleId = input[articleIdKey];

    if (!targetArticleId) {
      throw new Error('Article ID missing from input');
    }

    await this.prisma.article.update({
      where: { id: targetArticleId, workspaceId },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        changedBy: actor.userId,
      },
    });

    // Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.article.publish',
      resource: `Article:${targetArticleId}`,
      payload: {
        instanceId,
        definitionId: step.workflowId, // Assuming context
      },
    });

    return { success: true, output: { articleId: targetArticleId, status: 'PUBLISHED' } };
  }

  /**
   * Handle Article Review (Trigger flow)
   */
  private async handleArticleReview(actor: any, workspaceId: number, step: any, input: any, instanceId: number): Promise<any> {
    const { articleIdKey } = step.config;
    const targetArticleId = input[articleIdKey];

    if (!targetArticleId) {
      throw new Error('Article ID missing');
    }

    await this.prisma.article.update({
      where: { id: targetArticleId, workspaceId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        changedBy: actor.userId,
      },
    });

    // Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.article.submit',
      resource: `Article:${targetArticleId}`,
      payload: {
        instanceId,
        definitionId: step.workflowId,
      },
    });

    return { success: true, output: { articleId: targetArticleId, status: 'SUBMITTED' } };
  }

  /**
   * Map Step Inputs
   * Combines instance input, previous step outputs, and config default values.
   */
  private mapStepInputs(step: any, instanceInput: Record<string, any>, rawInput: string): any {
    const input = { ...rawInput };

    // Apply Step Config Defaults
    if (step.config && step.config.inputDefaults) {
      Object.assign(input, step.config.inputDefaults);
    }

    // Map Input Variables
    if (step.inputMapping) {
      for (const mapping of step.inputMapping) {
        input[mapping.target] = input[mapping.source];
      }
    }

    return input;
  }

  /**
   * Publish Redis Pub/Sub Event
   */
  private async publishEvent(type: string, payload: any): Promise<void> {
    const channel = 'teknav:workflow:events';
    const message = JSON.stringify({ type, payload });
    try {
      await this.redis.redis.publish(channel, message);
      this.logger.log(`Published event to channel ${channel}: ${type}`);
    } catch (error) {
      this.logger.error('Failed to publish event', error);
    }
  }
}
