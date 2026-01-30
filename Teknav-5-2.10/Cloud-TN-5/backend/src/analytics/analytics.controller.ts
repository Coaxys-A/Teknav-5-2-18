import { Controller, Post, Get, Param, UseGuards, Req, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { AnalyticsService } from './services/events-raw.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Analytics Controller
 * M5 Milestone: "Analytics that actually drives decisions"
 * 
 * Endpoints:
 * - POST /events/ingest (Tenant-Safe)
 * - GET /analytics/content/:contentId
 * - GET /analytics/funnel/subscription
 * - GET /analytics/cohorts
 */

@Controller('api/analytics')
// @UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'analytics.ingest', resourceType: 'EventsRaw' })
  async ingestEvent(@Body() body: any, @Req() req: any) {
    // M5 Requirement: Tenant-safe context
    // M0 Requirement: `req.tenantContext` exists via `TenantGuard`
    
    return {
      data: await this.analyticsService.ingestEvent(req.tenantContext, {
        type: body.type,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        actorId: req.tenantContext.userId,
        objectId: body.objectId,
        objectType: body.objectType,
        properties: body.properties,
        consentFlags: body.consentFlags,
      }),
    };
  }

  @Get('content/:contentId')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'analytics.content.get', resourceType: 'ContentStatsDaily', resourceIdParam: 'contentId' })
  async getContentStats(@Param('contentId') contentId: string, @Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    return {
      data: await this.analyticsService.getContentStats(req.tenantContext, parseInt(contentId), new Date(from), new Date(to)),
    };
  }

  @Get('funnel/subscription')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'analytics.funnel.get', resourceType: 'MetricsDaily' })
  async getFunnelMetrics(@Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    return {
      data: await this.analyticsService.getFunnelMetrics(req.tenantContext, new Date(from), new Date(to)),
    };
  }

  @Get('cohorts')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'analytics.cohorts.get', resourceType: 'EventsRaw' })
  async getCohorts(@Query('from') from: string, @Query('to') to: string, @Req() req: any) {
    // Stubbed for MVP - Requires more complex logic
    return { data: [] };
  }
}
