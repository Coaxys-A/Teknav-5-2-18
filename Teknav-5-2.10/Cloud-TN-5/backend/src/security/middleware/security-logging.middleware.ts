import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { AuditDecorator } from '../../../common/decorators/audit.decorator';

/**
 * Security Logging Middleware
 *
 * Logs IP, Geo to AuditLog.
 * Detects anomalies (UA/IP jump).
 * Checks Bans.
 */

@Injectable()
export class SecurityLoggingMiddleware implements NestMiddleware {
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly GEO_HEADERS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-geo-country', 'x-forwarded-for', 'x-real-ip']; // Best effort headers

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // 1. Extract IP
    const ip = this.extractIp(req);

    // 2. Check Bans
    const isBanned = await this.checkBan(ip, req.user?.id);
    if (isBanned) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'IP or User is banned' });
    }

    // 3. Extract Geo (Best Effort)
    const geo = this.extractGeo(req);

    // 4. Log Request (Specific actions only)
    // We don't log every request to avoid spam. We log sensitive actions.
    // This middleware mostly provides data to AuditLog via decorators.
    // But we can add context to request object for decorators to pick up.
    
    req.securityContext = {
      ip,
      ua: req.headers['user-agent'] || req.get('User-Agent'),
      geo,
      riskFlags: [],
    };

    // 5. Detect Anomalies (Session Hardening Check)
    if (req.user && req.user.sessionId) {
      const anomalies = await this.detectAnomalies(req.user.sessionId, req.securityContext);
      if (anomalies.length > 0) {
        req.securityContext.riskFlags = anomalies;
        
        // Log Security Event
        await this.auditLog.logAction({
          actorUserId: req.user.userId,
          action: 'security.anomaly.detected',
          resource: 'Session',
          payload: {
            sessionId: req.user.sessionId,
            ip,
            ua: req.securityContext.ua,
            geo,
            anomalies,
          },
        });

        // Optionally revoke session if critical
        if (anomalies.includes('CRITICAL_IP_JUMP') || anomalies.includes('CRITICAL_UA_CHANGE')) {
          return res.status(403).json({ code: 'FORBIDDEN', message: 'Session revoked due to suspicious activity' });
        }
      }
    }

    next();
  }

  /**
   * Extract IP
   */
  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    const realIp = req.headers['x-real-ip'];
    
    if (forwarded) {
      return (forwarded as string).split(',')[0];
    }
    if (realIp) {
      return realIp as string;
    }
    return req.socket.remoteAddress || req.ip || '0.0.0.0';
  }

  /**
   * Extract Geo (Best Effort)
   */
  private extractGeo(req: Request): { country?: string; region?: string; city?: string } | null {
    for (const header of this.GEO_HEADERS) {
      const value = req.headers[header];
      if (value) {
        if (header.includes('country')) return { country: value as string };
        if (header.includes('region')) return { region: value as string };
        if (header.includes('city')) return { city: value as string };
      }
    }
    return null;
  }

  /**
   * Check Ban
   */
  private async checkBan(ip: string, userId?: number): Promise<boolean> {
    const keys: string[] = [];

    if (ip) {
      keys.push(`${this.REDIS_PREFIX}:ban:ip:${ip}`);
    }
    if (userId) {
      keys.push(`${this.REDIS_PREFIX}:ban:user:${userId}`);
    }

    if (keys.length === 0) return false;

    const results = await Promise.all(keys.map(k => this.redis.redis.exists(k)));
    return results.some(count => count === 1);
  }

  /**
   * Detect Anomalies (Session Hardening)
   */
  private async detectAnomalies(sessionId: string, currentContext: any): Promise<string[]> {
    const key = `${this.REDIS_PREFIX}:sess:${sessionId}`;
    const stored = await this.redis.redis.get(key);

    if (!stored) {
      return []; // First request or cache expired
    }

    const sessionData = JSON.parse(stored);
    const anomalies: string[] = [];

    // 1. UA Mismatch
    if (currentContext.ua !== sessionData.uaHash) {
      anomalies.push('UA_MISMATCH');
    }

    // 2. IP Jump (Check first two octets)
    if (currentContext.ip && sessionData.ipPrefix) {
      const currentPrefix = currentContext.ip.split('.').slice(0, 2).join('.');
      if (currentPrefix !== sessionData.ipPrefix) {
        anomalies.push('IP_JUMP');
      }
    }

    return anomalies;
  }

  // Helper to store session context (Used by AuthController)
  async storeSessionContext(sessionId: string, ip: string, ua: string): Promise<void> {
    const key = `${this.REDIS_PREFIX}:sess:${sessionId}`;
    const data = {
      ipPrefix: ip ? ip.split('.').slice(0, 2).join('.') : null,
      uaHash: ua,
      issuedAt: new Date().toISOString(),
    };
    await this.redis.redis.set(key, JSON.stringify(data), 'EX', 86400); // 24h
  }
}
