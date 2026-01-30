import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Circuit Breaker Service
 * M11 - Queue Platform: "Circuit Breakers + Self-Healing"
 *
 * Features:
 * - Redis-based circuit state (open/closed)
 * - Failure tracking with threshold
 * - Timeout for open state
 * - Automatic retry after timeout
 * - Dependency tracking (OpenRouter API, Postgres, Plugin Sandbox, Webhooks)
 */

export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Failing, block requests
  HALF_OPEN = 'half_open', // Testing if recovered
}

export enum Dependency {
  OPENROUTER_API = 'openrouter_api',
  POSTGRES = 'postgres',
  PLUGIN_SANDBOX = 'plugin_sandbox',
  WEBHOOK_TARGET = 'webhook_target',
  REDIS = 'redis',
  AI_SERVICE = 'ai_service',
  EMAIL_PROVIDER = 'email_provider',
  OTP_PROVIDER = 'otp_provider',
}

export interface CircuitConfig {
  failureThreshold: number; // Failures before opening
  resetTimeout: number; // Time to stay open (ms)
  halfOpenMaxCalls: number; // Max calls in half-open state
}

export interface CircuitStatus {
  state: CircuitState;
  failures: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly CIRCUIT_PREFIX = 'teknav:cb';
  private readonly STATUS_PREFIX = 'teknav:cb:status';

  private readonly DEFAULT_CONFIG: CircuitConfig = {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    halfOpenMaxCalls: 3,
  };

  private halfOpenCallCounters: Map<Dependency, number> = new Map();

