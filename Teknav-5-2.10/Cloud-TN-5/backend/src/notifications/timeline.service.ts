import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject, PolicyResult } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';
import { AuditLogService } from '../../logging/audit-log.service';

/**
 * Timeline Service
 *
 * Merges AuditLog, WorkflowInstance, WorkflowStepExecution, Notification.
 * Normalizes into consistent timeline format.
 */

type TimelineEvent = {
  id: string;
  at: Date;
  source: 'audit' | 'workflow' | 'notification' | 'plugin' | 'billing' | 'security';
  actorId: number;
  actorEmail?: string;
  actorName?: string;
  action?: string;
  entityType: string;
  entityId: number;
  severity: 'info' | 'warn' | 'error';
  title: string;
  message: string;
  meta?: Record<string, any>;
};

@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyEngine: PolicyEngineService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Get Global Timeline
   */
  async getGlobalTimeline(
    actor: any,
    filters: {
      workspaceId?: number;
      severity?: string;
      type?: string;
      from?: Date;
      to?: Date;
      page: number;
      pageSize: number;
      sort?: 'at';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ data: TimelineEvent[]; total: number }> {
    // 1. Policy Check (READ)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.AUDIT_LOG,
      resource: { workspaceId: filters.workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    const events: TimelineEvent[] = [];

    // 2. Fetch Audit Logs
    const auditWhere: any = {};
    if (filters.workspaceId) auditWhere.workspaceId = filters.workspaceId;
    if (filters.severity) auditWhere.severity = filters.severity;
    if (filters.from) auditWhere.createdAt = { gte: filters.from };
    if (filters.to) auditWhere.createdAt = { lte: filters.to };

    const auditLogs = await this.prisma.auditLog.findMany({
      where: auditWhere,
      orderBy: { createdAt: filters.order || 'desc' },
      take: filters.pageSize,
      skip: (filters.page - 1) * filters.pageSize,
    });

    for (const log of auditLogs) {
      events.push(this.mapAuditLog(log));
    }

    // 3. Fetch Workflow Instances (Limit to recent)
    const workflowWhere: any = {};
    if (filters.workspaceId) workflowWhere.workspaceId = filters.workspaceId;

    const workflowInstances = await this.prisma.workflowInstance.findMany({
      where: workflowWhere,
      orderBy: { createdAt: filters.order || 'desc' },
      take: filters.pageSize,
    });

    for (const instance of workflowInstances) {
      events.push(this.mapWorkflowInstance(instance));
    }

    // 4. Fetch Notifications (Limit to recent)
    const notificationWhere: any = {};
    if (filters.workspaceId) notificationWhere.workspaceId = filters.workspaceId;

    const notifications = await this.prisma.notification.findMany({
      where: notificationWhere,
      orderBy: { createdAt: filters.order || 'desc' },
      take: filters.pageSize,
    });

    for (const notif of notifications) {
      events.push(this.mapNotification(notif));
    }

    // 5. Merge & Sort
    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    const total = events.length;
    const paginated = events.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize);

    return { data: paginated, total };
  }

  /**
   * Get Entity Timeline
   */
  async getEntityTimeline(
    actor: any,
    entityType: string,
    entityId: number,
  ): Promise<TimelineEvent[]> {
    const events: TimelineEvent[] = [];

    // 1. Fetch Audit Logs for entity
    const auditLogs = await this.prisma.auditLog.findMany({
      where: { resource: { startsWith: `${entityType}:${entityId}` } },
      orderBy: { createdAt: 'desc' },
    });

    for (const log of auditLogs) {
      events.push(this.mapAuditLog(log));
    }

    // 2. Fetch Workflow Instances (if entity is Article/Workflow)
    if (entityType === 'Article' || entityType === 'WorkflowDefinition') {
      const instanceIds = (entityType === 'Article')
        ? (await this.prisma.article.findUnique({ where: { id: entityId }, select: { workflowInstances: true } })).workflowInstances
        : [];

      // (Mock logic for workflow instances related to entity)
      // For MVP, we just fetch instances directly if entity is Workflow
      let instances = [];
      if (entityType === 'WorkflowDefinition') {
        instances = await this.prisma.workflowInstance.findMany({
          where: { definitionId: entityId },
          orderBy: { createdAt: 'desc' },
        });
      }

      for (const instance of instances) {
        events.push(this.mapWorkflowInstance(instance));
      }
    }

    // 3. Fetch Notifications
    const notifications = await this.prisma.notification.findMany({
      where: {
        OR: [
          { link: { contains: `${entityType.toLowerCase()}/${entityId}` } },
          { metadata: { path: ['entityType'], equals: entityType } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const notif of notifications) {
      events.push(this.mapNotification(notif));
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return events;
  }

  private mapAuditLog(log: any): TimelineEvent {
    return {
      id: `audit-${log.id}`,
      at: log.createdAt,
      source: 'audit',
      actorId: log.actorUserId,
      action: log.action,
      entityType: this.extractEntityType(log.resource),
      entityId: this.extractEntityId(log.resource),
      severity: this.mapSeverity(log.action),
      title: log.action,
      message: log.resource,
      meta: log.payload,
    };
  }

  private mapWorkflowInstance(instance: any): TimelineEvent {
    const status = instance.status === 'FAILED' ? 'error' : 'info';
    return {
      id: `workflow-instance-${instance.id}`,
      at: instance.startedAt,
      source: 'workflow',
      actorId: instance.startedBy,
      entityType: 'WorkflowInstance',
      entityId: instance.id,
      severity: status,
      title: `Workflow ${instance.definitionId}`,
      message: instance.status,
      meta: {
        definitionId: instance.definitionId,
        triggerContext: instance.triggerContext,
      },
    };
  }

  private mapNotification(notif: any): TimelineEvent {
    const severity = notif.type === 'error' ? 'error' : 'info';
    return {
      id: `notification-${notif.id}`,
      at: notif.createdAt,
      source: 'notification',
      actorId: notif.recipientUserId,
      entityType: 'Notification',
      entityId: notif.id,
      severity,
      title: notif.title,
      message: notif.message,
      meta: notif.metadata,
    };
  }

  private mapSeverity(action: string): 'info' | 'warn' | 'error' {
    if (action.includes('reject') || action.includes('fail') || action.includes('delete')) return 'error';
    if (action.includes('warn') || action.includes('rate')) return 'warn';
    return 'info';
  }

  private extractEntityType(resource: string): string {
    if (!resource) return 'Unknown';
    const [type] = resource.split(':');
    return type || 'Unknown';
  }

  private extractEntityId(resource: string): number {
    if (!resource) return 0;
    const [_, id] = resource.split(':');
    return parseInt(id) || 0;
  }
}
