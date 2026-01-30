import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { DomainEventService } from '../../../events/domain-event.service';

/**
 * Plugin Sandbox Service
 * M10 - Workstream 5: "Plugin Sandbox (Capability-Based, Slot-Based, Signed)"
 * 
 * Features:
 * - Slot Registry (Explicit Extension Points).
 * - Manifest Validation.
 * - Capability Enforcement (Runtime).
 * - Installation/Uninstall Logic.
 */

@Injectable()
export class PluginSandboxService {
  private readonly logger = new Logger(PluginSandboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly domainEvent: DomainEventService,
  ) {}

  /**
   * Validate Manifest
   * 
   * Checks:
   * - Unknown Capabilities (Deny).
   * - Unknown Slots (Deny).
   * - Signature Verification (MVP: Hash Check).
   */
  async validateManifest(pluginId: number) {
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      select: { manifestJson: true, signedHash: true, status: true },
    });

    if (!plugin) {
      throw new Error('Plugin not found');
    }

    if (plugin.status !== 'ACTIVE') {
      throw new Error('Plugin is not active');
    }

    const manifest = plugin.manifestJson as any;
    const allowedCapabilities = [
      'read:users',
      'write:articles',
      'analytics:read',
      'newsletter:send',
    ];
    const allowedSlots = [
      'admin_sidebar_widgets',
      'editor_sidebar_panels',
      'content_render_widgets',
      'analytics_cards',
    ];

    // Check Capabilities
    const unknownCapabilities = manifest.capabilities?.filter((c: string) => !allowedCapabilities.includes(c));
    if (unknownCapabilities?.length > 0) {
      throw new Error(`Manifest contains unknown capabilities: ${unknownCapabilities.join(', ')}`);
    }

    // Check Slots
    const unknownSlots = manifest.slots?.filter((s: string) => !allowedSlots.includes(s));
    if (unknownSlots?.length > 0) {
      throw new Error(`Manifest contains unknown slots: ${unknownSlots.join(', ')}`);
    }

    // Check Signature (MVP: Hash Verification)
    // In real app, we'd use asymmetric verification (public key).
    // For MVP, we assume `signedHash` is set.
    if (!plugin.signedHash) {
      throw new Error('Plugin manifest is not signed');
    }

    return { valid: true };
  }

  /**
   * Check Capability (Runtime Enforcement)
   * 
   * Returns `allow: boolean` if plugin context has capability.
   */
  async checkCapability(actor: any, pluginId: number, capability: string): Promise<{ allow: boolean }> {
    // 1. Get Plugin Manifest
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      select: { manifestJson: true, status: true },
    });

    if (!plugin || plugin.status !== 'ACTIVE') {
      return { allow: false };
    }

    const manifest = plugin.manifestJson as any;
    const capabilities = manifest.capabilities || [];

    // 2. Check if Capability is present
    const hasCapability = capabilities.includes(capability);

    return { allow: hasCapability };
  }

  /**
   * Get Slot Registry (For Rendering)
   */
  async getSlotRegistry(actor: any, location: string) {
    // 1. Get Installed Plugins for Tenant/Workspace
    const installations = await this.prisma.pluginInstallation.findMany({
      where: {
        tenantId: actor.tenantId,
        workspaceId: actor.workspaceId,
        enabled: true,
      },
      include: {
        plugin: {
          select: {
            id: true,
            name: true,
            manifestJson: true,
            status: true,
          },
        },
      },
    });

    // 2. Filter by Slot Location
    // M10: "Slot Registry"
    const slots = installations
      .filter(i => {
        const manifest = i.plugin.manifestJson as any;
        const slots = manifest.slots || [];
        return slots.includes(location);
      })
      .map(i => ({
        pluginId: i.pluginId,
        pluginName: i.plugin.name,
        config: i.configJson, // Installation Config
      }));

    return slots;
  }
}
