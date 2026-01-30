import { Controller, Post, Get, Param, UseGuards, Req, HttpCode, HttpStatus, Body, Query } from '@nestjs/common';
import { BillingService } from './services/billing.service';
import { AuditDecorator } from '../../common/decorators/audit.decorator';

/**
 * Billing Controller
 * M3 Milestone: "Membership + paywall v1 (money-safe)"
 * 
 * Endpoints:
 * - POST /billing/checkout
 * - POST /billing/webhooks/provider
 * - GET /billing/subscriptions
 * - POST /billing/subscriptions/:id/cancel
 * - POST /billing/paywall/evaluate (Server-side)
 */

@Controller('api/billing')
// @UseGuards(AuthGuard) // Assumed global
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'billing.checkout.created', resourceType: 'Subscription' })
  async createCheckout(@Req() req: any, @Body() body: { workspaceId: number; planId: number }) {
    // M3 Requirement: Tenant Context (M0) via `req.tenantContext`
    return { 
      data: await this.billingService.createCheckout(req.tenantContext, body.workspaceId, body.planId) 
    };
  }

  @Post('webhooks/provider')
  @HttpCode(HttpStatus.OK) // Always 200 OK even if duplicate
  @AuditDecorator({ action: 'billing.webhook.processed', resourceType: 'BillingEvent' })
  async processWebhook(@Body() body: any, @Req() req: any) {
    // M3 Requirement: Tenant-safe? Webhooks are external.
    // We infer tenant from webhook payload (if using `customer_id` mapping) or verify signature.
    // For MVP, we assume `req.tenantContext` is available if webhook signed/validated.
    // However, usually webhooks are tenant-specific endpoints or carry tenant ID in URL.
    // We'll use `req.tenantContext` from Auth/Signature validation layer.
    
    return { 
      data: await this.billingService.processWebhook(req.tenantContext, body) 
    };
  }

  @Get('subscriptions')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'billing.subscriptions.list', resourceType: 'Subscription' })
  async getSubscriptions(@Req() req: any) {
    return { 
      data: await this.billingService.getSubscriptions(req.tenantContext) 
    };
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'billing.subscription.cancelled', resourceType: 'Subscription', resourceIdParam: 'id' })
  async cancelSubscription(@Param('id') id: string, @Req() req: any) {
    return { 
      data: await this.billingService.cancelSubscription(req.tenantContext, parseInt(id)) 
    };
  }

  @Post('paywall/evaluate')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'paywall.evaluated', resourceType: 'AccessLog', resourceIdParam: 'contentId' })
  async evaluatePaywall(@Req() req: any, @Body() body: { userId: number; contentId: number }) {
    // M3 Requirement: Server-side check: user + content -> allow/deny
    return { 
      data: await this.billingService.evaluatePaywall(req.tenantContext, body.userId, body.contentId) 
    };
  }

  @Post('plans')
  @HttpCode(HttpStatus.OK)
  @AuditDecorator({ action: 'billing.plans.created', resourceType: 'Plan' })
  async createPlan(@Req() req: any, @Body() body: any) {
    // Owner/Admin only
    return { 
      data: await this.billingService.createPlan(req.tenantContext, body) 
    };
  }
}