  constructor(private readonly redis: Redis) {}

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    dependency: Dependency,
    fn: () => Promise<T>,
    config: Partial<CircuitConfig> = {},
  ): Promise<{ success: boolean; result?: T; error?: any }> {
    const circuitConfig = { ...this.DEFAULT_CONFIG, ...config };
    const circuitKey = `${this.CIRCUIT_PREFIX}:${dependency}`;
    const statusKey = `${this.STATUS_PREFIX}:${dependency}`;

    // Get current circuit status
    const status = await this.getStatus(dependency, circuitKey);

    this.logger.debug(`Circuit status for ${dependency}: ${status.state}`);

    // Check if circuit is OPEN (block execution)
    if (status.state === CircuitState.OPEN) {
      // Check if reset timeout has passed
      if (status.nextAttemptTime && new Date() < status.nextAttemptTime) {
        const waitTime = status.nextAttemptTime.getTime() - Date.now();
        this.logger.warn(`Circuit OPEN for ${dependency}, waiting ${waitTime}ms`);

        return {
          success: false,
          error: new Error(`Circuit OPEN for ${dependency}, retry in ${waitTime}ms`),
        };
      }

      // Reset timeout passed, move to HALF_OPEN
      await this.setState(dependency, statusKey, CircuitState.HALF_OPEN, 0);
      this.halfOpenCallCounters.set(dependency, 0);
      this.logger.log(`Circuit HALF_OPEN for ${dependency} (reset timeout passed)`);
    }

    // Check if HALF_OPEN (limited execution)
    if (status.state === CircuitState.HALF_OPEN) {
      const callCount = this.halfOpenCallCounters.get(dependency) || 0;

      if (callCount >= circuitConfig.halfOpenMaxCalls) {
        this.logger.warn(`Circuit HALF_OPEN max calls reached for ${dependency}`);
        return {
          success: false,
          error: new Error(`Circuit HALF_OPEN for ${dependency}, max calls reached`),
        };
      }

      this.halfOpenCallCounters.set(dependency, callCount + 1);
    }

    // Execute function
    try {
      const result = await fn();

      // Success - reset failures
      if (status.failures > 0) {
        await this.recordSuccess(dependency, statusKey, circuitConfig);
      }

      // If HALF_OPEN and success, close circuit
      if (status.state === CircuitState.HALF_OPEN) {
        await this.setState(dependency, statusKey, CircuitState.CLOSED, 0);
        this.logger.log(`Circuit CLOSED for ${dependency} (HALF_OPEN test succeeded)`);
      }

      return { success: true, result };
    } catch (error: any) {
      // Failure - increment and check threshold
      await this.recordFailure(dependency, statusKey, circuitConfig);

      const newStatus = await this.getStatus(dependency, statusKey);

      // If circuit just opened, log it
      if (newStatus.state === CircuitState.OPEN) {
        this.logger.error(`Circuit OPENED for ${dependency} (${newStatus.failures} failures)`);

        // Publish to security events
        await this.publishCircuitEvent(dependency, 'OPENED', {
          failures: newStatus.failures,
          error: error.message,
        });
      }

      return {
        success: false,
        error,
      };
    }
  }

  /**
   * Get circuit status
   */
  async getStatus(dependency: Dependency, circuitKey: string): Promise<CircuitStatus> {
    const statusData = await this.redis.get(circuitKey);

    if (!statusData) {
      return {
        state: CircuitState.CLOSED,
        failures: 0,
      };
    }

    const status = JSON.parse(statusData);

    // Check if circuit should be reset (timeout passed in OPEN state)
    if (status.state === CircuitState.OPEN && status.nextAttemptTime) {
      if (new Date() >= status.nextAttemptTime) {
        return {
          ...status,
          state: CircuitState.HALF_OPEN, // Move to HALF_OPEN for next attempt
        };
      }
    }

    return status;
  }

  /**
   * Set circuit state
   */
  private async setState(
    dependency: Dependency,
    statusKey: string,
    state: CircuitState,
    failures: number,
  ): Promise<void> {
    const status: CircuitStatus = {
      state,
      failures,
    };

    if (state === CircuitState.OPEN && failures > 0) {
      status.lastFailureTime = new Date();
      // Calculate next attempt time (reset timeout from config)
      const config = this.DEFAULT_CONFIG;
      status.nextAttemptTime = new Date(Date.now() + config.resetTimeout);
    }

    await this.redis.set(statusKey, JSON.stringify(status), 'EX', 24 * 60 * 60); // 24h TTL
  }

  /**
   * Record success (reset failures)
   */
  private async recordSuccess(
    dependency: Dependency,
    statusKey: string,
    config: CircuitConfig,
  ): Promise<void> {
    await this.setState(dependency, statusKey, CircuitState.CLOSED, 0);
    this.logger.debug(`Circuit success for ${dependency}, reset to CLOSED`);
  }

  /**
   * Record failure (increment failures)
   */
  private async recordFailure(
    dependency: Dependency,
    statusKey: string,
    config: CircuitConfig,
  ): Promise<void> {
    const currentStatus = await this.getStatus(dependency, statusKey);
    const newFailures = currentStatus.failures + 1;

    // Check if threshold reached
    if (newFailures >= config.failureThreshold) {
      await this.setState(dependency, statusKey, CircuitState.OPEN, newFailures);
    } else {
      // Increment failures but keep state
      const updatedStatus: CircuitStatus = {
        ...currentStatus,
        failures: newFailures,
        lastFailureTime: new Date(),
      };

      await this.redis.set(statusKey, JSON.stringify(updatedStatus), 'EX', 24 * 60 * 60);
    }
  }

  /**
   * Manually reset circuit (for admin/owner actions)
   */
  async resetCircuit(dependency: Dependency): Promise<void> {
    const circuitKey = `${this.CIRCUIT_PREFIX}:${dependency}`;
    await this.redis.del(circuitKey);
    this.halfOpenCallCounters.delete(dependency);
    this.logger.log(`Circuit manually reset for ${dependency}`);
  }

  /**
   * Get all circuit statuses (for admin dashboard)
   */
  async getAllCircuits(): Promise<Map<Dependency, CircuitStatus>> {
    const circuits = new Map<Dependency, CircuitStatus>();

    for (const dep of Object.values(Dependency)) {
      const status = await this.getStatus(dep, `${this.CIRCUIT_PREFIX}:${dep}`);
      circuits.set(dep, status);
    }

    return circuits;
  }

  /**
   * Publish circuit event to Redis (for real-time UI)
   */
  private async publishCircuitEvent(
    dependency: Dependency,
    eventType: 'OPENED' | 'CLOSED' | 'HALF_OPEN',
    data: any,
  ): Promise<void> {
    const event = {
      id: `circuit-${Date.now()}-${Math.random()}`,
      type: `circuit.${eventType}`,
      timestamp: new Date().toISOString(),
      dependency,
      data,
    };

    await this.redis.publish('teknav:queue:events', JSON.stringify(event));
  }
}
