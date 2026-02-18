import fs from 'node:fs';
import path from 'node:path';
import { Position } from '../../types';

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

interface JsonlStore<T> {
  file: string;
  key: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const stores = {
  decisions: { file: path.join(DATA_DIR, 'decisions.jsonl'), key: 'kucoin-history-decisions' },
  orders: { file: path.join(DATA_DIR, 'orders.jsonl'), key: 'kucoin-history-orders' },
  fills: { file: path.join(DATA_DIR, 'fills.jsonl'), key: 'kucoin-history-fills' },
  positions: { file: path.join(DATA_DIR, 'positions.jsonl'), key: 'kucoin-history-positions' },
};

const isNode = typeof process !== 'undefined' && !!process.versions?.node;
const canUseLocalStorage = () => typeof window !== 'undefined' && !!window.localStorage;

const ensureNodeStorage = (): void => {
  if (!isNode) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const appendAtomic = <T extends object>(store: JsonlStore<T>, record: T): void => {
  const line = `${JSON.stringify(record)}\n`;
  if (isNode) {
    ensureNodeStorage();
    const fd = fs.openSync(store.file, 'a');
    try {
      fs.writeSync(fd, line, undefined, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return;
  }

  if (canUseLocalStorage()) {
    const raw = window.localStorage.getItem(store.key);
    const list = raw ? (JSON.parse(raw) as T[]) : [];
    list.push(record);
    window.localStorage.setItem(store.key, JSON.stringify(list));
  }
};

const readAll = <T extends object>(store: JsonlStore<T>): T[] => {
  if (isNode) {
    ensureNodeStorage();
    if (!fs.existsSync(store.file)) return [];
    const raw = fs.readFileSync(store.file, 'utf8');
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as T;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is T => entry !== null);
  }

  if (canUseLocalStorage()) {
    const raw = window.localStorage.getItem(store.key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  return [];
};

export class TradeHistoryService {
  recordDecision(decision: DecisionRecord): void {
    appendAtomic(stores.decisions, decision);
  }

  recordOrder(order: OrderRecord): void {
    appendAtomic(stores.orders, order);
  }

  recordFill(fill: FillRecord): void {
    appendAtomic(stores.fills, fill);
  }

  recordPositionSnapshot(snapshot: PositionSnapshotRecord): void {
    appendAtomic(stores.positions, snapshot);
  }

  getRecentTrades(limit: number): Array<OrderRecord & { fill?: FillRecord }> {
    const orders = (readAll(stores.orders) as OrderRecord[]).filter(o => o.status !== 'SKIPPED');
    const fills = readAll(stores.fills) as FillRecord[];
    const fillByOrder = new Map(fills.map(fill => [fill.orderId, fill]));
    return orders
      .slice(-limit)
      .reverse()
      .map(order => ({ ...order, fill: fillByOrder.get(order.orderId) }));
  }

  getPnLSummary(from: number, to: number): PnLSummary {
    const fills = (readAll(stores.fills) as FillRecord[]).filter(fill => fill.ts >= from && fill.ts <= to && fill.status === 'FILLED');
    const realizedPnl = 0;
    const fees = fills.reduce((acc, fill) => acc + fill.fees, 0);
    return { from, to, realizedPnl, fees, fills: fills.length };
  }

  hasOrderForIdempotencyKey(key: string): boolean {
    const orders = readAll(stores.orders) as OrderRecord[];
    return orders.some(order => order.idempotencyKey === key && order.status !== 'SKIPPED');
  }

  loadRecentOrders(limit: number): OrderRecord[] {
    return (readAll(stores.orders) as OrderRecord[]).slice(-limit);
  }

  static fromPosition(symbol: string, balance: number, positions: Position[], avgEntryPrice: number, totalPortfolioValue: number): PositionSnapshotRecord {
    const positionSize = positions.filter(p => p.symbol === symbol).reduce((acc, p) => acc + p.amount, 0);
    return {
      ts: Date.now(),
      symbol,
      balance,
      positionSize,
      avgEntryPrice,
      totalPortfolioValue,
    };
  }
}

export const tradeHistoryService = new TradeHistoryService();
