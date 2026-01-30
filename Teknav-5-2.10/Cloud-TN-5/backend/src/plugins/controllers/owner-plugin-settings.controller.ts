import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';
import { AuditLogService } from '../../logging/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Plugin Settings + Secrets Controller (Owner + Workspace)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 */

@Controller('api/owner/workspaces/:workspaceId/plugins')
@UseGuards(PoliciesGuard)
export class OwnerPluginSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ==========================================================================
  // SETTINGS (MANIFEST SCHEMA)
  // ==========================================================================

  @Get(':pluginId/settings-schema')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getSettingsSchema(
    @Param('pluginId') pluginId: number,
  ) {
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      include: { latestVersion: true },
    });

    if (!plugin || !plugin.latestVersion) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const manifest = JSON.parse(plugin.latestVersion.manifest);

    // Extract settings schema from manifest
    // Format: { settingsSchema: { key: { type, description, default, required } } }
    const settingsSchema = (manifest.settingsSchema as any) || {};

    return {
      data: settingsSchema,
      pluginId,
      pluginKey: plugin.key,
      pluginName: plugin.name,
    };
  }

  @Get(':pluginId/settings')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getPluginSettings(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
  ) {
    const settings = await this.prisma.pluginSettings.findMany({
      where: {
        workspaceId,
        pluginId,
      },
    });

    return {
      data: settings.map(s => ({
        settingKey: s.settingKey,
        settingValue: JSON.parse(s.settingValue),
        updatedAt: s.updatedAt,
      })),
    };
  }

  @Put(':pluginId/settings')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async updatePluginSettings(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Body() body: { settingKey: string; settingValue: any },
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    // Upsert setting
    const setting = await this.prisma.pluginSettings.upsert({
      where: {
        workspaceId_pluginId_settingKey: {
          workspaceId,
          pluginId,
          settingKey: body.settingKey,
        },
      },
      create: {
        workspaceId,
        pluginId,
        settingKey: body.settingKey,
        settingValue: JSON.stringify(body.settingValue),
        createdById: actorId,
        createdAt: new Date(),
      },
      update: {
        settingValue: JSON.stringify(body.settingValue),
        updatedById: actorId,
        updatedAt: new Date(),
      },
    });

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.setting.updated',
      resource: `PluginSetting`,
      payload: {
        workspaceId,
        pluginId,
        settingKey: body.settingKey,
      },
    });

    return setting;
  }

  // ==========================================================================
  // SECRETS (WRITE-ONLY IN UI)
  // ==========================================================================

  @Get(':pluginId/secrets')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async getPluginSecrets(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
  ) {
    const secrets = await this.prisma.pluginSecret.findMany({
      where: {
        workspaceId,
        pluginId,
      },
      select: {
        id: true,
        secretKey: true,
        createdAt: true,
        updatedAt: true,
        // Do NOT return secretValue!
      },
    });

    return {
      data: secrets,
    };
  }

  @Post(':pluginId/secrets')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.CREATED)
  async createSecret(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Body() body: { secretKey: string; secretValue: string; description?: string },
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const secret = await this.prisma.pluginSecret.create({
      data: {
        workspaceId,
        pluginId,
        secretKey: body.secretKey,
        secretValue: body.secretValue, // In production, encrypt this!
        description: body.description,
        createdById: actorId,
        createdAt: new Date(),
      },
    });

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.secret.created',
      resource: `PluginSecret`,
      payload: {
        workspaceId,
        pluginId,
        secretKey: body.secretKey,
      },
    });

    // Return secret without value (for security)
    return {
      data: {
        id: secret.id,
        secretKey: secret.secretKey,
        createdAt: secret.createdAt,
        updatedAt: secret.updatedAt,
      },
    };
  }

  @Put(':pluginId/secrets/:secretId')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async updateSecret(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Param('secretId') secretId: number,
    @Body() body: { secretValue: string; description?: string },
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    const secret = await this.prisma.pluginSecret.update({
      where: {
        id: secretId,
        workspaceId,
        pluginId,
      },
      data: {
        secretValue: body.secretValue, // Encrypt in production!
        description: body.description,
        updatedById: actorId,
        updatedAt: new Date(),
      },
    });

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.secret.updated',
      resource: `PluginSecret`,
      payload: {
        workspaceId,
        pluginId,
        secretId,
      },
    });

    return secret;
  }

  @Delete(':pluginId/secrets/:secretId')
  @RequirePolicy(PolicyAction.UPDATE, PolicySubject.SETTINGS)
  @HttpCode(HttpStatus.OK)
  async deleteSecret(
    @Param('workspaceId') workspaceId: number,
    @Param('pluginId') pluginId: number,
    @Param('secretId') secretId: number,
    @Req() req: any,
  ) {
    const actorId = req.user.id;

    await this.prisma.pluginSecret.deleteMany({
      where: {
        id: secretId,
        workspaceId,
        pluginId,
      },
    });

    // Audit log
    await this.auditLog.logAction({
      actorUserId: actorId,
      action: 'plugin.secret.deleted',
      resource: `PluginSecret`,
      payload: {
        workspaceId,
        pluginId,
        secretId,
      },
    });

    return { message: 'Secret deleted' };
  }
}
