export type CoreEventMap = {
  'market:update': { symbol: string; lagMs: number; candleCloseTs: number; close: number };
  'indicator:update': { symbol: string; timestamp: number };
  'signal:update': { symbol: string; action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; modelVersion: string };
  'order:execute': { symbol: string; side: 'BUY' | 'SELL'; qty: number; expectedPrice: number; executedPrice: number };
  'strategy:stats': { totalEvaluations: number; totalSignals: number; totalTradesExecuted: number };
};

type Listener<T> = (payload: T) => void;

export class TypedEventBus {
  private listeners = new Map<keyof CoreEventMap, Set<Listener<any>>>();

  on<K extends keyof CoreEventMap>(event: K, listener: Listener<CoreEventMap[K]>): () => void {
    const existing = this.listeners.get(event) || new Set();
    existing.add(listener);
    this.listeners.set(event, existing);
    return () => existing.delete(listener);
  }

  emit<K extends keyof CoreEventMap>(event: K, payload: CoreEventMap[K]): void {
    const existing = this.listeners.get(event);
    if (!existing) return;
    for (const listener of existing) listener(payload);
  }
}

export const coreEventBus = new TypedEventBus();
