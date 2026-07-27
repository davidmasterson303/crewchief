/**
 * CrewChief - Comprehensive Logging System
 *
 * Provides structured logging with different levels, context tracking,
 * and metadata support. Designed for easy debugging during development
 * and production monitoring.
 *
 * Usage:
 *   import { logger } from './logger';
 *
 *   logger.info('USER:LOGIN', 'User logged in successfully', { userId: '123' });
 *   logger.error('API:FETCH', new Error('Failed to fetch'), { endpoint: '/api/v1/vehicles' });
 *   logger.debug('COMPONENT:RENDER', 'Rendering dashboard', { vehicleId: '456' });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = string;
export type LogMetadata = Record<string, unknown>;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: LogContext;
  message: string;
  metadata?: LogMetadata;
  error?: {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  };
  duration?: number;
}

/**
 * Logger class providing structured logging with memory buffer
 * and console output
 */
class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private logs: LogEntry[] = [];
  private maxLogs = 1000; // Keep last 1000 logs in memory for debugging
  private timers: Map<string, number> = new Map();

  /**
   * Create a log entry with all metadata
   */
  private createEntry(
    level: LogLevel,
    context: LogContext,
    message: string,
    metadata?: LogMetadata,
    error?: Error,
    duration?: number
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
      metadata,
      duration,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: this.isDevelopment ? error.stack : undefined,
        cause: error.cause,
      };
    }

    // Store in memory buffer (useful for debugging and crash reports)
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    return entry;
  }

  /**
   * Format log entry for console output
   */
  private formatConsole(entry: LogEntry): [string, ...unknown[]] {
    const emoji = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    }[entry.level];

    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `${emoji} [${entry.level.toUpperCase()}:${entry.context}] ${timestamp}`;

    const parts: unknown[] = [prefix, '-', entry.message];

    if (entry.duration !== undefined) {
      parts.push(`(${entry.duration}ms)`);
    }

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      parts.push('\nMetadata:', entry.metadata);
    }

    if (entry.error) {
      parts.push('\nError:', entry.error.message);
      if (entry.error.stack) {
        parts.push('\nStack:', entry.error.stack);
      }
      if (entry.error.cause) {
        parts.push('\nCause:', entry.error.cause);
      }
    }

    return parts as [string, ...unknown[]];
  }

  /**
   * Log debug message (development only)
   */
  debug(context: LogContext, message: string, metadata?: LogMetadata): void {
    if (!this.isDevelopment) return;

    const entry = this.createEntry('debug', context, message, metadata);
    console.log(...this.formatConsole(entry));
  }

  /**
   * Log informational message
   */
  info(context: LogContext, message: string, metadata?: LogMetadata): void {
    const entry = this.createEntry('info', context, message, metadata);
    console.log(...this.formatConsole(entry));
  }

  /**
   * Log warning message
   */
  warn(context: LogContext, message: string, metadata?: LogMetadata): void {
    const entry = this.createEntry('warn', context, message, metadata);
    console.warn(...this.formatConsole(entry));
  }

  /**
   * Log error with full stack trace
   */
  error(context: LogContext, error: Error, metadata?: LogMetadata): void {
    const entry = this.createEntry('error', context, error.message, metadata, error);
    console.error(...this.formatConsole(entry));

    // TODO: Send to external monitoring service (Sentry, LogRocket, etc.)
    // this.sendToMonitoring(entry);
  }

  /**
   * Start a timer for performance tracking
   */
  startTimer(timerId: string): void {
    this.timers.set(timerId, Date.now());
    this.debug('TIMER:START', `Timer started: ${timerId}`);
  }

  /**
   * End a timer and log the duration
   */
  endTimer(
    timerId: string,
    context: LogContext,
    message: string,
    metadata?: LogMetadata
  ): number {
    const startTime = this.timers.get(timerId);
    if (!startTime) {
      this.warn('TIMER:END', `Timer ${timerId} not found`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(timerId);

    const entry = this.createEntry('info', context, message, metadata, undefined, duration);
    console.log(...this.formatConsole(entry));

    return duration;
  }

  /**
   * Log with automatic timer
   * Returns a function to end the timer
   */
  time(
    context: LogContext,
    message: string,
    metadata?: LogMetadata
  ): () => number {
    const timerId = `${context}:${Date.now()}:${Math.random()}`;
    this.startTimer(timerId);

    return () => this.endTimer(timerId, context, message, metadata);
  }

  /**
   * Get recent logs (useful for debugging)
   */
  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs filtered by context
   */
  getLogsByContext(context: LogContext): LogEntry[] {
    return this.logs.filter((log) => log.context === context);
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  /**
   * Get all error logs (useful for error reports)
   */
  getErrors(): LogEntry[] {
    return this.getLogsByLevel('error');
  }

  /**
   * Export logs as JSON (useful for crash reports)
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Clear all logs (useful for testing)
   */
  clear(): void {
    this.logs = [];
    this.timers.clear();
    this.debug('LOGGER:CLEAR', 'Logs cleared');
  }

  /**
   * Get logger statistics
   */
  getStats(): {
    totalLogs: number;
    byLevel: Record<LogLevel, number>;
    errorCount: number;
    warnCount: number;
  } {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };

    this.logs.forEach((log) => {
      byLevel[log.level]++;
    });

    return {
      totalLogs: this.logs.length,
      byLevel,
      errorCount: byLevel.error,
      warnCount: byLevel.warn,
    };
  }

  /**
   * Group related logs (useful for tracing request flows)
   */
  group(groupName: string, fn: () => void): void {
    if (this.isDevelopment) {
      console.group(groupName);
      fn();
      console.groupEnd();
    } else {
      fn();
    }
  }

  /**
   * Async version of group
   */
  async groupAsync(groupName: string, fn: () => Promise<void>): Promise<void> {
    if (this.isDevelopment) {
      console.group(groupName);
      await fn();
      console.groupEnd();
    } else {
      await fn();
    }
  }
}

/**
 * Singleton logger instance
 */
export const logger = new Logger();

/**
 * Helper function to log async operations with automatic timing
 */
export async function logAsync<T>(
  context: LogContext,
  message: string,
  fn: () => Promise<T>,
  metadata?: LogMetadata
): Promise<T> {
  const endTimer = logger.time(context, message, metadata);

  try {
    const result = await fn();
    endTimer();
    return result;
  } catch (error) {
    endTimer();
    logger.error(context, error as Error, metadata);
    throw error;
  }
}

/**
 * Helper function to create a scoped logger
 * Useful for components or modules that always log to the same context
 */
export function createScopedLogger(baseContext: LogContext) {
  return {
    debug: (message: string, metadata?: LogMetadata) =>
      logger.debug(baseContext, message, metadata),
    info: (message: string, metadata?: LogMetadata) =>
      logger.info(baseContext, message, metadata),
    warn: (message: string, metadata?: LogMetadata) =>
      logger.warn(baseContext, message, metadata),
    error: (error: Error, metadata?: LogMetadata) =>
      logger.error(baseContext, error, metadata),
    time: (message: string, metadata?: LogMetadata) =>
      logger.time(baseContext, message, metadata),
  };
}

/**
 * Debug helper to log component renders
 */
export function logRender(componentName: string, props?: Record<string, unknown>): void {
  logger.debug(`RENDER:${componentName}`, 'Component rendered', { props });
}

/**
 * Debug helper to log hook executions
 */
export function logHook(hookName: string, values?: Record<string, unknown>): void {
  logger.debug(`HOOK:${hookName}`, 'Hook executed', { values });
}
