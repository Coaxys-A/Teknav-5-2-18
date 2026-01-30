import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { CsrfService } from '../csrf/csrf.service';
import { SessionService } from '../session/session.service';
import { PolicyEngineService, POLICY_ACTIONS, POLICY_RESOURCES } from '../policies/policy-engine.service';
import { AuditLogService } from '../../logging/audit-log.service';
import { RequirePolicy } from '../../../common/decorators/require-policy.decorator';
import { z } from 'zod';

/**
 * Security Controller
 * M10 - Security Center: "Owner/Admin Security APIs"
 * 
 * Endpoints:
 * - CSRF
 * - Sessions (List, Revoke)
 * - Devices (List, Trust Toggle)
 * - Bans (List, Create, Delete)
 * - Settings (CRUD)
 */

@Controller('api/owner/security')
@UseGuards() // AuthGuard + TenantGuard assumed global
export class SecurityController {
  constructor(
    private readonly csrfService: CsrfService,
    private readonly sessionService: SessionService,
    private readonly policyService: PolicyEngineService,
    private readonly auditLog: AuditLogService,
  ) {}

  // --- CSRF ---

  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.READ, resource: POLICY_RESOURCES.AUDIT_LOG }) // Low threshold
  async getCsrfToken(@Req() req: any) {
    const token = await this.csrfService.issueToken(req.tenantContext?.sessionId || 'guest');
    return { data: { token } };
  }

  // --- Settings (CRUD) ---

  @Get('settings')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_SECURITY, resource: POLICY_RESOURCES.TENANT })
  async getSettings(@Req() req: any) {
    // M10: Stored in `Tenant.configuration` (JSON) or `Workspace.entitlements` (JSON)
    // For MVP, we return stub data.
    // In real app, we'd query `Tenant` table or `Workspace` table.
    const settings = {
      rateLimits: { perIp: 60, perUser: 120, window: 60 },
      bruteForce: { threshold: 5, window: 300 },
      sessionTtl: 86400, // 24 hours
      requireCsrf: true,
    };

    // M10: "RBAC... Owner/Admin APIs"
    // `RequirePolicy` ensures user is Owner/Admin.
    return { data: settings };
  }

  @Patch('settings')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_SECURITY, resource: POLICY_RESOURCES.TENANT })
  async updateSettings(@Req() req: any, @Body() body: {
    rateLimits?: { perIp?: number; perUser?: number; window?: number };
    bruteForce?: { threshold?: number; window?: number };
    sessionTtl?: number;
  }) {
    // M10: Zod validation
    // const validatedData = securitySettingsSchema.parse(body);
    // We'll trust the controller injection or implement explicit Zod here.

    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId,
      action: 'security.settings.updated',
      resource: 'TenantSecuritySettings',
      payload: body,
    });

    // M10: "RBAC... Server-Side" - `RequirePolicy` ensures this.
    // M5: "Audit Log" - Above.

    // M10: "No schema changes" - Stored in `Tenant.configuration` JSON (MVP Stub).

    return { success: true };
  }

  // --- Sessions ---

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_SESSIONS, resource: POLICY_RESOURCES.SESSION })
  async getSessions(
    @Req() req: any,
    @Query('userId') userId: string,
    @Query('ip') ip: string,
    @Query('activeOnly') activeOnly: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ) {
    // M10: Filter + Pagination (M0 - Caching)
    // M10: Realtime (Redis).
    // M10: "Owner/Admin Security UI".
    
    // Stubbed Implementation:
    // In real app, `SessionService` would query DB/Redis.
    const sessions = await this.sessionService.listSessions(req.tenantContext, {
      userId: userId ? parseInt(userId) : undefined,
      ip,
      activeOnly: activeOnly === 'true',
      page,
      pageSize,
    });

    return { data: sessions };
  }

  @Post('sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.REVOKE_SESSION, resource: POLICY_RESOURCES.SESSION, resourceIdParam: 'id' })
  async revokeSession(@Param('id') id: string, @Req() req: any) {
    // M10: "Session Hardening: rotation, revocation"
    await this.sessionService.revokeSession(req.tenantContext, parseInt(id));
    
    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId,
      action: 'security.session.revoked',
      resource: `Session:${id}`,
      payload: { sessionId: id },
    });

    return { success: true };
  }

  @Post('users/:id/revoke-all-sessions')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_USERS, resource: POLICY_RESOURCES.USER, resourceIdParam: 'id' })
  async revokeAllSessions(@Param('id') id: string, @Req() req: any) {
    await this.sessionService.revokeAllSessions(req.tenantContext, parseInt(id));

    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId,
      action: 'security.users.sessions.revoked',
      resource: `User:${id}`,
      payload: { userId: id },
    });

    return { success: true };
  }

  // --- Devices ---

  @Get('devices')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_DEVICES, resource: POLICY_RESOURCES.DEVICE })
  async getDevices(@Req() req: any, @Query('page') page = 1, @Query('pageSize') pageSize = 20) {
    // M10: Device Trust (Toggle).
    // M10: "Owner/Admin Security UI".
    // Stubbed Implementation:
    const devices = await this.sessionService.listDevices(req.tenantContext, page, pageSize);
    return { data: devices };
  }

  @Patch('devices/:id/trust')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_DEVICES, resource: POLICY_RESOURCES.DEVICE, resourceIdParam: 'id' })
  async setDeviceTrust(@Param('id') id: string, @Body() body: { trusted: boolean }) {
    // M10: Device Trust Logic
    await this.sessionService.updateDeviceTrust(req.tenantContext, parseInt(id), body.trusted);
    
    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId,
      action: 'security.device.trust.updated',
      resource: `Device:${id}`,
      payload: body,
    });

    return { success: true };
  }

  // --- Bans ---

  @Get('bans')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_BANS, resource: POLICY_RESOURCES.BAN })
  async getBans(@Req() req: any, @Query('page') page = 1, @Query('pageSize') pageSize = 20) {
    // M10: "Owner/Admin Security UI".
    // M10: "Temporary Bans" (Redis).
    // Stubbed Implementation:
    const bans = await this.policyService.listBans(req.tenantContext, page, pageSize);
    return { data: bans };
  }

  @Post('bans')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_BANS, resource: POLICY_RESOURCES.BAN })
  async createBan(@Req() req: any, @Body() body: { kind: 'ip' | 'user'; target: string; ttlSeconds: number; reason: string }) {
    // M10: Zod Validation
    // const validated = banSchema.parse(body);
    
    // M10: "Temporary Bans" (Redis).
    await this.policyService.createBan(req.tenantContext, body);

    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId,
      action: 'security.ban.created',
      resource: `Ban:${body.kind}:${body.target}`,
      payload: body,
    });

    return { success: true };
  }

  @Delete('bans')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: POLICY_ACTIONS.MANAGE_BANS, resource: POLICY_RESOURCES.BAN })
  async removeBan(@Req() req: any, @Body() body: { kind: 'ip' | 'user'; target: string }) {
    // M10: Remove Ban (Delete Redis Key)
    await this.policyService.removeBan(req.tenantContext, body);

    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId,
      action: 'security.ban.deleted',
      resource: `Ban:${body.kind}:${body.target}`,
      payload: body,
    });

    return { success: true };
  }
}
