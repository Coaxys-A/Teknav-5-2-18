import { Logger } from '@nestjs/common';

/**
 * Error Classifier
 * M11 - Queue Platform: "Smart Retry + Error Classification"
 *
 * Maps errors to classes for retry policy:
 * - TRANSIENT: Network, timeout (exponential + jitter, cap 10m)
 * - RATE_LIMITED: Respect retry-after
 * - VALIDATION: Never retry
 * - AUTH: Never retry unless token refreshed
 * - CONFLICT: Retry with linear + jitter
 * - POISON: Move to DLQ immediately
 */

export enum ErrorClass {
  TRANSIENT = 'transient',
  RATE_LIMITED = 'rate_limited',
  VALIDATION = 'validation',
  AUTH = 'auth',
  CONFLICT = 'conflict',
  POISON = 'poison',
}

export interface ErrorClassification {
  class: ErrorClass;
  shouldRetry: boolean;
  retryAfter?: number; // milliseconds
  moveToDlq?: boolean;
  message: string;
}

@Injectable()
export class ErrorClassifier {
  private readonly logger = new Logger(ErrorClassifier.name);

  // Common error patterns
  private readonly TRANSIENT_PATTERNS = [
    /ECONNREFUSED/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /ECONNRESET/,
    /EPIPE/,
    /timeout/i,
    /network/i,
    /temporary/i,
    /transient/i,
    /502|503|504/, // Gateway/Service Unavailable
  ];

  private readonly VALIDATION_PATTERNS = [
    /validation/i,
    /invalid/i,
    /bad request/i,
    /400/,
    /422/,
  ];

  private readonly AUTH_PATTERNS = [
    /unauthorized/i,
    /forbidden/i,
    /401|403/,
    /token/i,
    /authentication/i,
  ];

  private readonly CONFLICT_PATTERNS = [
    /conflict/i,
    /409/,
    /version mismatch/i,
  ];

  private readonly POISON_PATTERNS = [
    /poison/i,
    /corrupted/i,
    /malformed/i,
    /unexpected/i,
  ];

  /**
   * Classify error
   */
  classify(error: Error): ErrorClassification {
    const errorMessage = error.message || '';
    const errorName = error.name || '';

    this.logger.debug(`Classifying error: ${errorName} - ${errorMessage}`);

    // 1. Check for POISON errors (highest priority - immediate DLQ)
    if (this.isPoisonError(error, errorMessage)) {
      return {
        class: ErrorClass.POISON,
        shouldRetry: false,
        moveToDlq: true,
        message: 'Poison job detected - immediate DLQ',
      };
    }

    // 2. Check for VALIDATION errors (never retry)
    if (this.isValidationError(error, errorMessage)) {
      return {
        class: ErrorClass.VALIDATION,
        shouldRetry: false,
        message: 'Validation error - no retry',
      };
    }

    // 3. Check for AUTH errors (no retry unless token refresh)
    if (this.isAuthError(error, errorMessage)) {
      return {
        class: ErrorClass.AUTH,
        shouldRetry: false, // Token refresh handled separately
        message: 'Auth error - no retry',
      };
    }

    // 4. Check for CONFLICT errors (retry with linear + jitter)
    if (this.isConflictError(error, errorMessage)) {
      return {
        class: ErrorClass.CONFLICT,
        shouldRetry: true,
        message: 'Conflict error - retry with linear backoff',
      };
    }

    // 5. Check for RATE_LIMITED errors (respect retry-after)
    if (this.isRateLimitError(error, errorMessage)) {
      const retryAfter = this.extractRetryAfter(error);
      return {
        class: ErrorClass.RATE_LIMITED,
        shouldRetry: true,
        retryAfter: retryAfter,
        message: `Rate limited - retry after ${retryAfter}ms`,
      };
    }

    // 6. Default to TRANSIENT (exponential + jitter)
    return {
      class: ErrorClass.TRANSIENT,
      shouldRetry: true,
      message: 'Transient error - retry with exponential backoff',
    };
  }

  /**
   * Check if error is POISON
   */
  private isPoisonError(error: Error, message: string): boolean {
    // Check patterns
    if (this.POISON_PATTERNS.some(pattern => pattern.test(message))) {
      return true;
    }

    // Check error codes
    if ((error as any).code && ['EPARSE', 'EBADMSG', 'EMSGSIZE'].includes((error as any).code)) {
      return true;
    }

    return false;
  }

  /**
   * Check if error is VALIDATION
   */
  private isValidationError(error: Error, message: string): boolean {
    return this.VALIDATION_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * Check if error is AUTH
   */
  private isAuthError(error: Error, message: string): boolean {
    return this.AUTH_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * Check if error is CONFLICT
   */
  private isConflictError(error: Error, message: string): boolean {
    return this.CONFLICT_PATTERNS.some(pattern => pattern.test(message));
  }

  /**
   * Check if error is RATE_LIMITED
   */
  private isRateLimitError(error: Error, message: string): boolean {
    return /rate limit/i.test(message) || /429/.test(message);
  }

  /**
   * Extract retry-after from error
   */
  private extractRetryAfter(error: Error): number {
    // Check error object for retryAfter property
    const retryAfter = (error as any).retryAfter || (error as any).retry_after;

    if (retryAfter) {
      return typeof retryAfter === 'number'
        ? retryAfter * 1000 // Convert to ms
        : new Date(retryAfter).getTime() - Date.now();
    }

    // Check HTTP headers (if available)
    const headers = (error as any).response?.headers;
    if (headers) {
      const retryAfterHeader = headers['retry-after'] || headers['x-ratelimit-reset'];
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader as string);
        if (!isNaN(seconds)) {
          return seconds * 1000;
        }
      }
    }

    // Default: 60s
    return 60000;
  }

  /**
   * Calculate delay based on error class and attempts
   */
  calculateDelay(classification: ErrorClass, attemptsMade: number): number {
    const baseDelay = 2000; // 2s
    const maxDelay = 10 * 60 * 1000; // 10m

    switch (classification) {
      case ErrorClass.TRANSIENT:
        // Exponential + jitter: 2s * (2 ^ attempts)
        const exponentialDelay = baseDelay * Math.pow(2, attemptsMade);
        const jitter = Math.random() * 1000; // 0-1s jitter
        return Math.min(exponentialDelay + jitter, maxDelay);

      case ErrorClass.RATE_LIMITED:
        // Respect retry-after from error classification
        return classification.retryAfter || 60000;

      case ErrorClass.CONFLICT:
        // Linear + jitter: 2s + (attemptsMade * 1s)
        const linearDelay = baseDelay + (attemptsMade * 1000);
        const jitter = Math.random() * 500;
        return Math.min(linearDelay + jitter, maxDelay);

      case ErrorClass.POISON:
        // No delay - move to DLQ immediately
        return 0;

      case ErrorClass.VALIDATION:
      case ErrorClass.AUTH:
        // No delay - no retry
        return 0;

      default:
        return baseDelay;
    }
  }

  /**
   * Should move to DLQ immediately?
   */
  shouldMoveToDlq(error: Error): boolean {
    const classification = this.classify(error);
    return classification.moveToDlq === true;
  }

  /**
   * Should retry job?
   */
  shouldRetry(error: Error): boolean {
    const classification = this.classify(error);
    return classification.shouldRetry === true;
  }
}
