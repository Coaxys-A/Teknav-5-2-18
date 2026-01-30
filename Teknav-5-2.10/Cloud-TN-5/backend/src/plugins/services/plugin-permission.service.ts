import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Plugin Permission Service (Schema-Free)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Features:
 * - Scope-based permissions (cms:articles:read, ai:invoke, etc.)
 * - Allow/deny/rate_limited permission types
 * - Workspace-level and tenant-level permission overrides
 * - Permission matrix derived from manifest
 * - Workspace role gating
 */

export interface PermissionScope {
  resource: string; // cms, ai, net, kv, webhooks, files, etc.
  action: string; // read, write, invoke, emit, etc.
}

export interface PermissionGrant {
  scope: string;
  permission: 'allow' | 'deny' | 'rate_limited';
  rateLimitConfig?: {
    windowMs: number;
    max: number;
  };
}

export interface PermissionMatrix {
  [scope: string]: {
    permission: 'allow' | 'deny' | 'rate_limited';
    rateLimit?: {
      windowMs: number;
      max: number;
    };
    source: 'manifest' | 'workspace' | 'tenant';
  };
}

export interface WorkspacePermission {
  scope: string;
  permission: 'allow' | 'deny' | 'rate_limited';
  rateLimitWindowMs?: number;
  rateLimitMax?: number;
  source: 'owner' | 'manifest';
  workspaceRoleId?: number;
}

@Injectable()
export class PluginPermissionService {
  private readonly logger = new Logger(PluginPermissionService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================================================
  // PERMISSION VALIDATION
  // ==========================================================================

  /**
   * Check if plugin has permission for scope
   */
  async hasPermission(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<boolean> {
    this.logger.debug(`Checking permission: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);

    // 1. Get permission matrix for plugin/workspace
    const matrix = await this.getPermissionMatrix(pluginId, workspaceId);

    // 2. Check if scope is in matrix
    const permission = matrix[scope];

    if (!permission) {
      // Default: deny if not explicitly allowed
      return false;
    }

    return permission.permission === 'allow';
  }

  /**
   * Check permission with rate limit
   */
  async checkPermissionWithRateLimit(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<{ allowed: boolean; rateLimit?: { windowMs: number; max: number } }> {
    this.logger.debug(`Checking permission with rate limit: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);

    const matrix = await this.getPermissionMatrix(pluginId, workspaceId);
    const permission = matrix[scope];

    if (!permission || permission.permission !== 'rate_limited') {
      return { allowed: !!permission && permission.permission === 'allow' };
    }

    return {
      allowed: true,
      rateLimit: permission.rateLimit,
    };
  }

  /**
   * Get full permission matrix for plugin/workspace
   */
  async getPermissionMatrix(
    pluginId: number,
    workspaceId: number,
  ): Promise<PermissionMatrix> {
    const matrix: PermissionMatrix = {};

    // 1. Get plugin permissions from manifest
    const manifestPermissions = await this.getManifestPermissions(pluginId);

    // 2. Get workspace override permissions
    const workspacePermissions = await this.getWorkspacePermissions(pluginId, workspaceId);

    // 3. Get tenant override permissions
    const tenantPermissions = await this.getTenantPermissions(pluginId, workspaceId);

    // 4. Merge permissions (workspace overrides manifest, tenant overrides workspace)
    const allScopes = new Set<string>();
    allScopes.add(...Object.keys(manifestPermissions));
    allScopes.add(...Object.keys(workspacePermissions));
    allScopes.add(...Object.keys(tenantPermissions));

    for (const scope of allScopes) {
      // Priority: Tenant > Workspace > Manifest
      const tenantPerm = tenantPermissions[scope];
      const workspacePerm = workspacePermissions[scope];
      const manifestPerm = manifestPermissions[scope];

      let finalPermission: any = {};

      if (tenantPerm) {
        finalPermission = {
          permission: tenantPerm.permission,
          rateLimit: tenantPerm.rateLimit,
          source: 'tenant',
        };
      } else if (workspacePerm) {
        finalPermission = {
          permission: workspacePerm.permission,
          rateLimit: workspacePerm.rateLimit,
          source: 'workspace',
        };
      } else if (manifestPerm) {
        finalPermission = {
          permission: manifestPerm.permission,
          rateLimit: manifestPerm.rateLimit,
          source: 'manifest',
        };
      }

      matrix[scope] = finalPermission;
    }

    return matrix;
  }

  // ==========================================================================
  // PERMISSION SOURCES
  // ==========================================================================

  /**
   * Get permissions from plugin manifest
   */
  private async getManifestPermissions(pluginId: number): Promise<PermissionMatrix> {
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      select: { latestVersion: true },
    });

    if (!plugin || !plugin.latestVersion) {
      return {};
    }

    const manifest = JSON.parse(plugin.latestVersion.manifest);

    // Extract permissions from manifest
    // Format: { permissions: { "cms:articles:read": true, "ai:invoke": true } }
    const manifestPerms = (manifest.permissions as any) || {};

    const permissions: PermissionMatrix = {};

    for (const [scope, allowed] of Object.entries(manifestPerms)) {
      if (typeof allowed === 'boolean') {
        permissions[scope] = {
          permission: allowed ? 'allow' : 'deny',
          source: 'manifest',
        };
      } else if (typeof allowed === 'object') {
        // Object format: { permission: 'allow', rateLimit: { windowMs: 60000, max: 100 } }
        permissions[scope] = {
          ...allowed,
          source: 'manifest',
        };
      }
    }

    return permissions;
  }

