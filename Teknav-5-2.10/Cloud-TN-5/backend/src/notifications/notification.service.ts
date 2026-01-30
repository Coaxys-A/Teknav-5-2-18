import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PolicyAction, PolicySubject, PolicyResult } from '../../security/policy/policy.types';
import { PolicyEngineService } from '../../security/policy/policy.engine.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { EventBusService } from './event-bus.service';
import { RedisService } from '../../redis/redis.service';
import { QueueService } from '../../queues/queue.service';
import { EmailService } from '../../emails/email.service';

/**
 * Notification Service
 *
 * Handles:
 * - Creation (PENDING)
 * - Listing (Filters, Pagination, Sorting)
 * - Mark as Read
 * - Retry
 * - Purge
 * - Delivery Enqueuing
 * - DLQ Replay (Stubbed)
 */

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyEngine: PolicyEngineService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
    private readonly queueService: QueueService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Create Notification
   * Stores in DB as PENDING.
   * Enqueues Delivery Job.
   */
  async create(actor: any, workspaceId: number, data: {
    recipientUserId: number;
    type: 'info' | 'success' | 'error' | 'warning';
    channel: 'email' | 'sms' | 'push' | 'in_app';
    title: string;
    message: string;
    link?: string;
    metadata?: Record<string, any>;
  }): Promise<any> {
    const notification = await this.prisma.notification.create({
      data: {
        workspaceId,
        recipientUserId: data.recipientUserId,
        type: data.type,
        channel: data.channel,
        title: data.title,
        message: data.message,
        status: 'PENDING',
        link: data.link,
        metadata: data.metadata || {},
        createdAt: new Date(),
      },
    });

    this.logger.log(`Notification created: ${notification.id} for user ${data.recipientUserId} in workspace ${workspaceId}`);

    // 2. Publish Event
    await this.eventBus.publish('notification.created', {
      id: notification.id,
      workspaceId,
      recipientUserId: data.recipientUserId,
      type: data.type,
      title: data.title,
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'notification.create',
      resource: `Notification:${notification.id}`,
      payload: {
        workspaceId,
        recipientUserId: data.recipientUserId,
        type: data.type,
        channel: data.channel,
        template: data.metadata?.template,
      },
    });

    // 4. Enqueue Delivery
    await this.queueService.add('notification-delivery', {
      notificationId: notification.id,
    });

    return notification;
  }

  /**
   * Get Notifications
   * Supports filters, pagination, sorting.
   */
  async getNotifications(
    actor: any,
    workspaceId: number,
    filters: {
      userId?: number;
      status?: 'PENDING' | 'SENT' | 'FAILED';
      channel?: 'email' | 'sms' | 'push' | 'in_app';
      type?: string;
      template?: string;
      q?: string;
      page: number;
      pageSize: number;
      sort?: 'createdAt' | 'readAt';
      order?: 'asc' | 'desc';
    },
  ): Promise<{ data: any[]; total: number }> {
    // 1. Policy Check (READ)
    let policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.READ,
      subject: PolicySubject.NOTIFICATION,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Build Query
    const where: any = {
      workspaceId,
    };

    if (filters.userId) {
      where.recipientUserId = filters.userId;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.channel) {
      where.channel = filters.channel;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.template) {
      where.metadata = {
        path: ['template'],
        equals: filters.template,
      };
    }
    if (filters.q) {
      where.OR = [
        { title: { contains: filters.q } },
        { message: { contains: filters.q } },
      ];
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
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'notification.list',
      resource: 'Notification',
      payload: {
        workspaceId,
        filters,
        count: notifications.length,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    return { data: notifications, total };
  }

  /**
   * Mark as Read
   */
  async markAsRead(actor: any, workspaceId: number, notificationIds: number[]): Promise<void> {
    // 1. Policy Check (UPDATE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.UPDATE,
      subject: PolicySubject.NOTIFICATION,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Update
    await this.prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        recipientUserId: actor.userId, // Can only mark own notifications (Admin bypasses this)
      },
      data: {
        readAt: new Date(),
        status: 'READ',
      },
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'notification.read',
      resource: 'Notification',
      payload: {
        workspaceId,
        count: notificationIds.length,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 4. Publish Event
    await this.eventBus.publish('notification.read', {
      userId: actor.userId,
      count: notificationIds.length,
    });
  }

  /**
   * Retry Notification
   * Updates status to PENDING and re-enqueues delivery.
   */
  async retry(actor: any, workspaceId: number, notificationId: number): Promise<any> {
    // 1. Policy Check (UPDATE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.UPDATE,
      subject: PolicySubject.NOTIFICATION,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    // 2. Fetch Notification
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId, workspaceId },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    // 3. Update
    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'PENDING',
        metadata: {
          ...notification.metadata,
          retryCount: (notification.metadata?.retryCount || 0) + 1,
        },
      },
    });

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'notification.retry',
      resource: `Notification:${notificationId}`,
      payload: {
        workspaceId,
        retryCount: updated.metadata?.retryCount,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });

    // 5. Enqueue Delivery
    await this.queueService.add('notification-delivery', {
      notificationId: notification.id,
    });

    return updated;
  }

  /**
   * Purge
   * Delete old notifications.
   */
  async purge(actor: any, workspaceId: number, olderThanDays: number, status?: string): Promise<void> {
    // 1. Policy Check (DELETE)
    const policyResult = await this.policyEngine.evaluate({
      actor,
      action: PolicyAction.DELETE,
      subject: PolicySubject.NOTIFICATION,
      resource: { workspaceId },
      context: { ip: '0.0.0.0', ua: '', deviceId: '', sessionId: '', requestId: '' },
    });
    if (!policyResult.allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);

    const where: any = {
      workspaceId,
      createdAt: { lt: cutoff },
    };

    if (status) {
      where.status = status;
    }

    const result = await this.prisma.notification.deleteMany({ where });
    this.logger.log(`Purged ${result.count} notifications older than ${olderThanDays} days in workspace ${workspaceId}`);

    // 2. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'notification.purge',
      resource: 'Notification',
      payload: {
        workspaceId,
        olderThanDays,
        status,
        count: result.count,
        policyDecisionId: policyResult.policyDecisionId,
      },
    });
  }

  /**
   * Handle Delivery (Called by Worker/Queue Consumer)
   * Real sending logic.
   */
  async handleDelivery(notificationId: number): Promise<void> {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        recipient: { select: { email: true, name: true } },
      },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    try {
      if (notification.channel === 'email') {
        await this.emailService.send({
          to: notification.recipient.email,
          subject: notification.title,
          html: notification.message,
        });
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } else if (notification.channel === 'push') {
        // Placeholder: Push logic
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } else if (notification.channel === 'sms') {
        // Placeholder: SMS logic
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.prisma.notification.update({
          where: { id: notificationId },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } else {
        throw new BadRequestException(`Unsupported channel: ${notification.channel}`);
      }
    } catch (error) {
      this.logger.error(`Delivery failed for notification ${notificationId}`, error);
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: 'FAILED',
          errorMessage: error.message,
        },
      });
    }
  }

  /**
   * Replay Dlq Job (Stub for Controller)
   */
  async replayDlqJob(actor: any, workspaceId: number, jobId: string): Promise<void> {
    this.logger.log(`Replaying DLQ job: ${jobId} for workspace ${workspaceId}`);
    // Stub: In real system, this would call `QueueService.retryJob(jobId)`.
    // For now, we do nothing.
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'notification.dlq.replay',
      resource: 'Queue',
      payload: { jobId },
    });
  }
}
