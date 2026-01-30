import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * Domain Events Service
 * M10 - Security Center: "Domain Events (Internal) + Outbound Webhooks (C-ready)"
 */

export interface DomainEvent {
  id: string;
  type: string;
  time: Date;
  tenantId: number;
  workspaceId?: number;
  actor?: { id: number; email: string };
  object: { type: string; id: number };
  traceId?: string;
  data: any;
}

@Injectable()
export class DomainEventService {
  private readonly logger = new Logger(DomainEventService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';

  constructor(private readonly redis: RedisService) {}

  /**
   * Publish Event
   * 
   * Uses Redis Pub/Sub to publish to specific channels.
   */
  async publish(channel: string, event: DomainEvent) {
    try {
      // 1. Validate Event Envelope
      if (!event.type || !event.object || !event.tenantId) {
        this.logger.warn(`Invalid Domain Event Envelope: ${JSON.stringify(event)}`);
        return;
      }

      // 2. Construct Payload (Compact)
      const payload = {
        id: event.id,
        type: event.type,
        at: event.time.toISOString(),
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        traceId: event.traceId,
        payload: event.data, // Actual data
      };

      // 3. Publish to Redis Channel
      // Channel Pattern: `teknav:{module}:events`
      const fullChannel = `${this.REDIS_PREFIX}:${channel}`; // e.g. `q:content:events`
      
      await this.redis.redis.publish(fullChannel, JSON.stringify(payload));

      // 4. Log (Trace)
      this.logger.log(`Domain Event Published: ${event.type} -> ${fullChannel}`);
    } catch (error) {
      // Best-effort: Non-blocking
      this.logger.error(`Failed to publish domain event: ${error.message}`);
    }
  }

  /**
   * Subscribe (SSE/Polling helper)
   * 
   * For Backend SSE (if implemented) or for Frontend Polling logic.
   */
  async subscribe(channel: string, callback: (message: string) => void) {
    const sub = this.redis.redis.duplicate().subscribe(`${this.REDIS_PREFIX}:${channel}`);
    
    sub.on('message', (channel, message) => {
      callback(message);
    });

    return sub;
  }

  /**
   * Generate Event ID (UUID)
   */
  static generateId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
