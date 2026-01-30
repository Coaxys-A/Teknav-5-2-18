import { Injectable, NestMiddleware, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RateLimitService, RateLimitConfig } from '../rate-limit/rate-limit.service';
import { REDIS_KEY_PREFIX } from '../../redis/redis.service';

/**
 * Global Rate Limiting Middleware
 *
 * Enforces rate limits per-IP and per-user for all requests.
 *
 * Features:
 * - Per-IP rate limiting (60 req/min default)
 * - Per-user rate limiting (120 req/min default)
 * - Returns proper headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 */

@Injectable()
export class GlobalRateLimitMiddleware {
  private readonly logger = new Logger(GlobalRateLimitMiddleware.name);

  // Default configurations (can be overridden by env vars)
  private readonly IP_CONFIG: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_IP_PER_MIN || '60'),
    keyPrefix: 'ip',
  };

  private readonly USER_CONFIG: RateLimitConfig = {
    windowMs: 60000, // 1 minute
    maxRequests: parseInt(process.env.RATE_LIMIT_USER_PER_MIN || '120'),
    keyPrefix: 'user',
  };

  // Rate limits for different endpoints (owner/admin get higher limits)
  private readonly OWNER_IP_CONFIG: RateLimitConfig = {
    windowMs: 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_OWNER_PER_MIN || '120'),
    keyPrefix: 'owner:ip',
  };

  private readonly OWNER_USER_CONFIG: RateLimitConfig = {
    windowMs: 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_OWNER_USER_PER_MIN || '120'),
    keyPrefix: 'owner:user',
  };

  constructor(private readonly rateLimit: RateLimitService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // Get client identifier (IP)
      const ip = this.getClientIp(req);
      const ipKey = `${REDIS_KEY_PREFIX}:rl:ip:${ip}`;

      // Get user identifier if authenticated
      const userId = (req as any).user?.id;
      let userKey: string | null = null;
      if (userId) {
        userKey = `${REDIS_KEY_PREFIX}:rl:user:${userId}`;
      }

      // Determine rate limit config based on route and user role
      let config = this.IP_CONFIG;

      // Owner endpoints get higher limits
      if (req.path?.startsWith('/api/owner/')) {
        config = userId ? this.OWNER_USER_CONFIG : this.OWNER_IP_CONFIG;
      }
      // Admin endpoints get moderate limits
      else if (req.path?.startsWith('/api/admin/')) {
        config = userId ? this.USER_CONFIG : this.IP_CONFIG;
      }
      // AI endpoints get higher limits
      else if (req.path?.startsWith('/api/ai/')) {
        config = userId ? this.USER_CONFIG : this.IP_CONFIG;
      }

      // Check IP rate limit
      const ipResult = await this.rateLimit.checkLimit(config, ip);

      // Set headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', ipResult.remaining);
      res.setHeader('X-RateLimit-Reset', new Date(ipResult.resetAt).toISOString());

      if (!ipResult.allowed) {
        this.logger.warn(`IP rate limit exceeded: ${ip}`);
        throw new ForbiddenException('Rate limit exceeded');
      }

      // Check user rate limit if authenticated
      if (userId && userKey) {
        const userResult = await this.rateLimit.checkLimit(config, userId.toString());

        if (!userResult.allowed) {
          this.logger.warn(`User rate limit exceeded: userId=${userId}`);
          throw new ForbiddenException('Rate limit exceeded');
        }
      }

      next();
    } catch (error) {
      this.logger.error('Rate limit middleware error:', error);

      // On rate limit service error, let request through (fail-open)
      // But if it's a ForbiddenException, let it bubble up
      if (error instanceof ForbiddenException) {
        throw error;
      }

      next();
    }
  }

  /**
   * Get client IP address from request
   * Considers x-forwarded-for header (proxy/load balancer)
   */
  private getClientIp(req: Request): string {
    // Check x-forwarded-for (comma-separated list of IPs)
    const forwardedFor = req.headers['x-forwarded-for'] as string;
    if (forwardedFor) {
      // Take the first IP (original client IP)
      return forwardedFor.split(',')[0].trim();
    }

    // Check cf-connecting-ip (Cloudflare)
    const cfIp = req.headers['cf-connecting-ip'] as string;
    if (cfIp) {
      return cfIp;
    }

    // Check x-vercel-forwarded-for (Vercel)
    const vercelIp = req.headers['x-vercel-forwarded-for'] as string;
    if (vercelIp) {
      return vercelIp;
    }

    // Fallback to remoteAddress
    return req.socket.remoteAddress || req.connection.remoteAddress || 'unknown';
  }
}
