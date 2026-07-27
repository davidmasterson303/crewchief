import { eventBus } from '@crewchief/core/event-bus';

export interface FailedDeletion {
  vehicleId: string;
  attemptedAt: string;
  error: string;
  failedTables?: Array<{
    table: string;
    error: string;
  }>;
  retryCount: number;
}

class DeletionRecoveryQueue {
  private storageKey = 'crewchief-failed-deletions';
  private queue: Map<string, FailedDeletion> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as FailedDeletion[];
        parsed.forEach((item) => {
          this.queue.set(item.vehicleId, item);
        });
      }
    } catch (error) {
      console.error('[DeletionRecovery] Failed to load from storage:', error);
    }
  }

  private saveToStorage() {
    if (typeof window === 'undefined') return;

    try {
      const items = Array.from(this.queue.values());
      localStorage.setItem(this.storageKey, JSON.stringify(items));
    } catch (error) {
      console.error('[DeletionRecovery] Failed to save to storage:', error);
    }
  }

  addFailedDeletion(
    vehicleId: string,
    error: string,
    failedTables?: Array<{ table: string; error: string }>
  ) {
    const existing = this.queue.get(vehicleId);
    const retryCount = existing ? existing.retryCount + 1 : 0;

    const failedDeletion: FailedDeletion = {
      vehicleId,
      attemptedAt: new Date().toISOString(),
      error,
      failedTables,
      retryCount,
    };

    this.queue.set(vehicleId, failedDeletion);
    this.saveToStorage();

    eventBus.emit('deletionFailed', vehicleId, error);
  }

  removeDeletion(vehicleId: string) {
    this.queue.delete(vehicleId);
    this.saveToStorage();
  }

  getFailedDeletion(vehicleId: string): FailedDeletion | undefined {
    return this.queue.get(vehicleId);
  }

  getAllFailedDeletions(): FailedDeletion[] {
    return Array.from(this.queue.values());
  }

  getFailedDeletionCount(): number {
    return this.queue.size;
  }

  clear() {
    this.queue.clear();
    this.saveToStorage();
  }
}

export const deletionRecoveryQueue = new DeletionRecoveryQueue();
