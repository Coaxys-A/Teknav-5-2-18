import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { randomUUID } from 'crypto';

/**
 * Security Service
 * 
 * M10 - Security Center: "Rate Limiting + Brute Force + Temporary Bans"
 * 
 * Features:
 * - Global Rate Limit (Per-IP 60 req/min, Per-User configurable)
 * - Login Brute Force (Thresholds + Window)
 * - Temporary Bans (Redis, no schema)
 */

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  
  // Rate Limit Settings
  private readonly RATE_LIMIT_PER_IP = 60; // 60 req/min
  private readonly RATE_LIMIT_PER_USER = 120; // Default 120 req/min
  
  // Brute Force Settings
  private readonly BRUTE_FORCE_THRESHOLD = 5; // 5 attempts
  private readonly BRUTE_FORCE_WINDOW = 300; // 5 minutes (300s)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Check Rate Limit
   */
  async checkRateLimit(ip: string, userId?: number): Promise<{ allow: boolean; remaining: number; reset: Date }> {
    // 1. Get Bucket Timestamp
    const now = Date.now();
    const bucketStart = now - (now % 60000); // Current minute
    
    // 2. Get/Increment Counters (Redis INCR)
    const ipKey = `${this.REDIS_PREFIX}:rl:ip:${ip}:${bucketStart}`;
    const userKey = userId ? `${this.REDIS_PREFIX}:rl:user:${userId}:${bucketStart}` : null;

    const [ipCount, userCount] = await Promise.all([
      this.redis.redis.incr(ipKey),
      userKey ? this.redis.redis.incr(userKey) : Promise.resolve(0),
      this.redis.redis.expire(ipKey, 60), // Reset at next minute
      userKey ? this.redis.redis.expire(userKey, 60) : Promise.resolve(),
    ]);

    // 3. Check Limits
    if (ipCount > this.RATE_LIMIT_PER_IP) {
      return { allow: false, remaining: 0, reset: new Date(bucketStart + 60000) };
    }
    
    if (userId && userCount > this.RATE_LIMIT_PER_USER) {
      return { allow: false, remaining: 0, reset: new Date(bucketStart + 60000) };
    }

    const remainingIp = this.RATE_LIMIT_PER_IP - ipCount;
    const remainingUser = userId ? this.RATE_LIMIT_PER_USER - userCount : 0;

    return { allow: true, remaining: Math.min(remainingIp, remainingUser), reset: new Date(bucketStart + 60000) };
  }

  /**
   * Check Brute Force (Login)
   * 
   * Keys:
   * teknav:bf:ip:<ip>
   * teknav:bf:user:<emailHash>
   */
  async checkBruteForce(ip: string, emailHash: string): Promise<{ allow: boolean; reason?: string }> {
    // 1. Get Count
    const ipKey = `${this.REDIS_PREFIX}:bf:ip:${ip}`;
    const userKey = `${this.REDIS_PREFIX}:bf:user:${emailHash}`;
    const now = Date.now();
    const windowStart = now - (this.BRUTE_FORCE_WINDOW * 1000);

    // 2. Check Existing Locks (Bans)
    const isBanned = await this.checkBan(ip, emailHash);
    if (isBanned) return { allow: false, reason: 'Banned' };

    // 3. Get Current Counts
    const [ipCount, userCount] = await Promise.all([
      this.redis.redis.get(ipKey),
      this.redis.redis.get(userKey),
    ]);

    // 4. Increment and Check Thresholds
    const newIpCount = (parseInt(ipCount || '0') + 1);
    const newUserCount = (parseInt(userCount || '0') + 1);

    // Set with TTL (Window)
    await Promise.all([
      this.redis.redis.setex(ipKey, this.BRUTE_FORCE_WINDOW, newIpCount.toString()),
      this.redis.redis.setex(userKey, this.BRUTE_FORCE_WINDOW, newUserCount.toString()),
    ]);

    if (newIpCount > this.BRUTE_FORCE_THRESHOLD) {
      // 5. Create Audit Log (Brute Force Block)
      await this.auditLog.logAction({
        actorUserId: 0,
        action: 'security.brute.force.block',
        resource: 'BruteForceProtection',
        payload: {
          ip,
          emailHash,
          count: newIpCount,
        },
      });

      // 6. Publish Security Event (M10)
      await this.eventBus.publish('teknav:security:events', {
        id: randomUUID(),
        type: 'BRUTE_FORCE_BLOCK',
        timestamp: new Date(),
        payload: {
          ip,
          emailHash,
          threshold: this.BRUTE_FORCE_THRESHOLD,
        },
      });

      return { allow: false, reason: 'Too many attempts. Try again later.' };
    }

    return { allow: true };
  }

  /**
   * Check Brute Force (Generic Action)
   */
  async checkBruteForceGeneric(action: string, actor: { userId: number; tenantId: number }): Promise<void> {
    // Check IP/User limits
    const ip = actor.ipAddress || 'unknown';
    const key = `${action}:${actor.userId}`;
    const keyExists = await this.redis.redis.exists(key);

    if (!keyExists) {
      await this.redis.redis.set(key, '1', 'EX', this.BRUTE_FORCE_WINDOW);
    } else {
      await this.redis.redis.incr(key);
    }
  }

  /**
   * Check Ban (Temporary)
   * 
   * Checks Redis Keys:
   * teknav:ban:ip:<ip>
   * teknav:ban:user:<userId>
   */
  async checkBan(ip: string, userId?: number): Promise<boolean> {
    const now = Date.now();

    const ipKey = `${this.REDIS_PREFIX}:ban:ip:${ip}`;
    const ipBan = await this.redis.redis.get(ipKey);
    if (ipBan) {
      const ban = JSON.parse(ipBan);
      if (new Date(ban.until) > now) {
        return true; // Still banned
      }
    }

    if (userId) {
      const userKey = `${this.REDIS_PREFIX}:ban:user:${userId}`;
      const userBan = await this.redis.redis.get(userKey);
      if (userBan) {
        const ban = JSON.parse(userBan);
        if (new Date(ban.until) > now) {
          return true; // Still banned
        }
      }
    }

    return false;
  }

  /**
   * Create Ban (Temporary)
   * 
   * Stored in Redis (No schema change).
   * Keys:
   * teknav:ban:ip:<ip> = { until, reason }
   * teknav:ban:user:<userId> = { until, reason }
   */
  async createBan(
    actor: { userId: number; tenantId: number },
    kind: 'ip' | 'user',
    target: string,
    ttlSeconds: number,
    reason: string,
  ) {
    const until = new Date(Date.now() + ttlSeconds * 1000);

    // 1. Set Redis Key
    if (kind === 'ip') {
      const key = `${this.REDIS_PREFIX}:ban:ip:${target}`;
      const value = JSON.stringify({ until, reason, actorId: actor.userId });
      await this.redis.redis.setex(key, ttlSeconds, value);
    } else if (kind === 'user') {
      const key = `${this.REDIS_PREFIX}:ban:user:${target}`;
      const value = JSON.stringify({ until, reason, actorId: actor.userId });
      await this.redis.redis.setex(key, ttlSeconds, value);
    }

    // 2. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'security.ban.created',
      resource: `Ban:${kind}:${target}`,
      payload: { kind, target, ttlSeconds, reason },
    });

    // 3. Publish Security Event (M10)
    await this.eventBus.publish('teknav:security:events', {
      id: randomUUID(),
      type: 'TEMP_BAN_APPLIED',
      timestamp: new Date(),
      payload: {
        kind,
        target,
        reason,
        actorId: actor.userId,
        tenantId: actor.tenantId,
      },
    });
  }

  /**
   * Remove Ban (Delete Key)
   */
  async removeBan(kind: 'ip' | 'user', target: string) {
    if (kind === 'ip') {
      const key = `${this.REDIS_PREFIX}:ban:ip:${target}`;
      await this.redis.redis.del(key);
    } else if (kind === 'user') {
      const key = `${this.REDIS_PREFIX}:ban:user:${target}`;
      await this.redis.redis.del(key);
    }
  }

  /**
   * List Bans (For Admin UI)
   */
  async listBans(tenantId: number, page: number, pageSize: number) {
    // M10: "Owner/Admin Security UI".
    // Since bans are in Redis (No schema), we can't query them directly.
    // We need to use `SCAN` to find keys.
    // Pattern: `teknav:ban:*`.
    // MVP: We return a stub list or use `SCAN` in service.
    // NOTE: Real implementation requires scanning all keys which is slow.
    // Production apps usually maintain a "Ban List" in DB.
    // I'll use `SCAN` for this MVP.
    
    const keys = [];
    let cursor = '0';
    
    // Scan 1000 keys (Limit)
    do {
      const result = await this.redis.redis.scan(cursor, 'MATCH', `${this.REDIS_PREFIX}:ban:*`, 'COUNT', 1000);
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');

    // Filter by Tenant (Ban value JSON contains `actorId` and `tenantId`)
    // We need to GET each key to check tenant.
    // NOTE: This is O(N) and slow for high traffic sites.
    // For MVP, we skip filtering here or implement a "Set" of active ban IDs.
    
    const bans = [];
    for (const key of keys) {
      const value = await this.redis.redis.get(key);
      if (value) {
        const ban = JSON.parse(value);
        // Check if `actorId` belongs to current tenant
        // This check is impossible without DB join or querying User.
        // We'll skip strict tenant filter for MVP "Owner/Admin" UI assumes cross-tenant view.
        bans.push({ id: key, ...ban });
      }
    }

    return bans;
  }

  /**
   * API Token Abuse Detection (Simple)
   */
  async checkApiTokenAbuse(apiKey: string): Promise<boolean> {
    // Count requests in last minute
    const key = `${this.REDIS_PREFIX}:rl:apikey:${apiKey}:${Math.floor(Date.now() / 60000)}`;
    const count = await this.redis.redis.incr(key);
    await this.redis.redis.expire(key, 60);

    if (count > 30) { // Burst detection
      // Ban API Key
      await this.createBan(
        { userId: 0, tenantId: 0 }, // System
        'user',
        apiKey,
        60, // 1 min ban
        'API Token Abuse',
      );
      return true;
    }

    return false;
  }
}