  /**
   * Get workspace override permissions
   */
  private async getWorkspacePermissions(pluginId: number, workspaceId: number): Promise<PermissionMatrix> {
    const permissions = await this.prisma.pluginPermission.findMany({
      where: {
        pluginId,
        workspaceId,
      },
    });

    const matrix: PermissionMatrix = {};

    for (const perm of permissions) {
      matrix[perm.scope] = {
        permission: perm.permission,
        rateLimit: perm.rateLimitWindowMs && perm.rateLimitMax
          ? {
              windowMs: perm.rateLimitWindowMs,
              max: perm.rateLimitMax,
            }
          : undefined,
        source: 'workspace',
      };
    }

    return matrix;
  }

  /**
   * Get tenant override permissions
   */
  private async getTenantPermissions(pluginId: number, workspaceId: number): Promise<PermissionMatrix> {
    // Get tenant via workspace
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { tenant: true },
    });

    if (!workspace) {
      return {};
    }

    // Get tenant-wide permissions from PluginSettings
    const settings = await this.prisma.pluginSettings.findMany({
      where: {
        workspaceId,
        pluginId,
        settingKey: { in: ['permissions', 'rateLimits'] },
      },
    });

    const matrix: PermissionMatrix = {};

    // Apply permissions from settings
    for (const setting of settings) {
      if (setting.settingKey === 'permissions') {
        const perms = JSON.parse(setting.settingValue);
        for (const [scope, config] of Object.entries(perms)) {
          if (typeof config === 'boolean') {
            matrix[scope] = {
              permission: config ? 'allow' : 'deny',
              source: 'tenant',
            };
          } else if (typeof config === 'object') {
            matrix[scope] = {
              ...config,
              source: 'tenant',
            };
          }
        }
      }
    }

    return matrix;
  }

  // ==========================================================================
  // PERMISSION MANAGEMENT (OWNER)
  // ==========================================================================

  /**
   * Get plugin permissions (list)
   */
  async getPluginPermissions(pluginId: number): Promise<any[]> {
    const permissions = await this.prisma.pluginPermission.findMany({
      where: { pluginId },
      include: { workspace: true },
    });

    return permissions;
  }

  /**
   * Set plugin permissions (Owner scope)
   */
  async setPluginPermission(
    pluginId: number,
    input: PermissionGrant,
    actorId: number,
  ): Promise<void> {
    const { scope, permission, rateLimitConfig } = input;

    this.logger.log(`Setting plugin permission: plugin ${pluginId}, scope ${scope}, permission ${permission} by actor ${actorId}`);

    await this.prisma.pluginPermission.upsert({
      where: {
        pluginId_scope: {
          pluginId,
          scope,
        },
      },
      create: {
        pluginId,
        scope,
        permission,
        rateLimitWindowMs: rateLimitConfig?.windowMs,
        rateLimitMax: rateLimitConfig?.max,
        createdById: actorId,
        createdAt: new Date(),
      },
      update: {
        permission,
        rateLimitWindowMs: rateLimitConfig?.windowMs,
        rateLimitMax: rateLimitConfig?.max,
        updatedById: actorId,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Delete plugin permission
   */
  async deletePluginPermission(
    pluginId: number,
    scope: string,
    actorId: number,
  ): Promise<void> {
    this.logger.log(`Deleting plugin permission: plugin ${pluginId}, scope ${scope} by actor ${actorId}`);

    await this.prisma.pluginPermission.deleteMany({
      where: {
        pluginId,
        scope,
      },
    });
  }

  // ==========================================================================
  // WORKSPACE PERMISSION MANAGEMENT
  // ==========================================================================

  /**
   * Get workspace plugin permissions
   */
  async getWorkspacePermissionsList(
    pluginId: number,
    workspaceId: number,
  ): Promise<WorkspacePermission[]> {
    const permissions = await this.prisma.pluginPermission.findMany({
      where: {
        pluginId,
        workspaceId,
      },
      include: {
        createdBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return permissions.map(perm => ({
      scope: perm.scope,
      permission: perm.permission,
      rateLimitWindowMs: perm.rateLimitWindowMs,
      rateLimitMax: perm.rateLimitMax,
      source: 'workspace',
      workspaceRoleId: perm.createdBy?.workspaceRoleId,
      createdAt: perm.createdAt,
      updatedAt: perm.updatedAt,
    }));
  }

  /**
   * Set workspace plugin permission
   */
  async setWorkspacePermission(
    pluginId: number,
    workspaceId: number,
    input: PermissionGrant,
    actorId: number,
  ): Promise<void> {
    const { scope, permission, rateLimitConfig } = input;

    this.logger.log(`Setting workspace plugin permission: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}, permission ${permission} by actor ${actorId}`);

    await this.prisma.pluginPermission.upsert({
      where: {
        pluginId_workspaceId_scope: {
          pluginId,
          workspaceId,
          scope,
        },
      },
      create: {
        pluginId,
        workspaceId,
        scope,
        permission,
        rateLimitWindowMs: rateLimitConfig?.windowMs,
        rateLimitMax: rateLimitConfig?.max,
        createdById: actorId,
        createdAt: new Date(),
      },
      update: {
        permission,
        rateLimitWindowMs: rateLimitConfig?.windowMs,
        rateLimitMax: rateLimitConfig?.max,
        updatedById: actorId,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Delete workspace plugin permission
   */
  async deleteWorkspacePermission(
    pluginId: number,
    workspaceId: number,
    scope: string,
    actorId: number,
  ): Promise<void> {
    this.logger.log(`Deleting workspace plugin permission: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope} by actor ${actorId}`);

    await this.prisma.pluginPermission.deleteMany({
      where: {
        pluginId,
        workspaceId,
        scope,
      },
    });
  }

  // ==========================================================================
  // RATE LIMIT CHECKING
  // ==========================================================================

  /**
   * Check rate limit for scope
   */
  async checkRateLimit(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<{ allowed: boolean; retryAfter?: number; resetAfter?: number }> {
    this.logger.debug(`Checking rate limit: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);

    const matrix = await this.getPermissionMatrix(pluginId, workspaceId);
    const permission = matrix[scope];

    if (!permission || permission.permission !== 'rate_limited') {
      return { allowed: true };
    }

    const { rateLimit } = permission;

    if (!rateLimit) {
      return { allowed: true };
    }

    // Check Redis token bucket (this will be implemented in rate limit service)
    // For now, we'll return a simulated rate limit check
    const allowed = Math.random() > 0.5; // 50% chance of being rate limited

    if (!allowed) {
      const now = Date.now();
      const resetAfter = now + rateLimit.windowMs;

      return {
        allowed: false,
        resetAfter,
        retryAfter: now + Math.random() * rateLimit.windowMs,
      };
    }

    return { allowed: true };
  }

  /**
   * Get rate limit config
   */
  async getRateLimitConfig(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<{ windowMs: number; max: number } | null> {
    const matrix = await this.getPermissionMatrix(pluginId, workspaceId);
    const permission = matrix[scope];

    if (!permission || permission.permission !== 'rate_limited' || !permission.rateLimit) {
      return null;
    }

    return permission.rateLimit;
  }
}
