import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { AuditLogService } from '../../logging/audit-log.service';
import { PluginPermissionService, PermissionGrant, PermissionMatrix, WorkspacePermission } from '../services/plugin-permission.service';

/**
 * Plugin Permissions Controller (Owner + Workspace Scope)
 * PART 12 - Plugin Platform: "Permissions Matrix + Signing Enforcement"
 */

@Controller('api/owner/plugins')
@UseGuards(PoliciesGuard)
export class OwnerPluginPermissionsController {
  constructor(
    private readonly permissions: PluginPermissionService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // OWNER-SCOPE PERMISSIONS (GLOBAL)
  // ==========================================================================

  @Get(':pluginId/permissions')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getPluginPermissions(@Param('pluginId') pluginId: number) {
    const permissions = await this.permissions.getPluginPermissions(pluginId);
    const matrix = await this.permissions.getPermissionMatrix(pluginId, 0); // Tenant-wide

    return {
      data: permissions,
      matrix,
    };
  }

  @Put(':pluginId/permissions')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async setPluginPermission(
    @Param('pluginId') pluginId: number,
    @Body() input: PermissionGrant,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    await this.permissions.setPluginPermission(pluginId, input, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.permission.set',
      resource: `PluginPermission`,
      payload: {
        pluginId,
        scope: input.scope,
        permission: input.permission,
      },
    });

    return { message: 'Permission set' };
  }

  @Delete(':pluginId/permissions')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async deletePluginPermission(
    @Param('pluginId') pluginId: number,
    @Body() body: { scope: string },
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    await this.permissions.deletePluginPermission(pluginId, body.scope, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.permission.deleted',
      resource: `PluginPermission`,
      payload: {
        pluginId,
        scope: body.scope,
      },
    });

    return { message: 'Permission deleted' };
  }
}

/**
 * Workspace Plugin Permissions Controller
 * PART 12 - Plugin Platform: "Permissions Matrix + Signing Enforcement"
 */

@Controller('api/owner/workspaces/:workspaceId/plugins')
@UseGuards(PoliciesGuard)
export class WorkspacePluginPermissionsController {
  constructor(
    private readonly permissions: PluginPermissionService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // WORKSPACE-SCOPE PERMISSIONS
  // ==========================================================================

  @Get(':pluginId/permissions')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getWorkspacePermissions(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
  ) {
    const permissions = await this.permissions.getWorkspacePermissionsList(pluginId, workspaceId);
    const matrix = await this.permissions.getPermissionMatrix(pluginId, workspaceId);

    return {
      data: permissions,
      matrix,
    };
  }

  @Put(':pluginId/permissions')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.WORKSPACE_SETTINGS)
  @HttpCode(HttpStatus.OK)
  async setWorkspacePermission(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Body() input: PermissionGrant,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Check workspace boundary
    if (req.user.workspaceId !== workspaceId) {
      throw new Error('Not authorized for this workspace');
    }

    await this.permissions.setWorkspacePermission(pluginId, workspaceId, input, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'workspace.plugin.permission.set',
      resource: `WorkspacePluginPermission`,
      payload: {
        workspaceId,
        pluginId,
        scope: input.scope,
      },
    });

    return { message: 'Workspace permission set' };
  }

  @Delete(':pluginId/permissions')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.WORKSPACE_SETTINGS)
  @HttpCode(HttpStatus.OK)
  async deleteWorkspacePermission(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Body() body: { scope: string },
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Check workspace boundary
    if (req.user.workspaceId !== workspaceId) {
      throw new Error('Not authorized for this workspace');
    }

    await this.permissions.deleteWorkspacePermission(pluginId, workspaceId, body.scope, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'workspace.plugin.permission.deleted',
      resource: `WorkspacePluginPermission`,
      payload: {
        workspaceId,
        pluginId,
        scope: body.scope,
      },
    });

    return { message: 'Workspace permission deleted' };
  }
}
