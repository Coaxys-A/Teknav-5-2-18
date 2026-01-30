import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { WorkspaceController } from './workspace.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { AuditLogModule } from '../../logging/audit-log.module';

/**
 * Workspace Module
 */

@Module({
  imports: [PrismaModule, RedisModule, AuditLogModule],
  providers: [WorkspaceService, WorkspaceController],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
