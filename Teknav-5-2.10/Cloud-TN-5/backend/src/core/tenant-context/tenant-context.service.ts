import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * Tenant Context Service (M0 - Architecture)
 *
 * Handles:
 * - Resolving tenant from subdomain/host header or JWT claim.
 * - Attaching context to request container.
 * - Caching tenant config.
 */

@Injectable()
export class TenantContextService {
  private readonly logger = new Logger(TenantContextService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly CACHE_TTL = 300; // 5 mins

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Resolve Tenant Context
   * 
   * Implementation:
   * 1. Extract Host/Header from request.
   * 2. Lookup Tenant by subdomain/host.
   * 3. Extract userId from JWT (assumed attached to req.user).
   * 4. Fetch Workspace, Membership, Plan.
   * 5. Return Context Object.
   */
  async resolveTenantContext(req: any) {
    const requestId = req.id || `req-${Date.now()}`;
    
    // 1. Extract Host
    // Using 'host' header or 'x-forwarded-host' or 'x-vercel-deployment-url'
    const host = req.headers['host'] || req.headers['x-forwarded-host'] || req.headers['x-vercel-deployment-url'];
    const subdomain = host?.split('.')[0]; // e.g. 'acme' from acme.teknav.com

    if (!subdomain) {
      throw new Error('Unable to resolve tenant: no host provided');
    }

    // 2. Lookup Tenant (Cache -> DB)
    const tenant = await this.getTenantBySubdomain(subdomain);

    if (!tenant) {
      throw new Error(`Tenant not found for subdomain: ${subdomain}`);
    }

    // 3. Resolve User (Assumed from AuthGuard)
    const userId = req.user?.userId;

    // 4. Resolve Active Workspace (From User preference or Header)
    let workspaceId: number | null = null;
    let workspaceOwnerId: number | null = null;
    
    if (userId) {
      // Check header for workspace ID (API Key based access)
      workspaceId = req.headers['x-teknav-workspace-id'] ? parseInt(req.headers['x-teknav-workspace-id']) : req.user?.activeWorkspaceId;
    }

    // 5. Fetch Membership (for Roles)
    let roles: string[] = ['GUEST'];
    let planTier: string = 'FREE';
    
    if (userId && workspaceId) {
      const member = await this.prisma.workspaceMember.findFirst({
        where: { userId, workspaceId },
        select: { role: true, user: { select: { tenant: true, subscriptionTier: true } } },
      });
      
      if (member) {
        roles = [member.role];
        planTier = member.user.subscriptionTier || 'FREE';
      }
    } else if (userId) {
      // User exists but no workspace context
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionTier: true, tenantId: true },
      });
      planTier = user?.subscriptionTier || 'FREE';
      workspaceId = user?.activeWorkspaceId || null;
    }

    const workspaceOwnerId = workspaceId 
      ? (await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { ownerId: true },
        }))?.ownerId 
      : null;

    // 6. Locale (From Workspace or User)
    let locale = 'en';
    if (workspaceId) {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultLocale: true },
      });
      locale = ws?.defaultLocale || 'en';
    }

    // Context Object
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      workspaceId,
      workspaceOwnerId,
      userId,
      roles,
      planTier,
      locale,
      requestId,
    };
  }

  /**
   * Get Tenant by Subdomain
   * Cache Key: `teknav:tenant:subdomain:{subdomain}`
   */
  private async getTenantBySubdomain(subdomain: string) {
    const key = `${this.REDIS_PREFIX}:tenant:subdomain:${subdomain}`;
    const cached = await this.redis.redis.get(key);

    if (cached) {
      this.logger.log(`Tenant cache hit: ${subdomain}`);
      return JSON.parse(cached);
    }

    // DB Fetch
    const tenant = await this.prisma.tenant.findFirst({
      where: {
        domain: { contains: subdomain }, // Simple contains for MVP subdomain logic
      },
    });

    if (!tenant) {
      return null;
    }

    // Set Cache
    await this.redis.redis.set(key, JSON.stringify(tenant), 'EX', this.CACHE_TTL);

    return tenant;
  }
}
