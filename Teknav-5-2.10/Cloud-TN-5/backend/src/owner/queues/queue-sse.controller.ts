import { Controller, Get, Headers, Sse, Req, Query } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request } from 'express';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { PoliciesGuard } from '../../auth/policies.guard';
import { RequirePolicy } from '../../security/policy/policy.decorator';
import { PolicyAction, PolicySubject } from '../../security/policy/policy.types';

/**
 * Queue SSE Gateway
 * M11 - Queue Platform: "Realtime Queue Events + SSE"
 *
 * Provides SSE endpoints for:
 * - Queue events (job enqueued, started, completed, failed, etc.)
 * - Queue metrics (real-time updates)
 * - Circuit breaker state changes
 * - Quarantine events
 */

@Controller('api/owner/queues')
@UseGuards(PoliciesGuard)
export class QueueSseController {
  private readonly CHANNEL = 'teknav:queue:events';

  constructor(
    private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * SSE Endpoint for Queue Events
   * GET /api/owner/queues/events/stream
   */
  @Get('events/stream')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @Sse({ messageEvent: 'message' })
  @Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable buffering for real-time
  })
  streamQueueEvents(
    @Req() req: Request,
    @Query('lastEventId') lastEventId?: string,
  ) {
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;

    return new Observable<{ data: any; id?: string; event?: string }>((observer) => {
      let subscriber: Redis | null = null;
      let keepAliveInterval: NodeJS.Timeout | null = null;

      const startStream = async () => {
        try {
          // Create separate Redis connection for pub/sub
          subscriber = this.redis.duplicate();
          await subscriber.connect();

          // Subscribe to queue events channel
          await subscriber.subscribe(this.CHANNEL);

          // Log SSE connection
          console.log(`SSE connection opened for user ${userId}, tenant ${tenantId}`);

          // Send initial connected event
          observer.next({
            event: 'connected',
            data: {
              userId,
              tenantId,
              timestamp: new Date().toISOString(),
            },
            id: `init-${Date.now()}`,
          });

          // Handle incoming messages
          subscriber.on('message', (channel, message) => {
            if (channel !== this.CHANNEL) return;

            try {
              const event = JSON.parse(message);

              // Filter events by tenant (optional security)
              if (tenantId && event.tenantId && event.tenantId !== tenantId) {
                return; // Skip events for other tenants
              }

              // Send event to client
              observer.next({
                event: event.type,
                data: event,
                id: event.id,
              });
            } catch (error: any) {
              console.error('Failed to parse SSE message:', error);
            }
          });

          // Start keep-alive ping (every 30s)
          keepAliveInterval = setInterval(() => {
            observer.next({
              event: 'ping',
              data: { timestamp: new Date().toISOString() },
              id: `ping-${Date.now()}`,
            });
          }, 30000);

        } catch (error: any) {
          console.error('Failed to start SSE stream:', error);
          observer.error(error);
          cleanup();
        }
      };

      const cleanup = () => {
        console.log('Closing SSE connection...');

        // Stop keep-alive
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }

        // Unsubscribe from Redis
        if (subscriber) {
          subscriber.unsubscribe(this.CHANNEL);
          subscriber.quit();
        }

        // Complete observer
        observer.complete();
      };

      // Handle client disconnect
      req.on('close', cleanup);

      // Start the stream
      startStream();

      // Return cleanup function
      return cleanup;
    }).pipe(map((message) => {
      // Convert to SSE format
      return {
        data: message.data,
        id: message.id,
        event: message.event,
      } as any;
    }));
  }

  /**
   * Polling Endpoint (fallback for clients that don't support SSE)
   * GET /api/owner/queues/events?since=...
   */
  @Get('events')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  async getQueueEventsPolling(
    @Query('since') since?: string,
    @Query('limit') limit?: number,
  ) {
    // Get recent events from Redis (store in a list for history)
    const limitInt = limit ? parseInt(limit) : 50;
    const sinceInt = since ? parseInt(since) : Date.now() - (60 * 1000); // Default last 1 min

    const eventsKey = `teknav:queue:events:history`;

    // Get events from sorted set (score = timestamp)
    const events = await this.redis.zrangebyscore(
      eventsKey,
      sinceInt,
      '+inf',
      'LIMIT',
      0,
      limitInt,
    );

    // Parse events
    const parsedEvents = events.map(event => JSON.parse(event));

    return {
      data: parsedEvents,
      since: sinceInt,
      count: parsedEvents.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Stream Queue Events for specific queue
   * GET /api/owner/queues/:queueName/events/stream
   */
  @Get(':queueName/events/stream')
  @RequirePolicy(PolicyAction.VIEW_LOGS, PolicySubject.SETTINGS)
  @Sse({ messageEvent: 'message' })
  @Headers({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  streamQueueEventsForQueue(
    @Param('queueName') queueName: string,
    @Req() req: Request,
  ) {
    const userId = (req as any).user?.id;
    const tenantId = (req as any).user?.tenantId;

    return new Observable<{ data: any; id?: string; event?: string }>((observer) => {
      let subscriber: Redis | null = null;
      let keepAliveInterval: NodeJS.Timeout | null = null;

      const startStream = async () => {
        try {
          // Create separate Redis connection for pub/sub
          subscriber = this.redis.duplicate();
          await subscriber.connect();

          // Subscribe to queue-specific channel
          const queueChannel = `teknav:queue:events:${queueName}`;
          await subscriber.subscribe(queueChannel);

          // Log SSE connection
          console.log(`SSE connection opened for queue ${queueName}, user ${userId}`);

          // Send initial connected event
          observer.next({
            event: 'connected',
            data: {
              queueName,
              userId,
              tenantId,
              timestamp: new Date().toISOString(),
            },
            id: `init-${queueName}-${Date.now()}`,
          });

          // Handle incoming messages
          subscriber.on('message', (channel, message) => {
            if (channel !== queueChannel) return;

            try {
              const event = JSON.parse(message);

              // Filter events by queue
              if (event.queueName !== queueName) {
                return; // Skip events for other queues
              }

              // Filter events by tenant
              if (tenantId && event.tenantId && event.tenantId !== tenantId) {
                return;
              }

              // Send event to client
              observer.next({
                event: event.type,
                data: event,
                id: event.id,
              });
            } catch (error: any) {
              console.error('Failed to parse SSE message:', error);
            }
          });

          // Start keep-alive ping
          keepAliveInterval = setInterval(() => {
            observer.next({
              event: 'ping',
              data: { timestamp: new Date().toISOString() },
              id: `ping-${queueName}-${Date.now()}`,
            });
          }, 30000);

        } catch (error: any) {
          console.error('Failed to start SSE stream:', error);
          observer.error(error);
          cleanup();
        }
      };

      const cleanup = () => {
        console.log(`Closing SSE connection for queue ${queueName}...`);

        // Stop keep-alive
        if (keepAliveInterval) {
          clearInterval(keepAliveInterval);
        }

        // Unsubscribe from Redis
        if (subscriber) {
          const queueChannel = `teknav:queue:events:${queueName}`;
          subscriber.unsubscribe(queueChannel);
          subscriber.quit();
        }

        // Complete observer
        observer.complete();
      };

      // Handle client disconnect
      req.on('close', cleanup);

      // Start the stream
      startStream();

      // Return cleanup function
      return cleanup;
    }).pipe(map((message) => {
      return {
        data: message.data,
        id: message.id,
        event: message.event,
      } as any;
    }));
  }
}
