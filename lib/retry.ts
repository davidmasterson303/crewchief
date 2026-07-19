/**
 * CrewChief - Retry Utility
 *
 * Provides robust retry logic with exponential backoff for handling
 * transient failures in API calls, database operations, and other async tasks.
 *
 * Usage:
 *   import { withRetry, RetryOptions } from '@/lib/retry';
 *
 *   const result = await withRetry(
 *     () => fetch('/api/data'),
 *     { maxAttempts: 3, context: 'API:FETCH_DATA' }
 *   );
 */

import { logger } from '@/lib/logger';

// ============================================================================
// TYPES
// ============================================================================

export interface RetryOptions {
  /**
   * Maximum number of retry attempts (including initial attempt)
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Initial delay between retries in milliseconds
   * @default 1000
   */
  initialDelayMs?: number;

  /**
   * Multiplier for exponential backoff
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Maximum delay between retries in milliseconds
   * @default 30000 (30 seconds)
   */
  maxDelayMs?: number;

  /**
   * Context for logging
   * @default 'RETRY'
   */
  context?: string;

  /**
   * Function to determine if error is retryable
   * @default undefined (all errors are retryable)
   */
  isRetryable?: (error: Error) => boolean;

  /**
   * Callback called before each retry
   */
  onRetry?: (attempt: number, error: Error, delay: number) => void;

  /**
   * Add jitter to delay to prevent thundering herd
   * @default true
   */
  useJitter?: boolean;
}

export interface RetryState {
  attempt: number;
  totalAttempts: number;
  lastError?: Error;
  totalDelay: number;
}

// ============================================================================
// NON-RETRYABLE ERROR CLASSES
// ============================================================================

/**
 * Error that should not be retried (e.g., validation errors)
 */
export class NonRetryableError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Error indicating maximum retries exceeded
 */
