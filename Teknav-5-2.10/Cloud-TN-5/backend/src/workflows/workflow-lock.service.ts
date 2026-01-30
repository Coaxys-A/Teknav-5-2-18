import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/**
 * Workflow Lock Service
 *
 * Manages Redis locks to prevent double execution or conflicts.
 */

@Injectable()
export class WorkflowLockService {
  private readonly logger = new Logger(WorkflowLockService.name);
  private readonly REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'q';

  constructor(private readonly redis: RedisService) {}

  /**
   * Acquire Lock
   * Returns true if lock acquired, false if already locked.
   */
  async acquireLock(workflowInstanceId: number, ttl: number = 60): Promise<boolean> {
    const key = `${this.REDIS_PREFIX}:lock:workflow:instance:${workflowInstanceId}`;
    try {
      const acquired = await this.redis.redis.set(key, 'LOCKED', 'PX', ttl * 1000, 'NX');
      if (acquired === 'OK') {
        this.logger.log(`Lock acquired for instance ${workflowInstanceId}`);
        return true;
      }
      this.logger.log(`Lock failed for instance ${workflowInstanceId} (already locked)`);
      return false;
    } catch (error) {
      this.logger.error(`Failed to acquire lock for instance ${workflowInstanceId}`, error);
      return false;
    }
  }

  /**
   * Release Lock
   */
  async releaseLock(workflowInstanceId: number): Promise<void> {
    const key = `${this.REDIS_PREFIX}:lock:workflow:instance:${workflowInstanceId}`;
    try {
      await this.redis.redis.del(key);
      this.logger.log(`Lock released for instance ${workflowInstanceId}`);
    } catch (error) {
      this.logger.error(`Failed to release lock for instance ${workflowInstanceId}`, error);
    }
  }

  /**
   * Check if Locked
   */
  async isLocked(workflowInstanceId: number): Promise<boolean> {
    const key = `${this.REDIS_PREFIX}:lock:workflow:instance:${workflowInstanceId}`;
    const locked = await this.redis.redis.exists(key);
    return locked === 1;
  }
}
