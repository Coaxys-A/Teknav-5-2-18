import { Module } from '@nestjs/common';
import { WorkflowEngineService } from './services/workflow-engine.service';
import { WorkflowRuntimeService } from './services/workflow-runtime.service';
import { WorkflowController } from './workflow.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditLogModule } from '../logging/audit-log.module';
import { NotificationModule } from '../notifications/notification.module';
import { QueueModule } from '../queues/queue.module';

/**
 * Workflow Module (Refactored)
 * 
 * Workstream 2 - Workflow Engine (Risk-Adaptive, Versioned, Auditable)
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
    WorkflowEngineService,
    WorkflowRuntimeService,
  ],
  controllers: [
    WorkflowController,
  ],
  exports: [
    WorkflowEngineService,
  ],
})
export class WorkflowModule {}
