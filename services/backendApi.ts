import { ActionType, Trade } from '../types';

const BACKEND_BASE_URL = (import.meta as ImportMeta & { env: { VITE_BACKEND_URL?: string } }).env.VITE_BACKEND_URL ?? 'http://localhost:8787';

export type BackendStatus = {
  running: boolean;
  lastHeartbeatTs: string | null;
  selectedSymbol: string;
  evaluationsCount: number;
  signalsCount: number;
  tradesExecutedCount: number;
  autoPaper: boolean;
  confidenceThreshold: number;
};

export type ManualTradePayload = {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty?: number;
  notionalUsd?: number;
  tpPct?: number;
  slPct?: number;
  tpPrice?: number;
  slPrice?: number;
};

export async function getBackendStatus(): Promise<BackendStatus> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/status`);
  if (!response.ok) throw new Error('Unable to load backend status');
  return response.json() as Promise<BackendStatus>;
}

export async function getBackendTrades(limit = 100): Promise<Trade[]> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/trades?limit=${limit}`);
  if (!response.ok) throw new Error('Unable to load backend trades');
  const rows = await response.json() as Array<any>;
  return rows.map(row => ({
    id: row.id,
    symbol: row.symbol,
    type: row.side === 'SELL' ? ActionType.SELL : ActionType.BUY,
    price: row.entryPrice,
    amount: row.qty,
    timestamp: Date.parse(row.tsOpen),
    pnl: row.pnlAbs ?? undefined,
    fee: row.fee ?? 0,
    stopLoss: row.slPrice ?? undefined,
    takeProfit: row.tpPrice ?? undefined,
  }));
}

export async function forceTrade(payload: ManualTradePayload): Promise<{ tradeId: string }> {
  const response = await fetch(`${BACKEND_BASE_URL}/api/force-trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Unable to force trade');
  }
  return response.json() as Promise<{ tradeId: string }>;
}

export async function setTestSignalMode(enabled: boolean) {
  const response = await fetch(`${BACKEND_BASE_URL}/api/test-signal-mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error('Unable to toggle test signal mode');
}
