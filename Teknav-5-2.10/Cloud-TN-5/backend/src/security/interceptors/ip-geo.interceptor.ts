import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Request } from 'express';

/**
 * IP/Geo Interceptor
 * 
 * M0 - Architecture: "IP/Geo logging (best-effort, no new schema)"
 * 
 * Captures:
 * - IP (Normalized)
 * - User Agent
 * - Geo (Cloudflare headers, TZ hints)
 * 
 * Stores in Request (for AuditLog/SecurityService).
 */

@Injectable()
export class IpGeoInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<Request>();

    // 1. Extract IP
    // Order: x-forwarded-for -> x-real-ip -> request.socket.remoteAddress
    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || 
                  (request.headers['x-real-ip'] as string)?.trim() || 
                  (request.socket.remoteAddress || '').trim();

    // 2. Normalize IP (IPv4/IPv6)
    const normalizedIp = this.normalizeIp(ip);

    // 3. Extract User Agent
    const ua = request.headers['user-agent'] || 'Unknown';

    // 4. Extract Geo (Best-Effort)
    // Cloudflare headers: cf-ipcountry, cf-ray, ...
    const geo = {
      country: (request.headers['cf-ipcountry'] as string) || null,
      region: (request.headers['cf-region'] as string) || null,
      city: (request.headers['cf-ipcity'] as string) || null,
      tz: (request.headers['tz'] as string) || null, // Timezone hint
      source: (request.headers['cf-ray'] as string) ? 'cloudflare' : null,
    };

    // 5. Attach to Request (for downstream use in Audit/Security)
    (request as any).ipAddress = normalizedIp;
    (request as any).ua = ua;
    (request as any).geo = geo;

    return next.handle();
  }

  /**
   * Normalize IP Address
   * Returns IPv4 or IPv6 string.
   */
  private normalizeIp(ip: string): string {
    if (!ip) return '0.0.0.0';
    
    // Remove port if present
    const parts = ip.split(':');
    const ipPart = parts[0];

    // IPv6 Mapping
    // (Simplified MVP logic)
    if (ipPart.includes(':')) {
      return ipPart; // Already IPv6
    }

    // IPv4 Mapping
    // (Simplified MVP logic)
    return ipPart;
  }
}
