import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { UserNotificationsController } from './user-notification.controller';
import { TimelineController } from './timeline.controller';
import { SseController } from './sse.controller';
import { NotificationService } from './notification.service';
import { EventBusService } from './event-bus.service';
import { TimelineService } from './timeline.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { PolicyModule } from '../../security/policy/policy.module';
import { AuditLogModule } from '../../logging/audit-log.module';
import { RedisModule } from '../../redis/redis.module';
import { QueueModule } from '../../queues/queue.module';
import { EmailModule } from '../../emails/email.module';

/**
 * Notifications Module
 */

@Module({
  imports: [
    PrismaModule,
    PolicyModule,
    AuditLogModule,
    RedisModule,
    QueueModule,
    EmailModule,
  ],
  controllers: [NotificationController, UserNotificationsController, TimelineController, SseController],
  providers: [NotificationService, EventBusService, TimelineService],
  exports: [NotificationService, EventBusService, TimelineService],
})
export class NotificationModule {}
