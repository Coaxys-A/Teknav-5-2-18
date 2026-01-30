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
 * Workflow Consumer
 * M11 - Queue Platform: "Workflow Jobs Processing"
 *
 * Processes:
 * - Run workflow instances
 * - Execute workflow steps
 * - Retry step execution on failure
 * - Schedule cron triggers
 */

@Injectable()
export class WorkflowConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.POSTGRES];

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
      JobType.WORKFLOW_RUN,
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
   * Process Workflow Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { workflowInstanceId, workflowDefinitionId, stepId } = meta;

    this.logger.log(`Processing Workflow job: ${aiJobId} (instance: ${workflowInstanceId}, step: ${stepId})`);

    // 1. Validate inputs
    if (!workflowInstanceId) {
      throw new Error('Missing required field: workflowInstanceId');
    }

    // 2. Get workflow instance
    const workflowInstance = await this.prisma.workflowInstance.findUnique({
      where: { id: workflowInstanceId },
      include: {
        definition: true,
        createdBy: true,
      },
    });

    if (!workflowInstance) {
      throw new Error(`Workflow instance not found: ${workflowInstanceId}`);
    }

    // 3. Get workflow steps
    const steps = (workflowInstance.definition.definition as any)?.steps || [];

    if (steps.length === 0) {
      throw new Error(`Workflow has no steps: ${workflowDefinitionId}`);
    }

    // 4. Execute workflow steps
    const results = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepIndex = i;

      try {
        // Update progress
        await this.updateProgress(aiJobId, i + 1, steps.length);

        // Execute step
        const stepResult = await this.executeStep(
          workflowInstanceId,
          workflowInstance.id,
          step.id,
          step.type,
          step.config,
          workflowInstance.context,
        );

        results.push({
          stepId: step.id,
          stepIndex,
          status: 'completed',
          result: stepResult,
        });

        // Update workflow context with step result
        workflowInstance.context = {
          ...(workflowInstance.context as object),
          [step.id]: stepResult,
        };

        // Log step completion
        await this.auditLog.logAction({
          actorUserId: actorId || null,
          action: 'workflow.step.completed',
          resource: `WorkflowInstance:${workflowInstanceId}`,
          payload: {
            stepId: step.id,
            stepIndex,
            result: stepResult,
          },
        });
      } catch (error: any) {
        // Step failed
        results.push({
          stepId: step.id,
          stepIndex,
          status: 'failed',
          error: error.message,
        });

        // Check if step has retry policy
        const retryConfig = step.retry || { maxAttempts: 3, delay: 5000 };
        const stepAttempts = (workflowInstance.stepAttempts as Record<string, number>)?.[step.id] || 0;

        if (stepAttempts < retryConfig.maxAttempts) {
          // Retry step
          this.logger.warn(`Step failed, retrying: ${step.id} (attempt ${stepAttempts + 1}/${retryConfig.maxAttempts})`);

          // Store retry count
          const stepAttemptsRecord = (workflowInstance.stepAttempts as Record<string, number>) || {};
          stepAttemptsRecord[step.id] = stepAttempts + 1;

          await this.prisma.workflowInstance.update({
            where: { id: workflowInstanceId },
            data: {
              stepAttempts: stepAttemptsRecord,
            },
          });

          // Throw error to trigger retry
          throw error;
        } else {
          // Max retries exceeded, fail workflow
          await this.prisma.workflowInstance.update({
            where: { id: workflowInstanceId },
            data: {
              status: 'FAILED',
              finishedAt: new Date(),
              errorMessage: `Step failed: ${step.id} - ${error.message}`,
            },
          });

          this.logger.error(`Workflow failed: ${workflowInstanceId} (step: ${step.id})`);

          // Publish workflow failed event
          await this.queueEvents.jobFailed({
            queueName: job.queueQualifiedName,
            jobType: JobType.WORKFLOW_RUN,
            aiJobId,
            bullJobId: job.id,
            traceId,
            errorSummary: `Step failed: ${step.id}`,
            attemptsMade: job.attemptsMade || 0,
            metadata: { workflowInstanceId, stepId: step.id, stepIndex, results },
          });

          return {
            success: false,
            workflowInstance,
            results,
          };
        }
      }
    }

    // 5. Workflow completed successfully
    await this.prisma.workflowInstance.update({
      where: { id: workflowInstanceId },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
      },
    });

    this.logger.log(`Workflow completed: ${workflowInstanceId}`);

    return {
      success: true,
      workflowInstance,
      results,
    };
  }

  /**
   * Execute workflow step
   */
  private async executeStep(
    workflowInstanceId: number,
    workflowDefinitionId: number,
    stepId: string,
    stepType: string,
    config: any,
    context: any,
  ): Promise<any> {
    this.logger.debug(`Executing step: ${stepId} (type: ${stepType})`);

    switch (stepType) {
      case 'ai_task':
        // Execute AI task
        return await this.executeAiTask(config, context);

      case 'notification':
        // Send notification
        return await this.sendNotification(config, context);

      case 'delay':
        // Add delay
        const delayMs = config.duration || 5000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return { delayed: true };

      case 'condition':
        // Evaluate condition
        return this.evaluateCondition(config, context);

      case 'webhook':
        // Call webhook
        return await this.callWebhook(config, context);

      case 'data_update':
        // Update data
        return await this.updateData(config, context);

      default:
        throw new Error(`Unknown step type: ${stepType}`);
    }
  }

  /**
   * Execute AI task step
   */
  private async executeAiTask(config: any, context: any): Promise<any> {
    const { prompt, model, outputKey } = config;

    if (!prompt) {
      throw new Error('AI task missing prompt');
    }

    // Simulate AI execution (in production, call AI service)
    await new Promise(resolve => setTimeout(resolve, 2000));

    const result = `AI generated content for: ${prompt}`;

    return {
      type: 'ai_task',
      result,
      outputKey,
    };
  }

  /**
   * Send notification step
   */
  private async sendNotification(config: any, context: any): Promise<any> {
    const { recipients, subject, message } = config;

    if (!recipients || recipients.length === 0) {
      throw new Error('Notification missing recipients');
    }

    // In production, send via notification/email service
    // For MVP, we'll just log it
    this.logger.debug(`Sending notification to ${recipients.length} recipients`);

    return {
      type: 'notification',
      recipients,
      subject,
      message,
    };
  }

  /**
   * Evaluate condition step
   */
  private evaluateCondition(config: any, context: any): Promise<any> {
    const { expression, expectedValue } = config;

    // Simple evaluation (in production, use more robust expression evaluator)
    const actualValue = context[expression];
    const conditionMet = actualValue === expectedValue;

    return {
      type: 'condition',
      expression,
      expectedValue,
      actualValue,
      conditionMet,
    };
  }

  /**
   * Call webhook step
   */
  private async callWebhook(config: any, context: any): Promise<any> {
    const { url, method, headers, body } = config;

    if (!url) {
      throw new Error('Webhook missing URL');
    }

    // In production, make HTTP request with circuit breaker
    // For MVP, we'll simulate success
    this.logger.debug(`Calling webhook: ${method} ${url}`);

    return {
      type: 'webhook',
      url,
      method,
      status: 200,
    };
  }

  /**
   * Update data step
   */
  private async updateData(config: any, context: any): Promise<any> {
    const { entityType, entityId, updates } = config;

    if (!entityType || !entityId) {
      throw new Error('Data update missing entity info');
    }

    // Update entity based on type
    switch (entityType) {
      case 'Article':
        await this.prisma.article.update({
          where: { id: entityId },
          data: updates,
        });
        break;

      case 'User':
        await this.prisma.user.update({
          where: { id: entityId },
          data: updates,
        });
        break;

      default:
        throw new Error(`Unsupported entity type: ${entityType}`);
    }

    return {
      type: 'data_update',
      entityType,
      entityId,
      updates,
    };
  }

  /**
   * Get circuit breaker config override
   */
  protected getCircuitBreakerConfig(dep: Dependency) {
    if (dep === Dependency.POSTGRES) {
      return {
        failureThreshold: 5,
        resetTimeout: 60000, // 1 minute
        halfOpenMaxCalls: 3,
      };
    }
    return {};
  }
}
