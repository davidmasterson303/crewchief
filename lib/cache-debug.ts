export interface PerformanceMetrics {
  stage: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  vehicleId: string;
  performanceGoal: string;
  details?: Record<string, any>;
}

class CacheDebugManager {
  private metrics: PerformanceMetrics[] = [];
  private sessionStart = Date.now();
  private verbose = typeof window !== 'undefined' && (window as any).__CREW_CHIEF_DEBUG_VERBOSE;

  logStage(stage: string, vehicleId: string, performanceGoal: string, details?: Record<string, any>) {
    const metric: PerformanceMetrics = {
      stage,
      startTime: Date.now(),
      vehicleId,
      performanceGoal,
      details,
    };

    this.metrics.push(metric);

    if (this.verbose) {
      console.log(`[CACHE_DEBUG] ${stage} started at ${this.getRelativeTime(metric.startTime)}`);
    }

    return metric;
  }

  completeStage(metric: PerformanceMetrics) {
    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;

    if (this.verbose) {
      console.log(
        `[CACHE_DEBUG] ${metric.stage} completed in ${metric.duration}ms`,
        metric.details || ''
      );
    }
  }

  private getRelativeTime(timestamp: number): string {
    const elapsed = timestamp - this.sessionStart;
    return `+${elapsed}ms`;
  }

  getSummary() {
    const stages = this.metrics.map((m) => ({
      stage: m.stage,
      duration: m.duration || 'in-progress',
      vehicleId: m.vehicleId.substring(0, 8),
      performanceGoal: m.performanceGoal,
    }));

    console.table(stages);
    console.log(`Total metrics recorded: ${this.metrics.length}`);
  }

  getMetrics() {
    return this.metrics;
  }

  clear() {
    this.metrics = [];
  }

  checkRegression(threshold: number = 500) {
    const slowStages = this.metrics.filter((m) => m.duration && m.duration > threshold);

    if (slowStages.length > 0) {
      console.warn(
        `[PERF_WARN] ${slowStages.length} stage(s) exceeded ${threshold}ms threshold:`,
        slowStages.map((s) => `${s.stage} (${s.duration}ms)`)
      );
      return false;
    }

    return true;
  }
}

export const cacheDebugManager = new CacheDebugManager();

export function enableCacheDebugVerbose() {
  if (typeof window !== 'undefined') {
    (window as any).__CREW_CHIEF_DEBUG_VERBOSE = true;
  }
}

export function getCacheDebugSummary() {
  cacheDebugManager.getSummary();
}

export function checkCachePerformance(threshold?: number) {
  return cacheDebugManager.checkRegression(threshold);
}
