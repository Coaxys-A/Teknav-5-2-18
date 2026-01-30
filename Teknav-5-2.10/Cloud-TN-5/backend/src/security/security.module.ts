import { Module } from '@nestjs/common';
import { CsrfService } from './csrf/csrf.service';
import { SessionService } from './session/session.service';
import { SecurityService } from './security/security.service';
import { PolicyEngineService } from '../policies/policy-engine.service';
import { CsrfController } from './csrf/csrf.controller';
import { SecurityController } from './policy-center/security.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AuditLogModule } from '../logging/audit-log.module';
import { NotificationModule } from '../notifications/notification.module';

/**
 * Security Module
 * M10 - Security Center: "RBAC + CSRF + IP/Geo Logging + Session Hardening + Rate Limiting + Bans + Owner/Admin UI"
 */

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditLogModule,
    NotificationModule,
  ],
  providers: [
    CsrfService,
    SessionService,
    SecurityService,
    PolicyEngineService, // Re-import if needed, or shared via PrismaModule? No, separate module.
  ],
  controllers: [
    CsrfController,
    SecurityController,
  ],
  exports: [
    CsrfService,
    SessionService,
    SecurityService,
  ],
})
export class SecurityModule {}