export class MaxRetriesExceededError extends Error {
  constructor(
    message: string,
    public attempts: number,
    public lastError?: Error
  ) {
    super(message);
    this.name = 'MaxRetriesExceededError';
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate delay with exponential backoff
 */
function calculateDelay(
  attempt: number,
  initialDelay: number,
  multiplier: number,
  maxDelay: number,
  useJitter: boolean
): number {
  const exponentialDelay = initialDelay * Math.pow(multiplier, attempt - 1);
  let delay = Math.min(exponentialDelay, maxDelay);

  // Add jitter (randomness) to prevent thundering herd
  if (useJitter) {
    const jitter = delay * 0.2 * Math.random(); // ±10% jitter
    delay = delay + jitter - delay * 0.1;
  }

  return Math.round(delay);
}

/**
 * Wait for specified duration
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Default retryable error check
 * Common retryable errors include network errors, timeouts, 5xx errors
 */
function defaultIsRetryable(error: Error): boolean {
  // Don't retry non-retryable errors
  if (error instanceof NonRetryableError) {
    return false;
  }

  // Check error message for common retryable patterns
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    'timeout',
    'network',
    'econnrefused',
    'enotfound',
    'etimedout',
    '5xx',
    'rate limit',
    'too many requests',
    'service unavailable',
    'gateway timeout',
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

// ============================================================================
// RETRY FUNCTION
// ============================================================================

/**
 * Execute a function with retry logic
 *
 * @param fn - The async function to execute
 * @param options - Retry options
 * @returns Promise resolving to function result
 * @throws MaxRetriesExceededError if all retries fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    maxDelayMs = 30000,
    context = 'RETRY',
    isRetryable = defaultIsRetryable,
    onRetry,
    useJitter = true,
  } = options;

  let lastError: Error | undefined;
  let totalDelay = 0;

  logger.debug(context, 'Starting operation with retry', {
    maxAttempts,
    initialDelayMs,
    backoffMultiplier,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.debug(context, `Attempt ${attempt}/${maxAttempts}`);

      const result = await fn();

      if (attempt > 1) {
        logger.info(context, `Succeeded on attempt ${attempt}/${maxAttempts}`, {
          totalDelay,
        });
      }

      return result;
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!isRetryable(lastError)) {
        logger.warn(context, 'Non-retryable error encountered', {
          attempt,
          error: lastError.message,
        });
        throw lastError;
      }

      // If this was the last attempt, throw
      if (attempt === maxAttempts) {
        logger.error(context, lastError, {
          attempt,
          maxAttempts,
          totalDelay,
        });

        throw new MaxRetriesExceededError(
          `Failed after ${maxAttempts} attempts: ${lastError.message}`,
          maxAttempts,
          lastError
        );
      }

      // Calculate delay before next retry
      const delay = calculateDelay(
        attempt,
        initialDelayMs,
        backoffMultiplier,
        maxDelayMs,
        useJitter
      );

      totalDelay += delay;

      logger.warn(context, `Attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: lastError.message,
        attempt,
        maxAttempts,
        delay,
      });

      // Call onRetry callback if provided
      if (onRetry) {
        try {
          onRetry(attempt, lastError, delay);
        } catch (callbackError) {
          logger.error(context, callbackError as Error, {
            note: 'onRetry callback failed',
          });
        }
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached due to the throw in the loop, but TypeScript needs it
  throw new MaxRetriesExceededError(
    `Failed after ${maxAttempts} attempts`,
    maxAttempts,
    lastError
  );
}

/**
 * Create a retryable version of a function with preset options
 *
 * @param fn - The async function to make retryable
 * @param options - Default retry options
 * @returns A new function that retries on failure
 */
export function makeRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {}
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    return withRetry(() => fn(...args), options);
  };
}

/**
 * Retry a function with circuit breaker pattern
 * Opens circuit after repeated failures, preventing further attempts
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private options: {
      failureThreshold: number;
      resetTimeoutMs: number;
      context?: string;
    }
  ) {}

  async execute<T>(fn: () => Promise<T>, retryOptions?: RetryOptions): Promise<T> {
    const context = this.options.context || 'CIRCUIT_BREAKER';

    // Check circuit state
    if (this.state === 'open') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;

      if (timeSinceLastFailure < this.options.resetTimeoutMs) {
        logger.warn(context, 'Circuit is open, rejecting request', {
          failureCount: this.failureCount,
          timeSinceLastFailure,
        });
        throw new NonRetryableError('Circuit breaker is open');
      }

      // Try to recover
      this.state = 'half-open';
      logger.info(context, 'Circuit is half-open, attempting recovery');
    }

    try {
      const result = await withRetry(fn, {
        ...retryOptions,
        context,
      });

      // Success - reset circuit
      if (this.state === 'half-open') {
        logger.info(context, 'Circuit recovered, closing');
      }
      this.failureCount = 0;
      this.state = 'closed';

      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (this.failureCount >= this.options.failureThreshold) {
        this.state = 'open';
        logger.error(context, error as Error, {
          message: 'Circuit breaker opened',
          failureCount: this.failureCount,
          threshold: this.options.failureThreshold,
        });
      }

      throw error;
    }
  }

  reset() {
    this.failureCount = 0;
    this.state = 'closed';
    logger.info(this.options.context || 'CIRCUIT_BREAKER', 'Circuit manually reset');
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Execute multiple operations with retry in parallel
 */
export async function retryAll<T>(
  operations: Array<() => Promise<T>>,
  options: RetryOptions = {}
): Promise<T[]> {
  const context = options.context || 'RETRY_ALL';
  logger.debug(context, `Executing ${operations.length} operations with retry`);

  const results = await Promise.all(
    operations.map((op, index) =>
      withRetry(op, {
        ...options,
        context: `${context}:${index}`,
      })
    )
  );

  logger.info(context, `All ${operations.length} operations completed`);
  return results;
}

/**
 * Execute operations with retry in sequence (one after another)
 */
export async function retrySequence<T>(
  operations: Array<() => Promise<T>>,
  options: RetryOptions = {}
): Promise<T[]> {
  const context = options.context || 'RETRY_SEQUENCE';
  logger.debug(context, `Executing ${operations.length} operations sequentially`);

  const results: T[] = [];

  for (let i = 0; i < operations.length; i++) {
    const result = await withRetry(operations[i], {
      ...options,
      context: `${context}:${i}`,
    });
    results.push(result);
  }

  logger.info(context, `All ${operations.length} operations completed`);
  return results;
}
