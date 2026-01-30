import { Module } from '@nestjs/common';
import { DomainEventService } from './domain-event.service';
import { RedisModule } from '../redis/redis.module';

/**
 * Domain Event Module
 * M10 - Security Center: "Domain Events (Internal) + Outbound Webhooks (C-ready)"
 */

@Module({
  imports: [
    RedisModule,
  ],
  providers: [
    DomainEventService,
  ],
  exports: [
    DomainEventService,
  ],
})
export class DomainEventModule {}
