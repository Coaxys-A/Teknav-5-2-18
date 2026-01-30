import { Processor, Process, OnQueueError } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventBusService } from '../../notifications/event-bus.service';

/**
 * Billing Processor
 * 
 * Handles: order.paid, subscription.renewed, subscription.cancelled, refund.created
 */

@Processor('billing-events')
export class BillingProcessor {
  private readonly logger = new Logger(BillingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  @Process('billing-events')
  async handleBilling(job: Job<any>) {
    const { data } = job;
    try {
      const { orderId, workspaceId, eventType } = data;

      // 1. Fetch Order
      const order = await this.prisma.order.findUnique({
        where: { id: orderId, workspaceId },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      // 2. Process Event
      if (eventType === 'order.paid') {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { status: 'PAID', paidAt: new Date() },
        });

        // Grant Entitlements (Stub)
        await this.prisma.workspace.update({
          where: { id: workspaceId },
          data: { entitlements: { ...(order.workspace?.entitlements as any), subscriptionActive: true } },
        });
      } else if (eventType === 'subscription.cancelled') {
        await this.prisma.workspace.update({
          where: { id: workspaceId },
          data: { entitlements: { ...order.workspace?.entitlements, subscriptionActive: false } },
        });
      } else if (eventType === 'refund.created') {
        await this.prisma.order.update({
          where: { id: orderId },
          data: { status: 'REFUNDED' },
        });
      }

      this.logger.log(`Billing event ${eventType} processed for order ${orderId}`);
    } catch (error) {
      this.logger.error(`Billing Job ${job.id} failed`, error);
      throw error;
    }
  }

  @OnQueueError()
  async onError(job: Job, error: Error) {
    this.logger.error(`Billing Job ${job.id} error`, error);
  }
}
