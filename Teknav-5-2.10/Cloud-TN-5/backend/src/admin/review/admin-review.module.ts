import { Module } from '@nestjs/common';
import { AdminReviewController } from './admin-review.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { PolicyModule } from '../../security/policy/policy.module';
import { AuditLogModule } from '../../logging/audit-log.module';
import { RedisModule } from '../../redis/redis.module';
import { NotificationModule } from '../notifications/notification.module';

/**
 * Admin/Editor Review Module
 */

@Module({
  imports: [PrismaModule, PolicyModule, AuditLogModule, RedisModule, NotificationModule],
  providers: [AdminReviewController],
  exports: [AdminReviewController],
})
export class AdminReviewModule {}
