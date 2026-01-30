import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './services/events-raw.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditLogModule } from '../logging/audit-log.module';
import { NotificationModule } from '../notifications/notification.module';
import { QueueModule } from '../queues/queue.module'; // For aggregation jobs

/**
 * Analytics Module
 * M5 Milestone: "Analytics that actually drives decisions"
 */

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditLogModule,
    NotificationModule,
    QueueModule,
  ],
  providers: [
    AnalyticsService,
  ],
  controllers: [
    AnalyticsController,
  ],
  exports: [
    AnalyticsService,
  ],
})
export class AnalyticsModule {}
