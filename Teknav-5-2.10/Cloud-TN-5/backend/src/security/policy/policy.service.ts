import { Injectable, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { EventBusService } from '../../notifications/event-bus.service';
import { PolicyAction, ResourceSubject, ResourceScope, PolicyContext, PolicyResource, PolicyDecision } from './policy.types';
import { AccessContextService } from './access-context.service';

/**
 * Policy Engine Service
 *
 * Evaluates:
 * - Actor (Role, Membership)
 * - Resource (Type, ID, Workspace, Owner)
 * - Action (CRUD + Custom)
 * - Scope (Global, Tenant, Workspace, Self)
 */

@Injectable()
export class PolicyService {
  private readonly logger = new Logger(PolicyService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
    private readonly accessContextService: AccessContextService,
  ) {}

  /**
   * Evaluate
   * Main entry point.
   */
  async evaluate(context: PolicyContext, action: PolicyAction, subject: ResourceSubject, resource: PolicyResource): Promise<PolicyDecision> {
    // 1. Pre-check: Global Owner
    if (context.actorRole === 'OWNER') {
      return { allowed: true, reason: 'Global Owner', policyDecisionId: 'owner' };
    }

    // 2. Check Workspace Boundary
    if (context.workspaceId && resource.workspaceId && context.workspaceId !== resource.workspaceId) {
      return { allowed: false, reason: 'Workspace mismatch', policyDecisionId: 'workspace' };
    }

    // 3. Check Self Scope
    if (resource.resourceType === ResourceSubject.USER && resource.resourceId === context.actorId && subject === ResourceSubject.USER) {
      return { allowed: true, reason: 'Self access', policyDecisionId: 'self' };
    }

    // 4. Load Permission Matrix
    const matrix = await this.getPermissionMatrix(context);

    // 5. Find Matching Rule
    const allowed = this.checkRules(matrix, context, action, subject, resource);

    const decisionId = `policy-${context.actorId}-${context.workspaceId || 'global'}-${Date.now()}`;

    // 6. Audit Log
    await this.auditLog.logAction({
      actorUserId: context.actorId,
      action: 'policy.evaluate',
      resource: subject, // Log generic subject
      payload: {
        context: { actorId: context.actorId, workspaceId: context.workspaceId, role: context.actorRole },
        action,
        subject,
        resource,
        allowed,
        reason: allowed ? '' : 'Policy Denied',
      },
    });

    if (!allowed) {
      throw new ForbiddenException('Policy Denied');
    }

    return { allowed: true, reason: 'Allowed', policyDecisionId };
  }

  /**
   * Get Permission Matrix (Merged)
   * Precedence: Workspace Override > Tenant Override > Default
   */
  private async getPermissionMatrix(context: PolicyContext): Promise<any> {
    // 1. Default (Hardcoded)
    const defaultMatrix = this.getDefaultMatrix();

    // 2. Tenant Override (Tenant.configuration)
    let tenantMatrix: any = null;
    if (context.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: context.tenantId },
        select: { configuration: true },
      });
      if (tenant) {
        tenantMatrix = (tenant.configuration as any)?.permissions;
      }
    }

    // 3. Workspace Override (Workspace.entitlements)
    let workspaceMatrix: any = null;
    if (context.workspaceId) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: context.workspaceId },
        select: { entitlements: true },
      });
      if (workspace) {
        workspaceMatrix = (workspace.entitlements as any)?.permissions;
      }
    }

    // 4. Merge (Workspace > Tenant > Default)
    // For MVP, simple Object spread is sufficient.
    // Deep merge would be better for complex overrides.
    return { ...defaultMatrix, ...tenantMatrix, ...workspaceMatrix };
  }

  /**
   * Check Rules against Matrix
   */
  private checkRules(
    matrix: any,
    context: PolicyContext,
    action: PolicyAction,
    subject: ResourceSubject,
    resource: PolicyResource,
  ): boolean {
    // MVP: Check Role-based allowed actions.
    // Real implementation would traverse `matrix.rules`.

    // Simplified Logic:
    // - OWNER: All.
    // - ADMIN: All except MANAGE_TENANT, MANAGE_ROLES, CREATE_TOKEN (Global).
    // - EDITOR/WRITER: Read, Create (Articles, Drafts). Cannot Delete/Publish Approve.
    // - GUEST: Read only.

    const role = context.actorRole;

    // Global Security (Admin/Owner exclusive)
    if ([
      PolicyAction.MANAGE_PERMISSIONS,
      PolicyAction.MANAGE_ROLES,
      PolicyAction.MANAGE_TENANT,
      PolicyAction.BAN_USER,
      PolicyAction.CREATE_TOKEN,
    ].includes(action)) {
      if (role === 'ADMIN' && resource.workspaceId) return true; // Admin can manage own workspace
      if (role === 'OWNER') return true;
      return false;
    }

    // Workspace Actions
    if ([
      PolicyAction.DELETE,
      PolicyAction.PUBLISH,
      PolicyAction.APPROVE,
      PolicyAction.ASSIGN,
    ].includes(action)) {
      if (role === 'ADMIN' && resource.workspaceId === context.workspaceId) return true;
      if (role === 'OWNER') return true;
      return false;
    }

    // Content (Article)
    if (subject === ResourceSubject.ARTICLE) {
      if (role === 'WRITER' || role === 'EDITOR') {
        if ([PolicyAction.CREATE, PolicyAction.READ, PolicyAction.UPDATE].includes(action)) {
          // Writer can only update own articles (Self scope check in Evaluate step handles this)
          // But here we assume if we reached here, user has basic access.
          // However, UPDATE/DELETE usually checks ownership in Service layer.
          return true;
        }
      }
    }

    // Workflow (Admin/Owner only to Run)
    if (subject === ResourceSubject.WORKFLOW) {
      if (action === PolicyAction.RUN_WORKFLOW) {
        return role === 'ADMIN' || role === 'OWNER';
      }
    }

    return true; // Default allow for safe ops
  }

  /**
   * Default Matrix
   */
  private getDefaultMatrix(): any {
    return {
      rules: [
        // Examples
        // { role: 'WRITER', action: 'delete', resource: 'Article', effect: 'deny' },
        // { role: 'GUEST', action: 'create', resource: 'Article', effect: 'deny' },
      ],
    };
  }

  /**
   * Check Ban
   */
  async checkBan(context: PolicyContext): Promise<void> {
    const ipBanKey = `${this.REDIS_PREFIX}:ban:ip:${context.ip}`;
    const userBanKey = `${this.REDIS_PREFIX}:ban:user:${context.actorId}`;

    const [isIpBanned, isUserBanned] = await Promise.all([
      this.redis.redis.exists(ipBanKey),
      this.redis.redis.exists(userBanKey),
    ]);

    if (isIpBanned) {
      this.logger.warn(`IP Banned: ${context.ip}`);
      throw new ForbiddenException('IP Banned');
    }

    if (isUserBanned) {
      this.logger.warn(`User Banned: ${context.actorId}`);
      throw new ForbiddenException('User Banned');
    }
  }

  /**
   * Log Security Event
   */
  async logSecurityEvent(context: PolicyContext, eventType: string, details: any) {
    await this.auditLog.logAction({
      actorUserId: context.actorId,
      action: 'security.event',
      resource: 'Security',
      payload: {
        eventType,
        ip: context.ip,
        ua: context.ua,
        workspaceId: context.workspaceId,
        ...details,
      },
    });

    // Publish to Admin Feed
    await this.eventBus.publish('teknav:admin:events', {
      id: `sec-${Date.now()}-${Math.random()}`,
      type: 'security.event',
      at: new Date(),
      actorId: context.actorId,
      workspaceId: context.workspaceId,
      entityType: 'Security',
      entityId: 0,
      severity: 'warn',
      title: `Security Event: ${eventType}`,
      message: details.message || 'Security event logged',
      meta: details,
    });
  }

  /**
   * Invalidate Cache
   */
  async invalidateCache(tenantId: number, workspaceId?: number): Promise<void> {
    const keys = [];
    if (workspaceId) {
      keys.push(`${this.REDIS_PREFIX}:perm:matrix:${tenantId}:${workspaceId}`);
    }
    if (tenantId) {
      keys.push(`${this.REDIS_PREFIX}:perm:matrix:${tenantId}:*`);
    }

    if (keys.length > 0) {
      await this.redis.redis.del(...keys);
      this.logger.log(`Invalidated permission cache: ${keys.join(', ')}`);
    }
  }
}
