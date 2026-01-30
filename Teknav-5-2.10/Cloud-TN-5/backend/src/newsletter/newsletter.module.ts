import { Module } from '@nestjs/common';
import { NewsletterController } from './newsletter.controller';
import { NewsletterService } from './newsletter.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditLogModule } from '../logging/audit-log.module';
import { DomainEventModule } from '../events/domain-event.module';
import { EventBusService } from '../notifications/event-bus.service';
import { QueueModule } from '../queues/queue.module';

/**
 * Newsletter Module
 * M10 - Workstream 1: "Newsletter Send Pipeline (Deliverability-Safe, Consent-Aware)"
 */

@Module({
  imports: [
    PrismaModule,
    AuditLogModule,
    DomainEventModule,
    QueueModule,
  ],
  providers: [
    NewsletterService,
  ],
  controllers: [
    NewsletterController,
  ],
  exports: [
    NewsletterService,
  ],
})
export class NewsletterModule {}
