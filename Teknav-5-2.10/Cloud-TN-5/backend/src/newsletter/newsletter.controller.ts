import { Controller, Get, Post, Param, Body, UseGuards, Req, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { AuditLogService } from '../logging/audit-log.service';
import { RequirePolicy } from '../../../common/decorators/require-policy.decorator';
import { PolicyEngineService } from '../security/policy-engine/policy-engine.service';
import { z } from 'zod';

/**
 * Newsletter Controller
 * M10 - Workstream 1: "Newsletter Send Pipeline (Deliverability-Safe, Consent-Aware)"
 * 
 * Endpoints:
 * - POST /newsletter/subscribers
 * - GET /newsletter/subscribers
 * - POST /newsletter/segments
 * - POST /newsletter/campaigns
 * - GET /newsletter/campaigns/:id
 * - POST /newsletter/campaigns/:id/send
 * - POST /newsletter/webhooks/provider (Bounce/Unsub/Click/Open)
 */

@Controller('api/newsletter')
// @UseGuards(AuthGuard, TenantGuard) // Assumed global
export class NewsletterController {
  constructor(
    private readonly newsletterService: NewsletterService,
    private readonly auditLog: AuditLogService,
  ) {}

  // --- Subscribers ---

  @Get('subscribers')
  @HttpCode(HttpStatus.OK)
  // @RequirePolicy({ action: 'read', resource: 'subscriber' }) // Optional
  async getSubscribers(
    @Req() req: any,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
    @Query('status') status: string,
    @Query('q') q: string,
  ) {
    return { data: await this.newsletterService.listSubscribers(req.tenantContext, { page, pageSize, status, q }) };
  }

  @Post('subscribers')
  @HttpCode(HttpStatus.OK)
  async createSubscriber(@Req() req: any, @Body() body: { email: string; preferences?: any; source?: string }) {
    // M10: Zod Validation (Zod schema placeholder)
    // const validatedData = subscriberSchema.parse(body);
    
    // M10: "Consent-Aware" (Audit Log)
    await this.auditLog.logAction({
      actorUserId: req.tenantContext?.userId || 0, // Public action?
      action: 'newsletter.subscriber.created',
      resource: 'Subscriber',
      payload: body,
    });

    return { data: await this.newsletterService.createSubscriber(req.tenantContext, body) };
  }

  // --- Segments ---

  @Post('segments')
  @HttpCode(HttpStatus.OK)
  async createSegment(@Req() req: any, @Body() body: { name: string; query: any }) {
    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext.userId,
      action: 'newsletter.segment.created',
      resource: 'Segment',
      payload: body,
    });

    // M10: "Segmentation" (Service logic)
    // Stubbed: Service doesn't have method yet.
    return { success: true };
  }

  // --- Campaigns ---

  @Post('campaigns')
  @HttpCode(HttpStatus.OK)
  async createCampaign(@Req() req: any, @Body() body: { subject: string; body: any; segmentId?: number; scheduledFor?: string }) {
    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext.userId,
      action: 'newsletter.campaign.created',
      resource: 'Campaign',
      payload: body,
    });

    return { data: await this.newsletterService.createCampaign(req.tenantContext, body) };
  }

  @Get('campaigns/:id')
  @HttpCode(HttpStatus.OK)
  async getCampaign(@Param('id') id: string, @Req() req: any) {
    // M10: Audit Log (Read action)
    return { data: await this.newsletterService.getCampaign(req.tenantContext, parseInt(id)) };
  }

  @Post('campaigns/:id/send')
  @HttpCode(HttpStatus.OK)
  async sendCampaign(@Param('id') id: string, @Req() req: any) {
    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext.userId,
      action: 'newsletter.campaign.sent',
      resource: 'Campaign',
      payload: { campaignId: id },
    });

    // M10: "Throttling... Sending 10k+... Queuing"
    return { data: await this.newsletterService.sendCampaign(req.tenantContext, parseInt(id)) };
  }

  @Post('campaigns/:id/schedule')
  @HttpCode(HttpStatus.OK)
  async scheduleCampaign(@Param('id') id: string, @Req() req: any, @Body() body: { scheduledFor: string }) {
    // M10: Audit Log
    await this.auditLog.logAction({
      actorUserId: req.tenantContext.userId,
      action: 'newsletter.campaign.scheduled',
      resource: 'Campaign',
      payload: { campaignId: id, ...body },
    });

    return { success: true };
  }

  // --- Webhooks (Provider) ---

  @Post('webhooks/provider')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: any, @Body() body: any) {
    // M10: "Provider webhooks... Handle bounce/unsub/open/click"
    // M10: "Consent Ledger" (Unsub is append-only).
    
    const event = {
      type: body.type, // 'bounce', 'unsub', 'click', 'open'
      data: body.data, // { email, campaignId, bounce_reason, etc. }
    };

    // M10: Deliverability Health Signals (Bounce/Complaint rate spike)
    // M10: "Auto-throttle... require admin approval"
    // Stubbed here.

    return { success: true };
  }
}
