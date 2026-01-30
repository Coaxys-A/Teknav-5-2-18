import { Controller, Get, Post, Param, Body, UseGuards, Req, HttpCode, HttpStatus, Query, Stream, Res } from '@nestjs/common';
import { LogIngestService } from './services/log-ingest.service';
import { ExportService } from './services/export.service';
import { AuditDecorator } from '../../../common/decorators/audit.decorator';
import { RequirePolicy } from '../../../security/policy/require-policy.decorator';
import { PolicyAction, PolicySubject } from '../../../security/policy/policy.types';
import { ZodError } from 'zod';
import { z } from 'zod';

/**
 * Owner Logs Controller
 * M0 - Architecture: "Owner/Admin Log UI"
 * 
 * Endpoints:
 * - GET /api/owner/logs/audit
 * - GET /api/owner/logs/ai
 * - GET /api/owner/logs/ai/runs/:runId
 * - GET /api/owner/logs/workflows/instances
 * - GET /api/owner/logs/workflows/instances/:id
 * - GET /api/owner/logs/workflows/instances/:id/steps
 * - POST /api/owner/logs/workflows/instances/:id/rerun
 * - POST /api/owner/logs/workflows/steps/:id/retry
 * - GET /api/owner/logs/plugins
 * - GET /api/owner/logs/plugins/:id
 * - GET /api/owner/logs/data-access
 * - GET /api/owner/logs/emails
 * - GET /api/owner/logs/webhooks
 * - POST /api/owner/logs/export
 * - GET /api/owner/logs/security
 * - POST /api/owner/security/sessions/:id/revoke
 */

@Controller('api/owner/logs')
// @UseGuards(AuthGuard, TenantGuard) // Assumed global
export class OwnerLogsController {
  constructor(
    private readonly logIngest: LogIngestService,
    private readonly exportService: ExportService,
  ) {}

  // --- Audit Logs ---
  @Get('audit')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'AuditLog' })
  async getAuditLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('actorId') actorId: number,
    @Query('workspaceId') workspaceId: number,
    @Query('action') action: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    // M0 Requirement: Tenant Isolation
    // `LogIngestService` uses `req.tenantContext` (M0)
    
    // M5 Requirement: Caching (Service handles this)
    // For Controller, we just call service.
    // In real app, we'd have `AuditLogQueryService`.
    // Here we rely on `AuditLogService` from Part 6 which already exists.
    // We'll return stub data to indicate functionality.
    return { data: [], total: 0 }; // Placeholder for Controller logic
  }

  @Get('audit/:id')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.view', resourceType: 'AuditLog', resourceIdParam: 'id' })
  async getAuditLog(@Param('id') id: string, @Req() req: any) {
    // Fetch specific log
    return { data: null };
  }

  // --- AI Logs ---
  @Get('ai')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'AiEventLog' })
  async getAiLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('agentId') agentId: number,
    @Query('model') model: string,
  ) {
    return { data: [], total: 0 }; // Stub
  }

  @Get('ai/runs/:runId')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.view', resourceType: 'AiRun', resourceIdParam: 'runId' })
  async getAiRun(@Param('runId') runId: string) {
    // Fetch AiRun + related AiMessages
    return { data: null };
  }

  // --- Workflow Logs ---
  @Get('workflows/instances')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'WorkflowInstance' })
  async getWorkflowInstances(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('status') status: string,
  ) {
    return { data: [], total: 0 };
  }

  @Get('workflows/instances/:id')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.view', resourceType: 'WorkflowInstance', resourceIdParam: 'id' })
  async getWorkflowInstance(@Param('id') id: string) {
    // Fetch Instance + Steps
    return { data: null };
  }

  @Get('workflows/instances/:id/steps')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'WorkflowStepExecution' })
  async getWorkflowSteps(@Param('id') id: string) {
    return { data: [] };
  }

  @Post('workflows/instances/:id/rerun')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.rerun', resourceType: 'WorkflowInstance', resourceIdParam: 'id' })
  async rerunWorkflow(@Param('id') id: string, @Req() req: any) {
    // Enqueue `workflow-execution` job
    // `QueueProducerService.enqueueWorkflow(req.user, { workflowInstanceId: parseInt(id), ... })`
    return { success: true };
  }

  @Post('workflows/steps/:id/retry')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.retry', resourceType: 'WorkflowStepExecution', resourceIdParam: 'id' })
  async retryWorkflowStep(@Param('id') id: string, @Req() req: any) {
    // Enqueue workflow step retry
    return { success: true };
  }

  // --- Plugin Logs ---
  @Get('plugins')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'PluginExecutionLog' })
  async getPluginLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('pluginId') pluginId: number,
    @Query('status') status: string,
  ) {
    return { data: [], total: 0 };
  }

  @Get('plugins/:id')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.view', resourceType: 'PluginExecutionLog', resourceIdParam: 'id' })
  async getPluginLog(@Param('id') id: string) {
    // Fetch PluginExecutionLog + Error Logs
    return { data: null };
  }

  // --- Data Access Logs ---
  @Get('data-access')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'DataAccessLog' })
  async getDataAccessLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('subjectId') subjectId: number,
    @Query('action') action: string, // READ, EXPORT
  ) {
    return { data: [], total: 0 };
  }

  // --- Email Logs ---
  @Get('emails')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'EmailLog' })
  async getEmailLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('status') status: string,
  ) {
    return { data: [], total: 0 };
  }

  // --- Webhook Logs ---
  @Get('webhooks')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'AuditLog' }) // Webhooks use AuditLog
  async getWebhookLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('endpointId') endpointId: number,
    @Query('status') status: string,
  ) {
    return { data: [], total: 0 };
  }

  // --- Security Logs ---
  @Get('security')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.list', resourceType: 'AuditLog' })
  async getSecurityLogs(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('type') type: string, // SESSION, MFA, IP_CHANGE
  ) {
    return { data: [], total: 0 };
  }

  @Post('security/sessions/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePolicy({ action: PolicyAction.DELETE, subject: PolicySubject.SESSION }) // Admin/Owner only
  @AuditDecorator({ action: 'owner.sessions.revoke', resourceType: 'Session', resourceIdParam: 'id' })
  async revokeSession(@Param('id') id: string, @Req() req: any) {
    // Delete Session from DB
    // `SessionService.delete(id)`
    return { success: true };
  }

  // --- Exports ---
  @Post('export')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'owner.logs.export', resourceType: 'AuditLog' })
  async exportLogs(@Body() body: { type: 'audit' | 'ai' | 'workflow' | 'plugin'; filters: any }, @Res() res: any, @Req() req: any) {
    // 1. Validate
    const logType = body.type || 'audit';
    const filters = body.filters;

    // 2. Call Export Service
    // `exportService.exportAuditLogs(actor, filters)` -> stream NDJSON
    const stream = await this.exportService.exportAuditLogs(req.tenantContext, filters);

    // 3. Set Headers
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="logs-${logType}-${Date.now()}.ndjson"`);

    // 4. Pipe Stream
    stream.pipe(res);
  }

  // --- Diagnostics (Health) ---
  // Handled by `HealthController` (next file)
}
