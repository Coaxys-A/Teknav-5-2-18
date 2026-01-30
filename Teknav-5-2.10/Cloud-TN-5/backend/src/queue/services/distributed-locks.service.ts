import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Distributed Locks Service
 * M11 - Queue Platform: "Distributed Locks"
 *
 * Features:
 * - Lock keys for entity mutation
 * - TTL based on expected work duration
 * - Heartbeat renewal for long-running locks
 * - Requeue with delay if lock held
 */

@Injectable()
export class DistributedLocksService {
  private readonly logger = new Logger(DistributedLocksService.name);
  private readonly LOCK_PREFIX = 'teknav:lock';
  private readonly LOCK_HEARTBEAT_INTERVAL = 30; // 30s

  private activeLocks: Map<string, NodeJS.Timeout> = new Map();

  constructor(private readonly redis: Redis) {}

  /**
   * Acquire lock with retry
   */
  async acquireLock(
    entityType: string,
    entityId: string,
    options: {
      ttl?: number; // TTL in seconds (default: 60s)
      timeout?: number; // Max time to wait for lock (default: 10s)
      retryDelay?: number; // Delay between retries (default: 100ms)
    } = {},
  ): Promise<{ acquired: boolean; lockKey: string }> {
    const lockKey = `${this.LOCK_PREFIX}:${entityType}:${entityId}`;
    const ttl = options.ttl || 60;
    const timeout = options.timeout || 10000;
    const retryDelay = options.retryDelay || 100;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Try to acquire lock
      const acquired = await this.redis.set(lockKey, '1', 'PX', ttl * 1000, 'NX');

      if (acquired === 'OK') {
        this.logger.debug(`Lock acquired: ${lockKey}`);
        this.startHeartbeat(lockKey, ttl);
        return { acquired: true, lockKey };
      }

      // Lock held, wait and retry
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }

    this.logger.warn(`Lock acquisition timeout: ${lockKey}`);
    return { acquired: false, lockKey };
  }

  /**
   * Release lock
   */
  async releaseLock(lockKey: string): Promise<void> {
    // Stop heartbeat
    this.stopHeartbeat(lockKey);

    // Release lock
    await this.redis.del(lockKey);
    this.logger.debug(`Lock released: ${lockKey}`);
  }

  /**
   * Check if lock is held
   */
  async isLocked(entityType: string, entityId: string): Promise<boolean> {
    const lockKey = `${this.LOCK_PREFIX}:${entityType}:${entityId}`;
    const exists = await this.redis.exists(lockKey);
    return exists === 1;
  }

  /**
   * Extend lock TTL (for long-running operations)
   */
  async extendLock(lockKey: string, additionalTtl: number): Promise<void> {
    // Stop current heartbeat
    this.stopHeartbeat(lockKey);

    // Extend lock
    const newTtl = additionalTtl + this.LOCK_HEARTBEAT_INTERVAL;
    await this.redis.pexpire(lockKey, newTtl * 1000);

    // Start new heartbeat
    this.startHeartbeat(lockKey, newTtl);

    this.logger.debug(`Lock extended: ${lockKey} (+${additionalTtl}s)`);
  }

  /**
   * Execute function with lock (auto-release)
   */
  async withLock<T>(
    entityType: string,
    entityId: string,
    fn: () => Promise<T>,
    options: { ttl?: number; timeout?: number; retryDelay?: number } = {},
  ): Promise<{ success: boolean; result?: T; error?: any }> {
    const { acquired, lockKey } = await this.acquireLock(entityType, entityId, options);

    if (!acquired) {
      return { success: false, error: new Error('Lock acquisition timeout') };
    }

    try {
      const result = await fn();
      return { success: true, result };
    } catch (error: any) {
      this.logger.error(`Error in locked execution: ${lockKey}`, error);
      return { success: false, error };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Start heartbeat for lock renewal
   */
  private startHeartbeat(lockKey: string, ttl: number): void {
    // If heartbeat already running, don't start another
    if (this.activeLocks.has(lockKey)) {
      return;
    }

    const heartbeatInterval = setInterval(async () => {
      // Extend lock by original TTL
      const extended = await this.redis.pexpire(lockKey, ttl * 1000);

      if (!extended) {
        // Lock expired, stop heartbeat
        this.stopHeartbeat(lockKey);
        this.logger.warn(`Lock expired during heartbeat: ${lockKey}`);
      }
    }, this.LOCK_HEARTBEAT_INTERVAL * 1000);

    this.activeLocks.set(lockKey, heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(lockKey: string): void {
    const interval = this.activeLocks.get(lockKey);
    if (interval) {
      clearInterval(interval);
      this.activeLocks.delete(lockKey);
    }
  }

  /**
   * Release all locks (for graceful shutdown)
   */
  async releaseAllLocks(): Promise<void> {
    const lockKeys = Array.from(this.activeLocks.keys());

    for (const lockKey of lockKeys) {
      await this.releaseLock(lockKey);
    }

    this.logger.log(`Released ${lockKeys.length} locks`);
  }
}
