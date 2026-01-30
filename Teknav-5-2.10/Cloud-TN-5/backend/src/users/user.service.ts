import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SessionService } from '../../security/session/session.service';
import { AuditLogService } from '../../logging/audit-log.service';

/**
 * User Service
 *
 * Implements /api/me endpoint.
 * Handles:
 * - Get Current User (Session + Membership Summary)
 * - Cache in Redis (TTL 60s)
 * - DB Fallback
 */

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly CACHE_TTL = 60; // 60s

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sessionService: SessionService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Get Current User
   * Validates session and returns user profile + memberships summary
   */
  async getMe(sessionId: string, deviceId: string): Promise<any> {
    const cacheKey = `${this.REDIS_PREFIX}:me:${sessionId}`;
    
    // 1. Check Redis Cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // 2. Validate Session (Hydrates from DB if needed)
    let sessionData;
    try {
      sessionData = await this.sessionService.validateSession(sessionId, deviceId);
    } catch (error) {
      throw new Error('Invalid session');
    }

    const userId = sessionData.userId;

    // 3. Fetch User from DB
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        workspaces: {
          include: {
            members: {
              where: { userId },
              select: {
                id: true,
                role: true,
                workspaceId: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new Error('User not found');
    }

    // 4. Flatten Memberships
    const memberships = user.workspaces.flatMap(ws => ws.members);

    // 5. Build Response
    const response = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
      memberships: memberships,
      role: 'VIEWER', // Default, derived from workspace memberships in UI
    };

    // 6. Cache in Redis
    await this.redis.set(cacheKey, JSON.stringify(response), this.CACHE_TTL);

    // 7. Audit Log
    await this.auditLog.logAction({
      actorUserId: userId,
      action: 'me.read',
      resource: 'User',
      payload: {
        sessionId,
        deviceId,
      },
    });

    return response;
  }
}
