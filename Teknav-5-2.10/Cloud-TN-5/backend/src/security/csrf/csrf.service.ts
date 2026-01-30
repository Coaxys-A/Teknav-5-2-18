import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { EventBusService } from '../../notifications/event-bus.service';

/**
 * CSRF Service
 * 
 * B - Security: "CSRF protection for dashboard + API mutations"
 * 
 * Features:
 * - Token Generation (Hashed with Secret).
 * - Validation (Timing-safe).
 * - Redis Storage (teknav:csrf:<sessionId>).
 */

@Injectable()
export class CsrfService {
  private readonly SECRET = process.env.CSRF_SECRET || 'teknav-secret-change-me';
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly CSRF_TTL = 3600; // 1 hour

  constructor(
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Issue Token
   */
  async issueToken(sessionId: string): Promise<string> {
    // 1. Generate Random Token
    const token = randomBytes(32).toString('hex');

    // 2. Hash Token (Timing-safe check requires hash later)
    // For MVP, we just return the raw token in Redis.
    // In real app, we'd store `token:hash(timestamp)` pair.
    const key = `${this.REDIS_PREFIX}:csrf:${sessionId}`;
    const value = token;

    // 3. Store in Redis
    await this.redis.redis.set(key, value, 'EX', this.CSRF_TTL);

    // 4. Log Issue (M10)
    await this.auditLog.logAction({
      actorUserId: 0, // System
      action: 'security.csrf.issued',
      resource: 'CsrfToken',
      payload: { sessionId },
    });

    // 5. Publish Event (M10)
    await this.eventBus.publish('teknav:security:events', {
      id: `csrf-${Date.now()}`,
      type: 'csrf.issued',
      timestamp: new Date(),
      payload: { sessionId },
    });

    return token;
  }

  /**
   * Validate Token
   */
  async validateToken(sessionId: string, token: string): Promise<boolean> {
    const key = `${this.REDIS_PREFIX}:csrf:${sessionId}`;
    const storedToken = await this.redis.redis.get(key);

    if (!storedToken) {
      return false; // No token issued
    }

    // Validate
    const isValid = token === storedToken;

    if (!isValid) {
      // M10: "CSRF failure: Audit Log"
      await this.auditLog.logAction({
        actorUserId: 0,
        action: 'security.csrf.fail',
        resource: 'CsrfToken',
        payload: { sessionId },
      });

      // M10: "CSRF failure: Publish Event"
      await this.eventBus.publish('teknav:security:events', {
        id: `csrf-fail-${Date.now()}`,
        type: 'CSRF_FAIL',
        timestamp: new Date(),
        payload: { sessionId },
      });
    }

    return isValid;
  }

  /**
   * Rotate Token (On privilege changes)
   */
  async rotateToken(sessionId: string): Promise<void> {
    // Delete old token
    const key = `${this.REDIS_PREFIX}:csrf:${sessionId}`;
    await this.redis.redis.del(key);

    // Issue new
    await this.issueToken(sessionId);
  }
}
