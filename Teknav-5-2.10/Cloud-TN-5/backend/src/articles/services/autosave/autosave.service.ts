import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../../redis/redis.service';
import { EventBusService } from '../../../../notifications/event-bus.service';

/**
 * Article Autosave Service
 *
 * Handles:
 * - Autosave (Redis draft)
 * - Sync to DB (Queue/DB)
 * - Locks (Prevent overwrite)
 */

@Injectable()
export class ArticleAutosaveService {
  private readonly logger = new Logger(ArticleAutosaveService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';
  private readonly DRAFT_TTL = 60 * 60 * 24 * 7; // 7 days

  constructor(
    private readonly redis: RedisService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * Save Draft
   */
  async saveDraft(userId: number, articleId: number, content: string, title?: string) {
    const key = this.getDraftKey(userId, articleId);
    const data = {
      articleId,
      content,
      title,
      updatedAt: new Date().toISOString(),
    };

    await this.redis.redis.set(key, JSON.stringify(data), 'EX', this.DRAFT_TTL);

    // Publish Autosave Event
    await this.eventBus.publish('teknav:articles:events', {
      type: 'article.autosaved',
      payload: { articleId, userId },
    });
  }

  /**
   * Get Draft
   */
  async getDraft(userId: number, articleId: number) {
    const key = this.getDraftKey(userId, articleId);
    const data = await this.redis.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Delete Draft
   */
  async deleteDraft(userId: number, articleId: number) {
    const key = this.getDraftKey(userId, articleId);
    await this.redis.redis.del(key);
  }

  /**
   * Acquire Lock
   * Returns false if lock held by another user.
   */
  async acquireLock(articleId: number, userId: number): Promise<boolean> {
    const key = this.getLockKey(articleId);
    const value = `${userId}:${Date.now()}`;
    const TTL = 60; // 60 seconds

    // SETNX only sets if not exists
    const result = await this.redis.redis.set(key, value, 'NX', 'EX', TTL);

    if (result === 'OK') {
      return true; // Lock acquired
    }

    // Check if lock is expired and held by SAME user (refresh)
    const current = await this.redis.redis.get(key);
    if (current) {
      const [lockUserId] = current.split(':');
      if (lockUserId === userId.toString()) {
        // Refresh lock
        await this.redis.redis.set(key, value, 'EX', TTL);
        return true;
      }
    }

    return false; // Lock held by someone else
  }

  /**
   * Release Lock
   */
  async releaseLock(articleId: number): Promise<void> {
    const key = this.getLockKey(articleId);
    await this.redis.redis.del(key);
  }

  /**
   * Check Lock
   */
  async checkLock(articleId: number): Promise<{ userId: number; timestamp: number } | null> {
    const key = this.getLockKey(articleId);
    const value = await this.redis.redis.get(key);

    if (!value) return null;

    const [userId, timestamp] = value.split(':');
    return { userId: parseInt(userId), timestamp: parseInt(timestamp) };
  }

  private getDraftKey(userId: number, articleId: number): string {
    return `${this.REDIS_PREFIX}:article:draft:${userId}:${articleId}`;
  }

  private getLockKey(articleId: number): string {
    return `${this.REDIS_PREFIX}:article:lock:${articleId}`;
  }
}
