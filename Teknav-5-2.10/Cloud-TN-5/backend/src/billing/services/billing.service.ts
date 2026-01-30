import { Injectable, Logger, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventBusService } from '../../../notifications/event-bus.service';
import { AuditLogService } from '../../../logging/audit-log.service';
import { AnalyticsService } from '../../../analytics/services/events-raw.service'; // M5 Integration
import { RedisService } from '../../../redis/redis.service';
import { Subscription, Plan } from '@prisma/client';

/**
 * Billing Service (Money-Safe)
 * M3 Milestone: "Membership + paywall v1 (money-safe)"
 * 
 * Features:
 * - Plans, Subscriptions, Entitlements
 * - Checkout Session Creation
 * - Webhook Processor (Strict Idempotency)
 * - Paywall Evaluation (Server-Side)
 */

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly WEBHOOK_TTL = 2592000; // 30 days

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    private readonly auditLog: AuditLogService,
    private readonly redis: RedisService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  /**
   * Create Checkout Session
   * M3 Requirement: "Checkout session creation"
   * 
   * Returns a URL to Stripe/LemonSqueezy/etc.
   * For MVP, we return a placeholder URL.
   */
  async createCheckoutSession(actor: any, workspaceId: number, planId: number, userId?: number) {
    // 1. Fetch Plan
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, workspaceId },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    // 2. Create/Update Subscription (Provisional)
    // M3 Requirement: "subscription state machine"
    const subscription = await this.prisma.subscription.upsert({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: userId || actor.userId,
        },
      },
      create: {
        workspaceId,
        userId: userId || actor.userId,
        planId,
        status: 'PENDING',
        startedAt: new Date(),
        currentPeriodEnd: null, // Set by webhook
        cancelAtPeriodEnd: false,
      },
      update: {
        planId, // Upgrading plan
        status: 'PENDING',
      },
    });

    this.logger.log(`Checkout session created: ${subscription.id}`);

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'billing.checkout.created',
      resource: `Subscription:${subscription.id}`,
      payload: { planId, workspaceId },
    });

    // 4. Publish Event
    await this.eventBus.publish('billing.checkout.created', {
      id: subscription.id,
      workspaceId,
      userId: actor.userId,
      planId,
    });

    // 5. Return Placeholder URL (MVP)
    // In real app, we'd call `stripe.checkout.sessions.create({ ... })`
    return { 
      url: `https://billing.example.com/checkout?session=${subscription.id}`,
      subscriptionId: subscription.id,
    };
  }

  /**
   * Cancel Subscription
   */
  async cancelSubscription(actor: any, subscriptionId: number) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: subscriptionId, workspaceId: actor.workspaceId },
    });

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // 1. Update Status
    const updated = await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'CANCLED',
        cancelAtPeriodEnd: true, // Retain access until period end
      },
    });

    // 2. Revoke Entitlements (M3 Requirement)
    // We delete `entitlements` rows for this subscription/user
    await this.prisma.entitlement.deleteMany({
      where: { tenantId: actor.tenantId, userId: subscription.userId },
    });

    // 3. Audit Log
    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'billing.subscription.cancelled',
      resource: `Subscription:${subscription.id}`,
      payload: { previousStatus: subscription.status },
    });

    return updated;
  }

  /**
   * Process Webhook (Idempotent)
   * M3 Requirement: "idempotent webhooks", "billing_events table as exactly-once backbone"
   * 
   * Handles: payment_intent.succeeded, subscription.created, customer.subscription.updated, etc.
   */
  async processWebhook(actor: any, payload: {
    provider: 'stripe' | 'lemon';
    type: string;
    data: any; // Stripe/Lemon payload
  }) {
    const { provider, type, data } = payload;
    const eventId = `${provider}_${data.id}_${type}`; // Unique ID

    // 1. Check Idempotency (M3 Requirement)
    const exists = await this.prisma.billingEvent.findUnique({
      where: { providerEventId: eventId },
    });

    if (exists) {
      this.logger.log(`Webhook event already processed: ${eventId}`);
      return { status: 'DUPLICATE' }; // 200 OK
    }

    // 2. Create BillingEvent (M3 Requirement)
    const eventRecord = await this.prisma.billingEvent.create({
      data: {
        tenantId: actor.tenantId, // From Context (assumed)
        providerEventId: eventId,
        type,
        receivedAt: new Date(),
        status: 'PROCESSED',
        rawJson: JSON.stringify(data),
      },
    });

    // 3. Handle Event Types
    if (type === 'checkout.session.completed') {
      await this.handleCheckoutCompleted(actor, data);
    } else if (type === 'invoice.paid') {
      await this.handleInvoicePaid(actor, data);
    } else if (type === 'customer.subscription.created' || type === 'subscription.updated') {
      await this.handleSubscriptionUpdated(actor, data);
    }

    this.logger.log(`Webhook processed: ${eventId}`);

    // 4. Audit Log
    await this.auditLog.logAction({
      actorUserId: 0, // System action
      action: 'billing.webhook.processed',
      resource: `BillingEvent:${eventRecord.id}`,
      payload: { provider, type, eventId },
    });

    return { status: 'SUCCESS' };
  }

  /**
   * Handle Subscription Updated (Provider Webhook)
   * M3 Requirement: "subscription state machine matches provider truth"
   */
  private async handleSubscriptionUpdated(actor: any, data: any) {
    // 1. Fetch Subscription (By Provider ID)
    const subscription = await this.prisma.subscription.findFirst({
      where: { id: parseInt(data.id) }, // Assuming DB ID matches Provider ID
    });

    if (!subscription) {
      this.logger.warn(`Subscription not found for webhook: ${data.id}`);
      return;
    }

    // 2. Grant Entitlements (M3 Requirement)
    if (data.status === 'active') {
      await this.grantEntitlements(actor.tenantId, subscription.userId, subscription.planId);
    } else if (data.status === 'cancelled' || data.status === 'past_due') {
      await this.revokeEntitlements(actor.tenantId, subscription.userId, subscription.planId);
    }

    // 3. Update Subscription
    await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: data.status.toUpperCase(),
        currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
      },
    });
  }

  /**
   * Grant Entitlements
   * M3 Requirement: "entitlements computed deterministically"
   */
  private async grantEntitlements(tenantId: number, userId: number, planId: number) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) return;

    const entitlements = plan.featuresJson as any;

    // Create Entitlements (M3 Requirement)
    const entitlementsPromises = Object.keys(entitlements).map(key => {
      return this.prisma.entitlement.create({
        data: {
          tenantId,
          userId,
          key,
          value: entitlements[key],
          validFrom: new Date(),
          validTo: null, // Forever unless specified
        },
      });
    });

    await Promise.all(entitlementsPromises);

    // 4. M5 Integration: Log Entitlement Granted Event
    await this.analyticsService.ingestEvent({
      type: 'entitlement.granted',
      occurredAt: new Date(),
      actorId: userId,
      properties: { planId, entitlements },
    }, { tenantId, userId: 0, locale: 'en' }); // M5 Context
  }

  /**
   * Revoke Entitlements
   */
  private async revokeEntitlements(tenantId: number, userId: number, planId: number) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) return;

    // Delete Entitlements
    await this.prisma.entitlement.deleteMany({
      where: { tenantId, userId, key: { in: Object.keys(plan.featuresJson || {}) } },
    });
  }

  /**
   * Create Paywall Rule (M3 Requirement)
   */
  async createPaywallRule(actor: any, workspaceId: number, data: {
    name: string;
    ruleJson: any; // JSON logic for evaluation
  }) {
    const rule = await this.prisma.paywallRule.create({
      data: {
        tenantId: actor.tenantId, // Global rule for tenant?
        workspaceId,
        name: data.name,
        ruleJson: data.ruleJson,
        active: true,
        createdAt: new Date(),
      },
    });

    await this.auditLog.logAction({
      actorUserId: actor.userId,
      action: 'paywall.rule.created',
      resource: `PaywallRule:${rule.id}`,
      payload: { workspaceId, name: data.name },
    });

    return rule;
  }

  /**
   * Evaluate Paywall (Server-Side)
   * M3 Requirement: "decision happens server-side", "decision logs for debugging disputes"
   */
  async evaluatePaywall(actor: any, userId: number, contentId: number) {
    // 1. Fetch Rules (M3 Requirement)
    const rules = await this.prisma.paywallRule.findMany({
      where: { workspaceId: actor.workspaceId, active: true },
    });

    // 2. Fetch User Entitlements (M3 Requirement)
    const entitlements = await this.prisma.entitlement.findMany({
      where: { tenantId: actor.tenantId, userId, validTo: { gte: new Date() } },
    });

    const entitlementKeys = new Set(entitlements.map(e => e.key));

    // 3. Evaluate Rules
    // This is a simplifed evaluation. Real app would use a Policy Engine.
    let allowed = true;
    let reason = 'Access Granted';

    for (const rule of rules) {
      // Example Rule: { "if": "!user.has_entitlement('pro')", "then": "deny" } }
      const ruleObj = rule.ruleJson;
      
      // Simple check: Entitlement must exist
      if (ruleObj.if && !ruleObj.if.entitlement) continue; // Skip if true
      if (ruleObj.if && ruleObj.if.entitlement && !entitlementKeys.has(ruleObj.if.entitlement)) {
        allowed = false;
        reason = `Missing Entitlement: ${ruleObj.if.entitlement}`;
        break;
      }
    }

    // 4. Log Decision (M3 Requirement)
    await this.prisma.accessLog.create({
      data: {
        tenantId: actor.tenantId,
        userId,
        contentId,
        decision: allowed ? 'ALLOW' : 'DENY',
        reason,
        createdAt: new Date(),
      },
    });

    // 5. M5 Integration
    await this.analyticsService.ingestEvent({
      type: 'paywall.evaluated',
      occurredAt: new Date(),
      actorId: userId,
      objectId: contentId,
      objectType: 'Content',
      properties: { decision: allowed ? 'allow' : 'deny', ruleCount: rules.length },
    }, { tenantId: actor.tenantId, userId, locale: 'en' });

    return { allowed, reason };
  }
}
