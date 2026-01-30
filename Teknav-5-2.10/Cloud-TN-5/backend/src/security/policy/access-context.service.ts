import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PolicyContext, ResourceScope } from './policy.types';

/**
 * Access Context Service
 *
 * Resolves current user, workspace, membership, tenant.
 * Caches membership in Redis with TTL.
 * Provides helpers: assertWorkspaceAccess(), assertOwner().
 */

@Injectable()
export class AccessContextService {
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly MEMBERSHIP_TTL = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Resolve Policy Context
   * Extracts User, Workspace, Membership from Session/Request.
   */
  async resolveContext(sessionId: string, workspaceId?: number, userId?: number): Promise<PolicyContext> {
    let actorId = userId;
    let activeWorkspaceId = workspaceId;
    let membershipId: number | undefined;
    let tenantId: number | undefined;
    let role = 'GUEST';

    // 1. Get User (from Session/DB)
    let user;
    if (actorId) {
      user = await this.prisma.user.findUnique({ where: { id: actorId } });
    } else {
      // Should not happen if AuthGuard works, but fallback
      user = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      }).then(s => s?.user);
    }

    if (!user) {
      throw new NotFoundException('User not found');
    }

    actorId = user.id;

    // 2. Get Active Workspace (from User preference or query param)
    if (!activeWorkspaceId && user.activeWorkspaceId) {
      activeWorkspaceId = user.activeWorkspaceId;
    }

    // 3. Get Membership (Redis Cache -> DB)
    if (activeWorkspaceId) {
      membershipId = await this.getMembershipId(actorId, activeWorkspaceId);
      if (membershipId) {
        const membership = await this.prisma.workspaceMember.findUnique({
          where: { id: membershipId },
          select: { role: true, workspace: { select: { tenantId: true } } },
        });
        role = membership?.role || 'MEMBER';
        tenantId = membership?.workspace?.tenantId;
      } else {
        // User might have access to workspace but not membership (Owner/Admin usually)
        // For this MVP, we just fetch workspace directly
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: activeWorkspaceId },
          select: { ownerId: true, tenantId: true },
        });
        if (workspace) {
          if (workspace.ownerId === actorId) {
            role = 'OWNER';
          } else {
            role = 'MEMBER';
          }
          tenantId = workspace.tenantId;
        }
      }
    } else {
      // User is Guest or Global Tenant Owner (Simplified)
      role = 'OWNER'; // Default to Owner for MVP context if no workspace
      // TenantId not resolved without workspace
    }

    return {
      actorId,
      actorRole: role,
      tenantId: tenantId || 0,
      workspaceId: activeWorkspaceId,
      membershipId,
      ip: '', // Set by middleware
      ua: '', // Set by middleware
      sessionId,
      requestId: '',
    };
  }

  /**
   * Get Membership ID (Cached)
   */
  async getMembershipId(userId: number, workspaceId: number): Promise<number | null> {
    const key = `${this.REDIS_PREFIX}:membership:${userId}:${workspaceId}`;
    const cached = await this.redis.redis.get(key);
    if (cached) {
      return parseInt(cached);
    }

    // DB Fetch
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, workspaceId },
      select: { id: true },
    });

    if (membership) {
      await this.redis.redis.set(key, membership.id.toString(), 'EX', this.MEMBERSHIP_TTL);
      return membership.id;
    }

    return null;
  }

  /**
   * Assert Workspace Access
   * Throws if user has no access.
   */
  async assertWorkspaceAccess(context: PolicyContext, workspaceId: number): Promise<void> {
    // Owner check
    if (context.actorRole === 'OWNER' && context.workspaceId === workspaceId) return;

    // Membership check
    const membershipId = await this.getMembershipId(context.actorId, workspaceId);
    if (!membershipId) {
      throw new Error('Access Denied: No membership in workspace');
    }
  }

  /**
   * Assert Owner
   * Throws if not owner.
   */
  async assertOwner(context: PolicyContext, resource?: { workspaceId?: number; ownerId?: number }): Promise<void> {
    if (context.actorRole !== 'OWNER') {
      throw new Error('Access Denied: Owner required');
    }

    // Check ownership of specific resource if provided
    if (resource) {
      if (resource.ownerId && resource.ownerId !== context.actorId) {
        throw new Error('Access Denied: Not owner of this resource');
      }
      if (resource.workspaceId && resource.workspaceId !== context.workspaceId) {
        // Check if owner of workspace
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: resource.workspaceId, ownerId: context.actorId },
        });
        if (!workspace) {
          throw new Error('Access Denied: Not owner of this workspace');
        }
      }
    }
  }

  /**
   * Invalidate Membership Cache
   */
  async invalidateMembership(userId: number, workspaceId: number): Promise<void> {
    const key = `${this.REDIS_PREFIX}:membership:${userId}:${workspaceId}`;
    await this.redis.redis.del(key);
  }
}
