import { Injectable, NotFoundException } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Rate Limit Service (Redis Token Bucket)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Features:
 * - Redis token bucket algorithm
 * - Per plugin + per workspace + per scope limits
 * - Default limits (read: 120/min, write: 60/min, net outbound: 30/min, webhooks emit: 30/min)
 * - Owner override via PluginSettings
 * - Enforced in host API and queue consumers
 */

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: { windowMs: number; max: number };
  retryAfter?: number;
  resetAfter?: number;
  currentTokens: number;
}

export interface RateLimitConfig {
  windowMs: number;
  max: number;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly redis: Redis;

  // Default limits
  private readonly DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
    'read': { windowMs: 60 * 1000, max: 120 },        // 120/min
    'write': { windowMs: 60 * 1000, max: 60 },       // 60/min
    'net:outbound': { windowMs: 60 * 1000, max: 30 },  // 30/min
    'webhooks:emit': { windowMs: 60 * 1000, max: 30 }, // 30/min
    'kv:read': { windowMs: 60 * 1000, max: 60 },
    'kv:write': { windowMs: 60 * 1000, max: 30 },
    'ai:invoke': { windowMs: 60 * 1000, max: 10 },   // 10/min
    'cms:articles:read': { windowMs: 60 * 1000, max: 120 },
    'cms:articles:write': { windowMs: 60 * 1000, max: 30 },
    'cms:users:read': { windowMs: 60 * 1000, max: 120 },
    'cms:users:write': { windowMs: 60 * 1000, max: 30 },
    'files:read': { windowMs: 60 * 1000, max: 60 },
    'files:write': { windowMs: 60 * 1000, max: 30 },
  };

  constructor(prisma: PrismaService) {
    this.redis = prisma.redis;
  }

  // ==========================================================================
  // RATE LIMIT CHECKING
  // ==========================================================================

  /**
   * Check rate limit for scope
   */
  async checkRateLimit(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<RateLimitCheckResult> {
    this.logger.debug(`Checking rate limit: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);

    // 1. Get rate limit config (workspace override first, then global default)
    const limitConfig = await this.getRateLimitConfig(pluginId, workspaceId, scope);

    // 2. Get current token count from Redis
    const key = `teknav:rl:plugin:${workspaceId}:${pluginId}:${scope}`;
    const currentTokens = await this.redis.incr(key) || 0;

    // 3. Set expiry on first token in window
    if (currentTokens === 1) {
      await this.redis.pexpire(key, limitConfig.windowMs);
    }

    // 4. Check if limit exceeded
    const ttl = await this.redis.pttl(key);
    const resetAfter = Date.now() + ttl;

    if (currentTokens > limitConfig.max) {
      this.logger.debug(`Rate limit exceeded: ${currentTokens}/${limitConfig.max}`);

      // Retry after window
      return {
        allowed: false,
        limit: limitConfig,
        retryAfter: resetAfter,
        resetAfter,
        currentTokens,
      };
    }

    this.logger.debug(`Rate limit check passed: ${currentTokens}/${limitConfig.max}`);

    return {
      allowed: true,
      limit: limitConfig,
      resetAfter,
      currentTokens,
    };
  }

  /**
   * Check rate limit with retry delay
   */
  async checkRateLimitWithRetryDelay(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<{ allowed: boolean; delayMs?: number }> {
    const result = await this.checkRateLimit(pluginId, workspaceId, scope);

    if (result.allowed) {
      return { allowed: true };
    }

    // Calculate retry delay (exponential backoff)
    const exceededBy = result.currentTokens - result.limit.max;
    const baseDelay = 1000; // 1s
    const delayMs = Math.min(baseDelay * Math.pow(2, exceededBy - 1), 60000); // Max 60s

    this.logger.debug(`Rate limit retry delay: ${delayMs}ms`);

    return {
      allowed: false,
      delayMs,
    };
  }

  /**
   * Record rate limit hit (optional - for analytics)
   */
  async recordRateLimitHit(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<void> {
    const key = `teknav:rl:hits:plugin:${workspaceId}:${pluginId}:${scope}`;

    // Increment counter
    await this.redis.incr(key);
    await this.redis.expire(key, 24 * 60 * 60); // 24 hours TTL
  }

  /**
   * Reset rate limit bucket (admin action)
   */
  async resetRateLimit(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<void> {
    const key = `teknav:rl:plugin:${workspaceId}:${pluginId}:${scope}`;
    await this.redis.del(key);
    this.logger.log(`Rate limit reset: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);
  }

  /**
   * Reset all rate limits for plugin/workspace
   */
  async resetAllRateLimits(pluginId: number, workspaceId: number): Promise<void> {
    const pattern = `teknav:rl:plugin:${workspaceId}:${pluginId}:*`;
    const keys = await this.redis.keys(pattern);

    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.log(`All rate limits reset: plugin ${pluginId}, workspace ${workspaceId}, ${keys.length} scopes`);
    }
  }

  // ==========================================================================
  // RATE LIMIT CONFIG
  // ==========================================================================

  /**
   * Get rate limit config (workspace override -> global default)
   */
  private async getRateLimitConfig(
    pluginId: number,
    workspaceId: number,
    scope: string,
  ): Promise<RateLimitConfig> {
    // 1. Check for workspace override in PluginSettings
    const setting = await this.prisma.pluginSettings.findUnique({
      where: {
        workspaceId_pluginId_settingKey: {
          workspaceId,
          pluginId,
          settingKey: 'rateLimits',
        },
      },
    });

    if (setting) {
      const config = JSON.parse(setting.settingValue);
      const scopeConfig = config[scope];

      if (scopeConfig) {
        this.logger.debug(`Workspace rate limit override: ${scope} = ${JSON.stringify(scopeConfig)}`);
        return {
          windowMs: scopeConfig.windowMs,
          max: scopeConfig.max,
        };
      }
    }

    // 2. Fall back to global default
    const defaultConfig = this.DEFAULT_LIMITS[scope];

    if (defaultConfig) {
      this.logger.debug(`Global rate limit default: ${scope} = ${JSON.stringify(defaultConfig)}`);
      return defaultConfig;
    }

    // 3. Fallback to safe default if no config found
    this.logger.debug(`Safe default rate limit: ${scope}`);
    return {
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30/min (safe default)
    };
  }

  /**
   * Get all rate limit configs for plugin/workspace
   */
  async getAllRateLimitConfigs(
    pluginId: number,
    workspaceId: number,
  ): Promise<Record<string, RateLimitConfig>> {
    const settings = await this.prisma.pluginSettings.findUnique({
      where: {
        workspaceId_pluginId_settingKey: {
          workspaceId,
          pluginId,
          settingKey: 'rateLimits',
        },
      },
    });

    const config: Record<string, RateLimitConfig> = {};

    // Start with defaults
    for (const [scope, defaultConfig] of Object.entries(this.DEFAULT_LIMITS)) {
      config[scope] = { ...defaultConfig };
    }

    // Apply workspace overrides
    if (setting) {
      const overrides = JSON.parse(setting.settingValue);

      for (const [scope, override] of Object.entries(overrides)) {
        if (override.windowMs && override.max) {
          config[scope] = {
            windowMs: override.windowMs,
            max: override.max,
          };
        }
      }
    }

    return config;
  }

  /**
   * Set rate limit config (workspace override)
   */
  async setRateLimitConfig(
    pluginId: number,
    workspaceId: number,
    scope: string,
    config: RateLimitConfig,
    actorId: number,
  ): Promise<void> {
    this.logger.log(`Setting rate limit config: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);

    // Get existing config
    const setting = await this.prisma.pluginSettings.findUnique({
      where: {
        workspaceId_pluginId_settingKey: {
          workspaceId,
          pluginId,
          settingKey: 'rateLimits',
        },
      },
    });

    // Get current config
    let currentConfig: Record<string, RateLimitConfig> = {};

    if (setting) {
      currentConfig = JSON.parse(setting.settingValue);
    } else {
      // Initialize with defaults
      for (const [scope, defaultConfig] of Object.entries(this.DEFAULT_LIMITS)) {
        currentConfig[scope] = { ...defaultConfig };
      }
    }

    // Update scope config
    currentConfig[scope] = config;

    // Save
    if (setting) {
      await this.prisma.pluginSettings.update({
        where: { id: setting.id },
        data: {
          settingValue: JSON.stringify(currentConfig),
          updatedById: actorId,
          updatedAt: new Date(),
        },
      });
    } else {
      await this.prisma.pluginSettings.create({
        data: {
          workspaceId,
          pluginId,
          settingKey: 'rateLimits',
          settingValue: JSON.stringify(currentConfig),
          createdById: actorId,
          updatedAt: new Date(),
        },
      });
    }

    this.logger.log(`Rate limit config saved: ${scope} = ${JSON.stringify(config)}`);
  }

  /**
   * Delete rate limit config
   */
  async deleteRateLimitConfig(
    pluginId: number,
    workspaceId: number,
    scope: string,
    actorId: number,
  ): Promise<void> {
    this.logger.log(`Deleting rate limit config: plugin ${pluginId}, workspace ${workspaceId}, scope ${scope}`);

    const setting = await this.prisma.pluginSettings.findUnique({
      where: {
        workspaceId_pluginId_settingKey: {
          workspaceId,
          pluginId,
          settingKey: 'rateLimits',
        },
      },
    });

    if (!setting) {
      throw new NotFoundException('Rate limit config not found');
    }

    // Get current config
    const config = JSON.parse(setting.settingValue);
    delete config[scope];

    // If no scopes left, delete the setting
    if (Object.keys(config).length === 0) {
      await this.prisma.pluginSettings.delete({
        where: { id: setting.id },
      });
    } else {
      // Update config
      await this.prisma.pluginSettings.update({
        where: { id: setting.id },
        data: {
          settingValue: JSON.stringify(config),
          updatedById: actorId,
          updatedAt: new Date(),
        },
      });
    }

    this.logger.log(`Rate limit config deleted: ${scope}`);
  }

  // ==========================================================================
  // ANALYTICS (RATE LIMIT ATTRIBUTION)
  // ==========================================================================

  /**
   * Get rate limit analytics
   */
  async getRateLimitAnalytics(
    pluginId: number,
    workspaceId: number,
    scope?: string,
  ): Promise<{
    totalHits: number;
    totalLimitExceeded: number;
    byScope: Record<string, { hits: number; exceeded: number }>;
    currentLimits: Record<string, RateLimitConfig>;
  }> {
    const pattern = `teknav:rl:plugin:${workspaceId}:${pluginId}:*`;
    const keys = await this.redis.keys(pattern);

    const totalHits = keys.length;
    let totalLimitExceeded = 0;

    // Get current tokens for each scope
    const byScope: Record<string, { hits: number; exceeded: number }> = {};
    const currentLimits: Record<string, RateLimitConfig> = {};

    for (const key of keys) {
      const scope = key.split(':').pop();
      const tokens = await this.redis.get(key) || '0';
      const tokenNum = parseInt(tokens);
      const limit = this.DEFAULT_LIMITS[scope] || { windowMs: 60000, max: 30 };

      if (scope && !byScope[scope]) {
        byScope[scope] = { hits: 0, exceeded: 0 };
      }

      if (scope) {
        byScope[scope].hits++;
        if (tokenNum > limit.max) {
          byScope[scope].exceeded++;
          totalLimitExceeded++;
        }
      }

      if (scope) {
        currentLimits[scope] = limit;
      }
    }

    return {
      totalHits,
      totalLimitExceeded,
      byScope,
      currentLimits,
    };
  }
}
