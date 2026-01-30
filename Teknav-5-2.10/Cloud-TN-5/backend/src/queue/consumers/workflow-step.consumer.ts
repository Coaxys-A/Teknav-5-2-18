import { Injectable } from '@nestjs/common';
import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed, Job, Queue } from 'bullmq';
import { BaseConsumer } from '../services/base-consumer.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueConfigService } from '../queue-config.service';
import { QueueEventsService } from '../services/queue-events.service';
import { CircuitBreakerService, Dependency } from '../services/circuit-breaker.service';
import { QuarantineService } from '../services/quarantine.service';
import { JobSlaService } from '../services/job-sla.service';
import { JobType, JobPriority } from '../types/job-envelope';

/**
 * Workflow Step Consumer
 * M11 - Queue Platform: "Workflow Jobs Processing"
 */

@Injectable()
export class WorkflowStepConsumer extends BaseConsumer {
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
      JobType.WORKFLOW_STEP_EXECUTE,
      auditLog,
      prisma,
      queueConfig,
      queueEvents,
      circuitBreaker,
      quarantine,
      jobSla,
    );
  }

  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { workflowInstanceId, stepId, stepType, input, context } = meta;

    this.logger.log(`Processing Workflow Step job: ${aiJobId} (instance: ${workflowInstanceId}, step: ${stepId})`);

    if (!workflowInstanceId || !stepId) {
      throw new Error('Missing required fields: workflowInstanceId, stepId');
    }

    const workflowInstance = await this.prisma.workflowInstance.findUnique({
      where: { id: workflowInstanceId },
      include: { definition: true, createdBy: true },
    });

    if (!workflowInstance) {
      throw new Error(`Workflow Instance not found: ${workflowInstanceId}`);
    }

    const step = await this.prisma.workflowStep.findUnique({
      where: { id: stepId },
      include: { definition: true },
    });

    if (!step) {
      throw new Error(`Workflow Step not found: ${stepId}`);
    }

    await this.executeWorkflowStep(workflowInstance, step, input, context);

    return { success: true, workflowInstanceId, stepId };
  }

  private async executeWorkflowStep(workflowInstance: any, step: any, input: any, context: any): Promise<void> {
    this.logger.log(`Executing step ${step.name} of type ${step.type}`);

    try {
      switch (step.type) {
        case 'ai_task':
          await this.executeAiTaskStep(workflowInstance, step, input, context);
          break;
        case 'notification':
          await this.executeNotificationStep(workflowInstance, step, input, context);
          break;
        case 'delay':
          await this.executeDelayStep(workflowInstance, step, input, context);
          break;
        case 'condition':
          await this.executeConditionStep(workflowInstance, step, input, context);
          break;
        case 'webhook':
          await this.executeWebhookStep(workflowInstance, step, input, context);
          break;
        case 'data_update':
          await this.executeDataUpdateStep(workflowInstance, step, input, context);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      await this.prisma.workflowStepExecution.create({
        data: {
          stepId: step.id,
          workflowInstanceId: workflowInstance.id,
          status: 'COMPLETED',
          input: JSON.stringify(input),
          output: JSON.stringify(context),
          executedAt: new Date(),
        },
      });

      this.logger.log(`Step ${step.name} completed successfully`);
    } catch (error: any) {
      this.logger.error(`Step ${step.name} failed: ${error.message}`, error);
      await this.prisma.workflowStepExecution.create({
        data: {
          stepId: step.id,
          workflowInstanceId: workflowInstance.id,
          status: 'FAILED',
          input: JSON.stringify(input),
          output: JSON.stringify({ error: error.message }),
          errorMessage: error.message,
          executedAt: new Date(),
        },
      });
      throw error;
    }
  }

  private async executeAiTaskStep(workflowInstance: any, step: any, input: any, context: any): Promise<any> {
    const pluginId = step.config?.pluginId;
    const hookType = 'onAIResult';

    const envelope = {
      jobType: JobType.PLUGIN_EXECUTE,
      idempotencyKey: `workflow-ai-task-${step.id}-${Date.now()}`,
      priority: JobPriority.NORMAL,
      traceId: workflowInstance.traceId,
      actorId: workflowInstance.createdBy.id,
      tenantId: workflowInstance.tenantId,
      workspaceId: workflowInstance.workspaceId,
      entity: { type: 'WorkflowInstance', id: workflowInstance.id },
      meta: {
        pluginId,
        hookType,
        payload: input,
        context: { ...context, stepId: step.id },
      },
    };

    const result = await this.prisma.plugin.enqueue({
      data: envelope,
    });

    return result;
  }

  private async executeNotificationStep(workflowInstance: any, step: any, input: any, context: any): Promise<any> {
    const { recipients, subject, message } = input;

    const envelope = {
      jobType: JobType.NOTIFICATION_DISPATCH,
      idempotencyKey: `workflow-notification-${step.id}-${Date.now()}`,
      priority: JobPriority.NORMAL,
      traceId: workflowInstance.traceId,
      actorId: workflowInstance.createdBy.id,
      tenantId: workflowInstance.tenantId,
      workspaceId: workflowInstance.workspaceId,
      entity: { type: 'WorkflowInstance', id: workflowInstance.id },
      meta: {
        userIds: recipients,
        title: subject,
        message,
        type: 'INFO',
      },
    };

    const result = await this.prisma.notification.enqueue({
      data: envelope,
    });

    return result;
  }

  private async executeDelayStep(workflowInstance: any, step: any, input: any, context: any): Promise<any> {
    const duration = step.config?.duration || 5000;
    this.logger.debug(`Delaying for ${duration}ms`);

    await new Promise(resolve => setTimeout(resolve, duration));

    return { delayed: true, durationMs: duration };
  }

  private async executeConditionStep(workflowInstance: any, step: any, input: any, context: any): Promise<any> {
    const condition = step.config?.condition;
    const expectedValue = step.config?.expectedValue;

    const actualValue = this.evaluateExpression(condition, input, context);

    const conditionMet = actualValue === expectedValue;

    this.logger.debug(`Condition evaluation: ${condition} => ${actualValue} (expected: ${expectedValue}) = ${conditionMet}`);

    return {
      type: 'condition',
      condition,
      expectedValue,
      actualValue,
      conditionMet,
    };
  }

  private async executeWebhookStep(workflowInstance: any, step: any, input: any, context: any): Promise<any> {
    const url = step.config?.url;
    const method = step.config?.method || 'POST';
    const headers = step.config?.headers || {};
    const body = input;

    this.logger.debug(`Calling webhook: ${method} ${url}`);

    const response = await this.callWebhook(url, method, headers, body);

    return response;
  }

  private async executeDataUpdateStep(workflowInstance: any, step: any, input: any, context: any): Promise<any> {
    const entityType = step.config?.entityType;
    const entityId = step.config?.entityId;
    const updates = step.config?.updates;

    this.logger.debug(`Updating data: ${entityType}:${entityId}`);

    switch (entityType) {
      case 'ARTICLE':
        await this.prisma.article.update({
          where: { id: entityId },
          data: updates,
        });
        break;
      case 'USER':
        await this.prisma.user.update({
          where: { id: entityId },
          data: updates,
        });
        break;
      default:
        throw new Error(`Unsupported entity type: ${entityType}`);
    }

    return { updated: true, entityType, entityId, updates };
  }

  private evaluateExpression(expr: string, input: any, context: any): any {
    const parts = expr.split('.');
    let value = { ...input, ...context };

    for (const part of parts) {
      value = value[part];
    }

    return value;
  }

  private async callWebhook(url: string, method: string, headers: any, body: any): Promise<any> {
    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return data;
  }
}
