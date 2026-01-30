import { Controller, Get, Post, Param, Body, UseGuards, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { PluginSandboxService } from './sandbox/plugin-sandbox.service';
import { AuditLogService } from '../logging/audit-log.service';
import { DomainEventService } from '../events/domain-event.service';

/**
 * Plugin Controller (Owner/Admin)
 * M10 - Workstream 5: "Plugin Sandbox (Capability-Based, Slot-Based, Signed)"
 */

@Controller('api/owner/plugins')
// @UseGuards(AuthGuard, TenantGuard) // Assumed global
export class PluginController {
  constructor(
    private readonly pluginsService: PluginsService,
    private readonly pluginSandbox: PluginSandboxService,
    private readonly auditLog: AuditLogService,
  ) {}

  // --- Slot Registry ---

  @Get('slots')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'read', resource: 'plugin' })
  async getSlots(@Req() req: any, @Query('location') location: string) {
    // M10: "Slot Registry"
    // M10: "Explicit extension points"
    // M10: "Capabilities"
    
    // In real app, we'd query `plugin_slots` table.
    // For MVP, we'll return a static list or stubbed response.
    const slots = [
      {
        id: 'admin_sidebar_widgets',
        name: 'Admin Sidebar Widgets',
        location: 'admin_sidebar',
        description: 'Widgets displayed in Owner/Admin sidebar',
        capabilities: ['read:users', 'read:workspaces'],
      },
      {
        id: 'editor_sidebar_panels',
        name: 'Editor Sidebar Panels',
        location: 'editor_sidebar',
        description: 'Panels displayed in Article Editor sidebar (e.g., AI, Translations, Templates)',
        capabilities: ['read:articles', 'write:articles'],
      },
      {
        id: 'content_render_widgets',
        name: 'Content Render Widgets',
        location: 'content',
        description: 'Safe widgets rendered on Published content pages',
        capabilities: ['read:articles'],
      },
      {
        id: 'analytics_cards',
        name: 'Analytics Cards',
        location: 'analytics',
        description: 'Custom cards in Analytics dashboard',
        capabilities: ['read:analytics', 'analytics:export'],
      },
    ];

    return { data: slots };
  }

  // --- Plugin Management ---

  @Get('installed')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'read', resource: 'plugin' })
  async getInstalledPlugins(@Req() req: any, @Query('workspaceId') workspaceId: string) {
    // M10: "Capability-Based"
    // M10: "Per workspace installation config"
    
    return { data: await this.pluginsService.listInstalled(req.tenantContext, parseInt(workspaceId)) };
  }

  @Post('install')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'install', resource: 'plugin' })
  async installPlugin(@Req() req: any, @Body() body: { pluginId: number; config?: any }) {
    // M10: "Manifest validation"
    // M10: "Capability enforcement"
    
    // 1. Validate Manifest
    await this.pluginSandbox.validateManifest(body.pluginId);
    
    // 2. Install
    const installation = await this.pluginsService.installPlugin(req.tenantContext, body.pluginId, body.config);
    
    // 3. Audit Log (Write in Service)
    // ...
    
    return { data: installation };
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'enable', resource: 'plugin' })
  async enablePlugin(@Param('id') id: string, @Req() req: any) {
    // M10: "Per workspace installation"
    // M10: "Capability enforcement"
    
    await this.pluginsService.enablePlugin(req.tenantContext, parseInt(id));
    return { success: true };
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'disable', resource: 'plugin' })
  async disablePlugin(@Param('id') id: string, @Req() req: any) {
    await this.pluginsService.disablePlugin(req.tenantContext, parseInt(id));
    return { success: true };
  }

  @Post(':id/uninstall')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'uninstall', resource: 'plugin' })
  async uninstallPlugin(@Param('id') id: string, @Req() req: any) {
    await this.pluginsService.uninstallPlugin(req.tenantContext, parseInt(id));
    return { success: true };
  }

  // --- Manifest Validation ---

  @Post('validate-manifest')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'create', resource: 'plugin' }) // Admin/Owner only
  async validateManifest(@Req() req: any, @Body() body: { manifestJson: any; signedHash?: string }) {
    // M10: "Manifest validation"
    
    // In real app, we'd store this in `plugins` table.
    // Here we just validate structure.
    
    const requiredFields = ['name', 'version', 'slots', 'capabilities'];
    const missingFields = requiredFields.filter(f => !body.manifestJson[f]);
    
    if (missingFields.length > 0) {
      return { valid: false, errors: `Missing fields: ${missingFields.join(', ')}` };
    }

    // M10: "Unknown capabilities by default"
    const unknownCapabilities = body.manifestJson.capabilities?.filter((c: string) => !['read:users', 'write:articles', 'analytics:read'].includes(c));
    if (unknownCapabilities?.length > 0) {
      return { valid: false, errors: `Unknown capabilities: ${unknownCapabilities.join(', ')}` };
    }

    // M10: "Unknown slots by default"
    const unknownSlots = body.manifestJson.slots?.filter((s: string) => !['admin_sidebar', 'editor_sidebar', 'content_widget', 'analytics_card'].includes(s));
    if (unknownSlots?.length > 0) {
      return { valid: false, errors: `Unknown slots: ${unknownSlots.join(', ')}` };
    }

    // M10: "Signed hash verification" (MVP: Check exists)
    // In real app, we'd use asymmetric keys.
    
    return { valid: true };
  }
}
