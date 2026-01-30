import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { MeController } from './me.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { SessionModule } from '../../security/session/session.module';
import { AuditLogModule } from '../../logging/audit-log.module';

/**
 * User Module
 */

@Module({
  imports: [PrismaModule, RedisModule, SessionModule, AuditLogModule],
  providers: [UserService, MeController],
  exports: [UserService],
})
export class UserModule {}
