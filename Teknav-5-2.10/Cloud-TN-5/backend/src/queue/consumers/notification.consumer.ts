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
 * Notification Consumer
 * M11 - Queue Platform: "Notification Jobs Processing"
 *
 * Processes:
 * - Notification dispatch
 * - In-app notifications
 * - Real-time push notifications
 */

@Injectable()
export class NotificationConsumer extends BaseConsumer {
  protected readonly DEFAULT_DEPENDENCIES: Dependency[] = [Dependency.REDIS];

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
      JobType.NOTIFICATION_DISPATCH,
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
   * Process Notification Job
   */
  protected async process(job: Job<any>): Promise<any> {
    const { aiJobId, actorId, tenantId, workspaceId, entity, meta, traceId } = job.data;
    const { userIds, title, message, type, link } = meta;

    this.logger.log(`Processing Notification job: ${aiJobId} (recipients: ${userIds?.length})`);

    // 1. Validate inputs
    if (!userIds || userIds.length === 0 || !title) {
      throw new Error('Missing required fields: userIds, title');
    }

    // 2. Create notification records
    const notifications = await Promise.all(
      userIds.map(async userId => {
        const notification = await this.prisma.notification.create({
          data: {
            userId,
            tenantId,
            workspaceId,
            title,
            message,
            type: type || 'INFO',
            link,
            read: false,
            priority: meta.priority || 'NORMAL',
            createdAt: new Date(),
          },
        });

        // Publish to Redis Pub/Sub for real-time delivery
        await this.publishNotificationEvent(notification);

        return notification;
      }),
    );

    // 3. Log notification dispatch
    await this.auditLog.logAction({
      actorUserId: actorId || null,
      action: 'notification.dispatched',
      resource: 'Notification',
      payload: {
        notificationIds: notifications.map(n => n.id),
        recipientCount: userIds.length,
        type,
      },
    });

    this.logger.log(`Notification job completed: ${aiJobId} (recipients: ${userIds.length})`);

    return {
      success: true,
      notifications,
      recipientCount: userIds.length,
    };
  }

  /**
   * Publish notification event for real-time delivery
   */
  private async publishNotificationEvent(notification: any): Promise<void> {
    const event = {
      id: `notification-${Date.now()}-${Math.random()}`,
      type: 'notification.created',
      timestamp: new Date().toISOString(),
      userId: notification.userId,
      notification: {
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type,
        link: notification.link,
      },
    };

    // Publish to user-specific channel
    await this.prisma.redis?.publish(`teknav:user:${notification.userId}:notifications`, JSON.stringify(event));
  }
}
