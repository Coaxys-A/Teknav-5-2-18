import { Controller, Get, Param, UseGuards, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { EventBusService } from './event-bus.service';
import { RedisService } from '../../redis/redis.service';

/**
 * SSE Controller
 *
 * Streams Redis Pub/Sub events to client.
 * Channels:
 * - teknav:admin:events
 * - teknav:user:{userId}:events
 */

@Controller('api/events/stream')
// @UseGuards(AuthGuard)
export class SseController {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Admin Events Stream
   */
  @Get('admin')
  @HttpCode(HttpStatus.OK)
  async streamAdminEvents(
    @Req() req: any,
    @Res() res: any,
    @Query('workspaceId') workspaceId: string,
    @Query('severity') severity: string,
    @Query('types') types: string, // Comma separated
  ) {
    const channel = 'teknav:admin:events';
    const actor = req.user;
    const filters = {
      workspaceId: workspaceId ? parseInt(workspaceId) : undefined,
      severity,
      types: types ? types.split(',') : [],
    };

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Flush headers immediately

    // 1. Subscribe to Redis Pub/Sub
    const subscriber = this.redis.redis.duplicate();
    await subscriber.subscribe(channel, (err, message) => {
      if (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        return;
      }

      try {
        const event = JSON.parse(message);
        if (this.matchesFilters(event, filters)) {
          res.write(`data: ${message}\n\n`); // SSE format: data: <json>\n\n
        }
      } catch (error) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: 'Failed to parse event' })}\n\n`);
      }
    });

    // 2. Keep-alive loop (heartbeats every 30s)
    const heartbeatInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30000);

    // 3. Clean up on client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      subscriber.unsubscribe();
      subscriber.disconnect();
      this.redis.logger.log(`Client disconnected from admin stream (User: ${actor.userId})`);
    });
  }

  /**
   * User Events Stream
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async streamUserEvents(
    @Req() req: any,
    @Res() res: any,
    @Query('workspaceId') workspaceId: string,
  ) {
    const actor = req.user;
    const channel = `teknav:user:${actor.userId}:events`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const subscriber = this.redis.redis.duplicate();
    await subscriber.subscribe(channel, (err, message) => {
      if (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
        return;
      }

      res.write(`data: ${message}\n\n`);
    });

    const heartbeatInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeatInterval);
      subscriber.unsubscribe();
      subscriber.disconnect();
    });
  }

  /**
   * Filter Helper
   */
  private matchesFilters(event: any, filters: any): boolean {
    if (filters.workspaceId && event.workspaceId !== filters.workspaceId) return false;
    if (filters.severity && event.severity !== filters.severity) return false;
    if (filters.types.length > 0 && !filters.types.includes(event.type)) return false;
    return true;
  }
}
