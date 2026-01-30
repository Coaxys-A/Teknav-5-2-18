import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { AuditLogService } from '../../logging/audit-log.service';
import { PluginService, PluginMarketplaceFilter, PluginCreateInput, PluginInstallInput } from '../services/plugin.service';
import { PluginStorageService, PluginVersionUploadInput } from '../services/plugin-storage.service';
import { PluginSecurityService, TrustedSignerInput } from '../services/plugin-security.service';
import { PluginPermissionService, PermissionGrant, PluginPermissionGrantInput, WorkspacePermission } from '../services/plugin-permission.service';

/**
 * Plugin Marketplace + Versioning Controller (Owner Scope)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement"
 */

@Controller('api/owner/plugins')
@UseGuards(PoliciesGuard)
export class OwnerPluginController {
  constructor(
    private readonly pluginService: PluginService,
    private readonly storage: PluginStorageService,
    private readonly security: PluginSecurityService,
    private readonly permissions: PluginPermissionService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // MARKETPLACE ENDPOINTS (OWNER SCOPE)
  // ==========================================================================

  @Get('marketplace')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getMarketplacePlugins(
    @Req() req: any,
    @Query() query: PluginMarketplaceFilter,
  ) {
    const actorId = req.user.id;

    return await this.pluginService.getMarketplacePlugins(query);
  }

  @Post()
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.CREATED)
  async createPlugin(
    @Body() input: PluginCreateInput,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const plugin = await this.pluginService.createPlugin(input, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.created',
      resource: 'Plugin',
      payload: {
        pluginId: plugin.id,
        key: plugin.key,
        name: plugin.name,
        type: plugin.type,
      },
    });

    return plugin;
  }

  @Get(':pluginId')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getPlugin(
    @Param('pluginId') pluginId: number,
  ) {
    return await this.pluginService.getPluginById(pluginId);
  }

  @Put(':pluginId')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async updatePlugin(
    @Param('pluginId') pluginId: number,
    @Body() updates: Partial<PluginCreateInput>,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const plugin = await this.pluginService.updatePlugin(pluginId, updates, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.updated',
      resource: 'Plugin',
      payload: {
        pluginId,
        updates,
      },
    });

    return plugin;
  }

  @Post(':pluginId/enable')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async enablePlugin(
    @Param('pluginId') pluginId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const plugin = await this.pluginService.enablePlugin(pluginId, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.enabled',
      resource: 'Plugin',
      payload: { pluginId },
    });

    return plugin;
  }

  @Post(':pluginId/disable')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async disablePlugin(
    @Param('pluginId') pluginId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const plugin = await this.pluginService.disablePlugin(pluginId, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.disabled',
      resource: 'Plugin',
      payload: { pluginId },
    });

    return plugin;
  }

  // ==========================================================================
  // VERSIONING ENDPOINTS (SEMVER + UPGRADE + ROLLBACK)
  // ==========================================================================

  @Post(':pluginId/versions')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.CREATED)
  async uploadVersion(
    @Param('pluginId') pluginId: number,
    @Body() input: PluginVersionUploadInput,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const version = await this.pluginService.uploadVersion(pluginId, input, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.version.uploaded',
      resource: 'PluginVersion',
      payload: {
        pluginId,
        versionId: version.id,
        version: version.version,
        signingVerified: version.signingVerified,
      },
    });

    return version;
  }

  @Get(':pluginId/versions')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getPluginVersions(@Param('pluginId') pluginId: number) {
    return await this.pluginService.getPluginVersions(pluginId);
  }

  @Get('versions/:versionId')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async getPluginVersion(@Param('versionId') versionId: number) {
    return await this.pluginService.getPluginVersionById(versionId);
  }

  @Post(':pluginId/versions/:versionId/promote')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async promoteVersion(
    @Param('pluginId') pluginId: number,
    @Param('versionId') versionId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const version = await this.pluginService.promoteVersion(pluginId, versionId, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.version.promoted',
      resource: 'PluginVersion',
      payload: {
        pluginId,
        versionId,
      },
    });

    return version;
  }

  @Post(':pluginId/versions/:versionId/deprecate')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async deprecateVersion(
    @Param('pluginId') pluginId: number,
    @Param('versionId') versionId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const version = await this.pluginService.deprecateVersion(pluginId, versionId, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.version.deprecated',
      resource: 'PluginVersion',
      payload: {
        pluginId,
        versionId,
      },
    });

    return version;
  }

  @Post(':pluginId/versions/:versionId/rollback-to/:targetVersionId')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.PLUGINS)
  @HttpCode(HttpStatus.OK)
  async rollbackToVersion(
    @Param('pluginId') pluginId: number,
    @Param('versionId') versionId: number,
    @Param('targetVersionId') targetVersionId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const targetVersion = await this.pluginService.rollbackToVersion(pluginId, targetVersionId, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.version.rolledback',
      resource: 'Plugin',
      payload: {
        pluginId,
        fromVersionId: versionId,
        toVersionId: targetVersionId,
      },
    });

    return targetVersion;
  }

  // ==========================================================================
  // INSTALLATION ACROSS WORKSPACES
  // ==========================================================================

  @Post(':pluginId/install')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.WORKSPACE_SETTINGS)
  @HttpCode(HttpStatus.CREATED)
  async installPlugin(
    @Param('pluginId') pluginId: number,
    @Body() input: PluginInstallInput,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const installation = await this.pluginService.installPlugin(pluginId, input, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.installed',
      resource: 'PluginInstallation',
      payload: {
        pluginId,
        workspaceId: input.workspaceId,
        enabled: input.enabled,
      },
    });

    return installation;
  }

  @Post(':pluginId/uninstall')
  @RequirePolicy(PolicyAction.MANAGE_SETTINGS, PolicySubject.WORKSPACE_SETTINGS)
  @HttpCode(HttpStatus.OK)
  async uninstallPlugin(
    @Param('pluginId') pluginId: number,
    @Body() body: { workspaceId: number },
    @Req() req: any,
  ) {
    const actorId = req.user.id;
    const { workspaceId } = body;

    await this.pluginService.uninstallPlugin(workspaceId, pluginId, actorId);

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.uninstalled',
      resource: 'PluginInstallation',
      payload: {
        pluginId,
        workspaceId,
      },
    });

    return { message: 'Plugin uninstalled' };
  }

  @Get('installations')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.WORKSPACE_SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getInstallations(
    @Req() req: any,
    @Query('workspaceId') workspaceId: number,
  ) {
    const actorId = req.user.id;

    return await this.pluginService.getWorkspacePlugins(workspaceId);
  }
}
