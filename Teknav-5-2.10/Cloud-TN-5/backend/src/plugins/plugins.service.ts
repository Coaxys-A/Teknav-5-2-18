import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { DomainEventService } from '../../events/domain-event.service';
import { PluginSandboxService } from './sandbox/plugin-sandbox.service';

/**
 * Plugins Service (Sandbox)
 * M10 - Workstream 5: "Plugin Sandbox (Capability-Based, Slot-Based, Signed)"
 * 
 * Features:
 * - Install/Uninstall/Enable/Disable.
 * - Manifest Validation (via `PluginSandboxService`).
 * - Capability Enforcement.
 */

@Injectable()
export class PluginsService {
  private readonly logger = new Logger(PluginsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly domainEvent: DomainEventService,
    private readonly pluginSandbox: PluginSandboxService,
  ) {}

  /**
   * Install Plugin
   */
  async installPlugin(actor: any, pluginId: number, config?: any) {
    // 1. Validate Manifest (Sandbox)
    await this.pluginSandbox.validateManifest(pluginId);

    // 2. Check Existing
    const existing = await this.prisma.pluginInstallation.findFirst({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        pluginId,
      },
    });

    if (existing) {
      throw new Error('Plugin already installed');
    }

    // 3. Create Installation
    const installation = await this.prisma.pluginInstallation.create({
      data: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        pluginId,
        configJson: config || {},
        enabled: true,
        installedAt: new Date(),
        updatedAt: new Date(),
        installedBy: actor.userId,
      },
    });

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'plugin.installed',
      resource: `Plugin:${pluginId}`,
      payload: { config },
    });

    // 5. Domain Event (Internal)
    await this.domainEvent.publish('plugins', {
      id: DomainEventService.generateId(),
      type: 'plugin.installed',
      time: new Date(),
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      actor: { id: actor.userId },
      object: { type: 'Plugin', id: pluginId },
      data: { installationId: installation.id, config },
    });

    return installation;
  }

  /**
   * Uninstall Plugin
   */
  async uninstallPlugin(actor: any, pluginId: number) {
    // 1. Find Installation
    const installation = await this.prisma.pluginInstallation.findFirst({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        pluginId,
      },
    });

    if (!installation) {
      throw new Error('Plugin installation not found');
    }

    // 2. Delete Installation
    await this.prisma.pluginInstallation.deleteMany({
      where: {
        id: installation.id,
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
      },
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'plugin.uninstalled',
      resource: `Plugin:${pluginId}`,
      payload: { installationId: installation.id },
    });

    // 4. Domain Event (Internal)
    await this.domainEvent.publish('plugins', {
      id: DomainEventService.generateId(),
      type: 'plugin.uninstalled',
      time: new Date(),
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      actor: { id: actor.userId },
      object: { type: 'Plugin', id: pluginId },
      data: { installationId: installation.id },
    });

    return { success: true };
  }

  /**
   * Enable Plugin
   */
  async enablePlugin(actor: any, pluginId: number) {
    // 1. Update Status
    const installation = await this.prisma.pluginInstallation.updateMany({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        pluginId,
      },
      data: {
        enabled: true,
        updatedAt: new Date(),
      },
    });

    // 2. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'plugin.enabled',
      resource: `Plugin:${pluginId}`,
      payload: {},
    });

    // 3. Domain Event (Internal)
    await this.domainEvent.publish('plugins', {
      id: DomainEventService.generateId(),
      type: 'plugin.enabled',
      time: new Date(),
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      actor: { id: actor.userId },
      object: { type: 'Plugin', id: pluginId },
      data: {},
    });

    return { success: true };
  }

  /**
   * Disable Plugin
   */
  async disablePlugin(actor: any, pluginId: number) {
    // 1. Update Status
    const installation = await this.prisma.pluginInstallation.updateMany({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        pluginId,
      },
      data: {
        enabled: false,
        updatedAt: new Date(),
      },
    });

    // 2. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'plugin.disabled',
      resource: `Plugin:${pluginId}`,
      payload: {},
    });

    // 3. Domain Event (Internal)
    await this.domainEvent.publish('plugins', {
      id: DomainEventService.generateId(),
      type: 'plugin.disabled',
      time: new Date(),
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      actor: { id: actor.userId },
      object: { type: 'Plugin', id: pluginId },
      data: {},
    });

    return { success: true };
  }

  /**
   * List Installed Plugins
   */
  async listInstalled(actor: any, workspaceId: number) {
    return await this.prisma.pluginInstallation.findMany({
      where: {
        tenantId: actor.tenantId,
        workspaceId,
        enabled: true, // Only Active Plugins
      },
      include: {
        plugin: true, // Include Plugin Manifest
      },
      orderBy: { installedAt: 'desc' },
    });
  }
}
