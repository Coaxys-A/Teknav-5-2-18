import { Controller, Get, HttpCode } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { EventBusService } from '../../notifications/event-bus.service';

/**
 * Health Controller
 * M5 - Analytics: "Diagnostics panel" section.
 * 
 * GET /api/owner/health/logging
 * 
 * Validates:
 * - DB connectivity
 * - Redis connectivity
 * - Audit Write capability
 * - PubSub test
 */

@Controller('api/owner/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  @Get('logging')
  @HttpCode(HttpStatus.OK)
  async checkLoggingHealth() {
    const checks = {
      db: 'unknown',
      redis: 'unknown',
      auditWrite: 'unknown',
      pubsub: 'unknown',
    };

    // 1. Check DB
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch (error) {
      checks.db = 'error: ' + error.message;
    }

    // 2. Check Redis
    try {
      await this.redis.redis.ping();
      checks.redis = 'ok';
    } catch (error) {
      checks.redis = 'error: ' + error.message;
    }

    // 3. Check Audit Write
    try {
      await this.auditLog.logAction({
        actorUserId: 0, // System
        action: 'health.check',
        resource: 'AuditLog',
        payload: { timestamp: new Date() },
      });
      checks.auditWrite = 'ok';
    } catch (error) {
      checks.auditWrite = 'error: ' + error.message;
    }

    // 4. Check PubSub
    try {
      await this.eventBus.publish('health.test', { timestamp: new Date() });
      checks.pubsub = 'ok';
    } catch (error) {
      checks.pubsub = 'error: ' + error.message;
    }

    return { data: checks };
  }
}
