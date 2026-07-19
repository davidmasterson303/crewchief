type EventCallback = (...args: any[]) => void;

interface EventBusEvents {
  vehicleDeleted: [vehicleId: string];
  vehicleAdded: [vehicle: any];
  vehicleUpdated: [vehicleId: string, updates: any];
  deletionFailed: [vehicleId: string, error: string];
}

class EventBus {
  private listeners: Map<keyof EventBusEvents, Set<EventCallback>> = new Map();

  on<K extends keyof EventBusEvents>(
    event: K,
    callback: (...args: EventBusEvents[K]) => void
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);

    return () => this.off(event, callback);
  }

  off<K extends keyof EventBusEvents>(
    event: K,
    callback: (...args: EventBusEvents[K]) => void
  ): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback as EventCallback);
    }
  }

  emit<K extends keyof EventBusEvents>(event: K, ...args: EventBusEvents[K]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        callback(...(args as any[]));
      });
    }
  }

  removeAllListeners<K extends keyof EventBusEvents>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

export const eventBus = new EventBus();
