import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { EventBusService } from '../../notifications/event-bus.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * Permission Management Service
 *
 * Manages:
 * - Tenant Permissions (Tenant.configuration)
 * - Workspace Permissions (Workspace.entitlements)
 * - Caching (Redis)
 * - Invalidation
 */

@Injectable()
export class PermissionManagementService {
  private readonly logger = new Logger(PermissionManagementService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly CACHE_TTL = 600; // 10 mins

  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: PolicyService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Get Default Matrix
   */
  async getDefaultMatrix(): Promise<any> {
    return this.policyService['getDefaultMatrix']();
  }

  /**
   * Get Permissions Matrix (Merged)
   * Returns Default + Tenant + Workspace overrides.
   */
  async getMatrix(tenantId: number, workspaceId: number): Promise<any> {
    const cacheKey = `${this.REDIS_PREFIX}:perm:matrix:${tenantId}:${workspaceId}`;
    const cached = await this.redis.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 1. Default
    const defaultMatrix = await this.getDefaultMatrix();

    // 2. Tenant Override
    let tenantMatrix = null;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { configuration: true },
    });
    if (tenant && tenant.configuration) {
      tenantMatrix = (tenant.configuration as any)?.permissions;
    }

    // 3. Workspace Override
    let workspaceMatrix = null;
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { entitlements: true },
    });
    if (workspace && workspace.entitlements) {
      workspaceMatrix = (workspace.entitlements as any)?.permissions;
    }

    // 4. Merge (Workspace > Tenant > Default)
    const mergedMatrix = { ...defaultMatrix, ...tenantMatrix, ...workspaceMatrix };

    // 5. Cache
    await this.redis.redis.set(cacheKey, JSON.stringify(mergedMatrix), 'EX', this.CACHE_TTL);

    return mergedMatrix;
  }

  /**
   * Set Tenant Permissions
   * Updates Tenant.configuration.permissions
   */
  async setTenantPermissions(
    actor: any,
    tenantId: number,
    permissions: any,
  ): Promise<void> {
    // 1. Fetch Tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { configuration: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    // 2. Update Configuration
    const currentConfig = (tenant.configuration as any) || {};
    const newConfig = {
      ...currentConfig,
      permissions,
    };

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        configuration: newConfig,
      },
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'permission.set.tenant',
      resource: `Tenant:${tenantId}`,
      payload: {
        tenantId,
        permissions,
        previous: currentConfig.permissions,
      },
    });

    // 4. Publish Event
    await this.eventBus.publish('permission.update', {
      id: `tenant-${tenantId}`,
      type: 'permission.updated',
      at: new Date(),
      actorId: actor.userId,
      entityType: 'Tenant',
      entityId: tenantId,
      severity: 'info',
      title: 'Tenant Permissions Updated',
      message: 'Permissions overlay changed',
      meta: { tenantId, overlay: 'tenant' },
    });

    // 5. Invalidate Cache
    await this.invalidateCache(tenantId);
  }

  /**
   * Set Workspace Permissions
   * Updates Workspace.entitlements.permissions
   */
  async setWorkspacePermissions(
    actor: any,
    workspaceId: number,
    permissions: any,
  ): Promise<void> {
    // 1. Fetch Workspace
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { entitlements: true, tenantId: true },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    // 2. Update Entitlements
    const currentEntitlements = (workspace.entitlements as any) || {};
    const newEntitlements = {
      ...currentEntitlements,
      permissions,
    };

    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        entitlements: newEntitlements,
      },
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'permission.set.workspace',
      resource: `Workspace:${workspaceId}`,
      payload: {
        workspaceId,
        permissions,
        previous: currentEntitlements.permissions,
      },
    });

    // 4. Publish Event
    await this.eventBus.publish('permission.update', {
      id: `workspace-${workspaceId}`,
      type: 'permission.updated',
      at: new Date(),
      actorId: actor.userId,
      workspaceId,
      entityType: 'Workspace',
      entityId: workspaceId,
      severity: 'info',
      title: 'Workspace Permissions Updated',
      message: 'Permissions overlay changed',
      meta: { workspaceId, overlay: 'workspace' },
    });

    // 5. Invalidate Cache
    await this.invalidateCache(workspace.tenantId, workspaceId);
  }

  /**
   * Reset Permissions
   * Clears Tenant and Workspace overlays.
   */
  async resetPermissions(actor: any, tenantId: number, workspaceId: number): Promise<void> {
    // 1. Reset Tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { configuration: true },
    });

    if (tenant && tenant.configuration) {
      const config = tenant.configuration as any;
      delete config.permissions; // Remove key
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { configuration: config },
      });
    }

    // 2. Reset Workspace
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { entitlements: true },
    });

    if (workspace && workspace.entitlements) {
      const ent = workspace.entitlements as any;
      delete ent.permissions; // Remove key
      await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { entitlements: ent },
      });
    }

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'permission.reset',
      resource: 'Permissions',
      payload: {
        tenantId,
        workspaceId,
      },
    });

    // 4. Publish Event
    await this.eventBus.publish('permission.update', {
      id: `reset-${tenantId}-${workspaceId}`,
      type: 'permission.reset',
      at: new Date(),
      actorId: actor.userId,
      entityType: 'Permissions',
      entityId: 0,
      severity: 'warn',
      title: 'Permissions Reset',
      message: 'All permission overlays cleared',
      meta: { tenantId, workspaceId },
    });

    // 5. Invalidate Cache
    await this.invalidateCache(tenantId, workspaceId);
  }

  /**
   * Invalidate Cache
   */
  async invalidateCache(tenantId: number | null, workspaceId: number | null): Promise<void> {
    const keys: string[] = [];

    if (tenantId && workspaceId) {
      keys.push(`${this.REDIS_PREFIX}:perm:matrix:${tenantId}:${workspaceId}`);
    } else if (tenantId) {
      keys.push(`${this.REDIS_PREFIX}:perm:matrix:${tenantId}:*`);
    }

    if (keys.length > 0) {
      await this.redis.redis.del(...keys);
      this.logger.log(`Invalidated permission cache: ${keys.join(', ')}`);
    }
  }
}
