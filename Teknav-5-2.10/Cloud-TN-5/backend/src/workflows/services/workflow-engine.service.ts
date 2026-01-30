import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { EventBusService } from '../../notifications/event-bus.service';
import { QueueProducerService } from '../../queues/queue-producer.service';

/**
 * Workflow Engine Service (Workstream 2)
 * 
 * Requirements:
 * - State Machine (JSON Definition)
 * - Risk-Adaptive Routing
 * - Tasks (Review, Approval, Legal, SEO)
 * - Idempotent Transitions
 * - Audit + Events
 */

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
    private readonly queueProducer: QueueProducerService,
  ) {}

  /**
   * Start Workflow Run
   * 
   * Usage: `await workflowEngine.startRun(articleId);`
   */
  async startRun(actor: any, contentId: number) {
    // 1. Fetch Content
    const content = await this.prisma.article.findFirst({
      where: { id: contentId, tenantId: actor.tenantId },
      include: { workspace: true },
    });

    if (!content) {
      throw new NotFoundException('Content not found');
    }

    // 2. Fetch Workflow Definition (Active, Workspace, ContentType)
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: {
        tenantId: actor.tenantId,
        workspaceId: content.workspaceId,
        contentType: content.type,
        active: true,
      },
    });

    if (!definition) {
      this.logger.log(`No workflow definition for type: ${content.type}`);
      // If no workflow defined, skip (Content can publish directly).
      return null;
    }

    // 3. Validate Definition JSON
    const def = definition.jsonDefinition as any;
    if (!def || !def.states || !def.transitions) {
      throw new Error('Invalid workflow definition JSON');
    }

    // 4. Create Workflow Instance
    const instance = await this.prisma.workflowInstance.create({
      data: {
        tenantId: actor.tenantId,
        contentId,
        definitionId: definition.id,
        state: 'PENDING',
        startedAt: new Date(),
      },
    });

    this.logger.log(`Workflow run started: ${instance.id} for content: ${contentId}`);

    // 5. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.run.started',
      resource: `WorkflowInstance:${instance.id}`,
      payload: {
        contentId,
        definitionId: definition.id,
      },
    });

    // 6. Emit Event
    await this.eventBus.publish('teknav:workflows:events', {
      id: instance.id,
      type: 'workflow.run.started',
      timestamp: new Date(),
      payload: {
        tenantId: actor.tenantId,
        contentId,
        definitionId: definition.id,
      },
    });

    // 7. Enqueue Execution Job (Async Task Processing)
    // Enqueue to `workflow-execution` queue (from Part 7)
    // The job will pick up `instance.id` and process initial tasks.
    await this.queueProducer.enqueueWorkflow(actor.tenantContext, {
      workflowInstanceId: instance.id,
    });

    return instance;
  }

  /**
   * Transition Workflow Run
   * 
   * Usage: `await workflowEngine.transition(runId, 'approve', actorContext);`
   * 
   * Handles:
   * - State Machine Validation
   * - Role Checks (RBAC)
   * - Risk-Adaptive Routing
   */
  async transition(
    actor: any,
    runId: number,
    transitionName: string,
    options?: { skipRoleCheck?: boolean },
  ) {
    // 1. Fetch Instance & Definition
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: runId, tenantId: actor.tenantId },
      include: { definition: true },
    });

    if (!instance) {
      throw new NotFoundException('Workflow run not found');
    }

    // 2. Validate Transition (Against JSON Definition)
    const def = instance.definition.jsonDefinition as any;
    const transition = def.transitions[transitionName];

    if (!transition) {
      throw new Error(`Invalid transition: ${transitionName}`);
    }

    if (instance.state !== transition.from) {
      throw new Error(`Invalid state transition: ${instance.state} -> ${transition.to}`);
    }

    // 3. Check Required Roles (RBAC)
    // Requirement D: "RBAC must be enforced server-side"
    if (!options?.skipRoleCheck) {
      const hasRole = actor.roles?.some(r => transition.roles?.includes(r));
      if (!hasRole) {
        // Throw 403 Forbidden
        throw new ForbiddenException(`Role required for '${transitionName}': ${transition.roles.join(', ')}`);
      }
    }

    // 4. Risk-Adaptive Routing (Innovation Layer)
    // "if risk score >= threshold -> legal review step required"
    // We'll use a simple heuristic (Content Type, New User) for MVP.
    let newState = transition.to;
    if (transitionName === 'start') {
      // Check Risk on Start
      const isHighRisk = await this.assessRisk(actor, instance.contentId);
      if (isHighRisk) {
        // Override State to require Legal Review
        newState = 'LEGAL_REVIEW';
      }
    }

    // 5. Update Instance State
    const updated = await this.prisma.workflowInstance.update({
      where: { id: runId },
      data: {
        state: newState,
      },
    });

    this.logger.log(`Workflow transitioned: ${runId} ${transitionName} -> ${newState}`);

    // 6. Write Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'workflow.transitioned',
      resource: `WorkflowInstance:${runId}`,
      payload: {
        transitionName,
        from: instance.state,
        to: newState,
      },
    });

    // 7. Emit Event
    await this.eventBus.publish('teknav:workflows:events', {
      id: `trans-${runId}-${Date.now()}`,
      type: 'workflow.transitioned',
      timestamp: new Date(),
      payload: {
        instanceId: runId,
        transition: transitionName,
        state: newState,
      },
    });

    // 8. Enqueue Next Tasks (Based on New State)
    // We'll enqueue a job to create tasks for the new state.
    await this.queueProducer.enqueueWorkflow(actor.tenantContext, {
      workflowInstanceId: runId,
      transitionName,
    });

    return updated;
  }

  /**
   * Complete Task
   * 
   * Usage: `await workflowEngine.completeTask(taskId, 'approved', actorContext);`
   * 
   * Handles:
   * - Updating Task Status
   * - Trigering Next Transitions
   */
  async completeTask(
    actor: any,
    taskId: number,
    decision: 'APPROVED' | 'REJECTED' | 'SKIPPED',
    actorContext: any,
  ) {
    // 1. Fetch Task & Instance
    const task = await this.prisma.workflowTask.findFirst({
      where: { id: taskId, tenantId: actor.tenantId },
      include: { run: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // 2. Idempotency Check
    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
      this.logger.log(`Task already completed: ${taskId}`);
      return task.run; // Return instance
    }

    // 3. Update Task Status
    await this.prisma.workflowTask.update({
      where: { id: taskId },
      data: {
        status: decision,
      },
    });

    this.logger.log(`Task completed: ${taskId} with decision: ${decision}`);

    // 4. Check if All Required Tasks Complete
    const tasks = await this.prisma.workflowTask.findMany({
      where: { runId: task.runId, type: { in: ['APPROVAL', 'LEGAL', 'SEO', 'AI_SAFETY'] } }, // Required tasks
    });

    const allComplete = tasks.every(t => t.status === 'APPROVED' || t.status === 'SKIPPED');

    // 5. Trigger Transition (If All Complete)
    if (allComplete) {
      const nextTransition = decision === 'APPROVED' ? 'approve' : 'reject';
      await this.transition(actor, task.runId, nextTransition);
    }

    return task.run;
  }

  /**
   * Assess Risk (Innovation Layer)
   * 
   * Logic:
   * - If Content Type is OP_ED (Opinion Editor) AND Author is New (< 7 days old).
   * - Return TRUE (High Risk).
   */
  private async assessRisk(actor: any, contentId: number): Promise<boolean> {
    const content = await this.prisma.article.findUnique({
      where: { id: contentId },
      select: { type: true, createdBy: true, createdAt: true },
    });

    if (!content) return false;

    // Rule 1: OP_ED Content
    if (content.type !== 'OP_ED') return false;

    // Rule 2: New Author (7 days)
    const authorJoinDate = new Date(); // Stub: Assume User joined 7 days ago.
    // In real app, `User.createdAt`.
    const isRecent = (Date.now() - authorJoinDate.getTime()) < 7 * 24 * 60 * 60 * 1000;

    if (isRecent) {
      return true;
    }

    return false;
  }

  /**
   * Get Workflow Run (For Admin UI)
   */
  async getWorkflowRun(actor: any, runId: number) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: runId, tenantId: actor.tenantId },
      include: {
        definition: true,
        tasks: true,
        content: true, // Assuming relation
      },
    });

    if (!instance) {
      throw new NotFoundException('Workflow run not found');
    }

    return instance;
  }
}
