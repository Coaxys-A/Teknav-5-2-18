import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './services/billing.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditLogModule } from '../logging/audit-log.module';
import { NotificationModule } from '../notifications/notification.module';
import { QueueModule } from '../queues/queue.module';

/**
 * Billing Module
 * M3 Milestone: "Membership + paywall v1 (money-safe)"
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
    BillingService,
  ],
  controllers: [
    BillingController,
  ],
  exports: [
    BillingService,
  ],
})
export class BillingModule {}
