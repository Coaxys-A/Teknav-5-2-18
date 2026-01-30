import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * Event Bus Service (Redis Pub/Sub)
 *
 * Channels:
 * - teknav:admin:events
 * - teknav:workspace:{workspaceId}:events
 * - teknav:user:{userId}:events
 */

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Publish
   * Publishes envelope to specified channel.
   */
  async publish(channel: string, envelope: any): Promise<void> {
    const message = JSON.stringify(envelope);
    try {
      await this.redis.redis.publish(channel, message);
      this.logger.log(`Published to channel ${channel}: ${envelope.type}`);
    } catch (error) {
      this.logger.error(`Failed to publish to channel ${channel}`, error);
    }
  }

  /**
   * Subscribe (Helper for Workers)
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    const subscriber = this.redis.redis.duplicate();
    await subscriber.subscribe(channel, (err, message) => {
      if (err) {
        this.logger.error(`Error on channel ${channel}`, err);
        return;
      }
      try {
        callback(message);
      } catch (error) {
        this.logger.error(`Callback error on channel ${channel}`, error);
      }
    });
  }
}
