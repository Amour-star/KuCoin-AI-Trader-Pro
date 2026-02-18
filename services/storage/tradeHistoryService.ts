export interface DecisionRecord {
  id: string;
  ts: number;
  symbol: string;
  timeframe: string;
  inputsHash: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasons: string[];
  modelVersion?: string;
}

export interface OrderRecord {
  orderId: string;
  decisionId: string;
  idempotencyKey: string;
  ts: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  requestedPrice: number;
  status: 'ACCEPTED' | 'SKIPPED' | 'REJECTED' | 'FILLED';
  reason?: string;
}

export interface FillRecord {
  fillId: string;
  orderId: string;
  ts: number;
  symbol: string;
  qty: number;
  avgPrice: number;
  fees: number;
  status: 'FILLED' | 'FAILED';
  error?: string;
}

export interface PositionSnapshotRecord {
  ts: number;
  symbol: string;
  balance: number;
  positionSize: number;
  avgEntryPrice: number;
  totalPortfolioValue: number;
}

export interface PnLSummary {
  from: number;
  to: number;
  realizedPnl: number;
  fees: number;
  fills: number;
}

interface StorageShape {
  decisions: DecisionRecord[];
  orders: OrderRecord[];
  fills: FillRecord[];
  positions: PositionSnapshotRecord[];
}

const HISTORY_STORAGE_KEY = 'kucoin-trade-history-v1';
let inMemory: StorageShape = {
  decisions: [],
  orders: [],
  fills: [],
  positions: [],
};

const canUseLocalStorage = (): boolean => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const loadStorage = (): StorageShape => {
  if (!canUseLocalStorage()) return inMemory;

  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return inMemory;
    const parsed = JSON.parse(raw) as Partial<StorageShape>;
    inMemory = {
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      fills: Array.isArray(parsed.fills) ? parsed.fills : [],
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
    };
  } catch {
    // keep in-memory fallback
  }

  return inMemory;
};

const persistStorage = (next: StorageShape): void => {
  inMemory = next;
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/storage errors
  }
};

const appendRecord = <K extends keyof StorageShape>(key: K, record: StorageShape[K][number]): void => {
  const current = loadStorage();
  persistStorage({
    ...current,
    [key]: [...current[key], record],
  } as StorageShape);
};

export class TradeHistoryService {
  recordDecision(decision: DecisionRecord): void {
    appendRecord('decisions', decision);
  }

  recordOrder(order: OrderRecord): void {
    appendRecord('orders', order);
  }

  recordFill(fill: FillRecord): void {
    appendRecord('fills', fill);
  }

  recordPositionSnapshot(snapshot: PositionSnapshotRecord): void {
    appendRecord('positions', snapshot);
  }

  getRecentTrades(limit: number): Array<OrderRecord & { fill?: FillRecord }> {
    const history = loadStorage();
    const orders = history.orders.filter(order => order.status !== 'SKIPPED');
    const fillByOrder = new Map(history.fills.map(fill => [fill.orderId, fill]));

    return orders
      .slice(-Math.max(0, limit))
      .reverse()
      .map(order => ({ ...order, fill: fillByOrder.get(order.orderId) }));
  }

  getPnLSummary(from: number, to: number): PnLSummary {
    const history = loadStorage();
    const fills = history.fills.filter(fill => fill.ts >= from && fill.ts <= to && fill.status === 'FILLED');
    const fees = fills.reduce((acc, fill) => acc + fill.fees, 0);
    return { from, to, realizedPnl: 0, fees, fills: fills.length };
  }

  hasOrderForIdempotencyKey(key: string): boolean {
    const history = loadStorage();
    return history.orders.some(order => order.idempotencyKey === key && order.status !== 'SKIPPED');
  }

  loadRecentOrders(limit: number): OrderRecord[] {
    const history = loadStorage();
    return history.orders.slice(-Math.max(0, limit));
  }
}

export const tradeHistoryService = new TradeHistoryService();
