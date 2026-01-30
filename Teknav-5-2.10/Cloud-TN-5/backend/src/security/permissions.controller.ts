import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, HttpCode, HttpStatus, ParseIntPipe } from '@nestjs/common';
import { PermissionManagementService } from './permission/permission-management.service';
import { PolicyAction, PolicySubject } from '../policy/policy.types';
import { RequirePolicy } from '../policy/require-policy.decorator';
import { AuditDecorator } from '../../../common/decorators/audit.decorator';

/**
 * Security / Permissions Controller
 *
 * Owner/Admin APIs to manage permission matrix.
 */

@Controller('api/owner/security/permissions')
// @UseGuards(AuthGuard)
export class OwnerPermissionsController {
  constructor(private readonly permissionService: PermissionManagementService) {}

  @Get('')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'security.permissions.list', resourceType: 'Permissions' })
  async getPermissions(@Req() req: any) {
    // Return Default Matrix
    // For MVP, we just return default. Real app would merge Tenant/Workspace.
    return await this.permissionService.getDefaultMatrix();
  }

  @Put('tenant/:tenantId')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.MANAGE_TENANT, subject: PolicySubject.TENANT })
  @AuditDecorator({ action: 'security.permissions.set.tenant', resourceType: 'Permissions', resourceIdParam: 'tenantId' })
  async setTenantPermissions(@Param('tenantId') tenantId: string, @Body() body: any, @Req() req: any) {
    await this.permissionService.setTenantPermissions(req.user, parseInt(tenantId), body);
    return { success: true };
  }

  @Put('workspace/:workspaceId')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.MANAGE_ROLES, subject: PolicySubject.WORKSPACE })
  @AuditDecorator({ action: 'security.permissions.set.workspace', resourceType: 'Permissions', resourceIdParam: 'workspaceId' })
  async setWorkspacePermissions(@Param('workspaceId') workspaceId: string, @Body() body: any, @Req() req: any) {
    await this.permissionService.setWorkspacePermissions(req.user, parseInt(workspaceId), body);
    return { success: true };
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.MANAGE_TENANT, subject: PolicySubject.TENANT })
  @AuditDecorator({ action: 'security.permissions.reset', resourceType: 'Permissions' })
  async resetPermissions(@Body() body: { tenantId: number; workspaceId: number }, @Req() req: any) {
    await this.permissionService.resetPermissions(req.user, body.tenantId, body.workspaceId);
    return { success: true };
  }
}

@Controller('api/admin/security/permissions')
// @UseGuards(AuthGuard)
export class AdminPermissionsController {
  constructor(private readonly permissionService: PermissionManagementService) {}

  @Get('')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'security.permissions.list', resourceType: 'Permissions' })
  async getPermissions(@Req() req: any) {
    // Return Effective Permissions for User's Workspace
    const workspaceId = req.workspaceId;
    const tenantId = req.tenantId; // From Access Context Service ideally
    return await this.permissionService.getMatrix(tenantId, workspaceId);
  }

  @Post('request-change')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'security.permissions.request', resourceType: 'Permissions' })
  async requestChange(@Body() body: { requestedMatrix: any; reason: string }, @Req() req: any) {
    // Log + Notify Owner (Stubbed Notification)
    await this.permissionService.logChangeRequest(req.user, body);
    return { success: true };
  }
}
