const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }

  return res.json();
}

export type EngineStatus = {
  running: boolean;
  lastHeartbeat: string | null;
  evaluations: number;
  signals: number;
  tradesExecuted: number;
  openPositions: number;
  autoPaper: boolean;
  confidenceThreshold: number;
};

export type TradeRow = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL' | 'HOLD';
  qty: number;
  entry_price: number;
  exit_price: number | null;
  sl_price: number | null;
  tp_price: number | null;
  fee: number;
  slippage: number;
  pnl_abs: number | null;
  pnl_pct: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
};

export type DecisionRow = {
  ts: string;
  symbol: string;
  decision: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasons: string[];
  model_version: string;
};

export type ForceTradePayload = {
  symbol: string;
  side: 'BUY' | 'SELL';
  notionalUsd: number;
  tpPct: number;
  slPct: number;
};

export type SettingsPayload = {
  confidenceThreshold?: number;
  autoPaper?: boolean;
};

export async function fetchStatus(): Promise<EngineStatus> {
  const status = await apiFetch('/api/status');
  return {
    running: Boolean(status.running),
    lastHeartbeat: status.lastHeartbeat ?? status.lastHeartbeatTs ?? null,
    evaluations: Number(status.evaluations ?? status.evaluationsCount ?? 0),
    signals: Number(status.signals ?? status.signalsCount ?? 0),
    tradesExecuted: Number(status.tradesExecuted ?? status.tradesExecutedCount ?? 0),
    openPositions: Number(status.openPositions ?? 0),
    autoPaper: Boolean(status.autoPaper),
    confidenceThreshold: Number(status.confidenceThreshold ?? 0.6),
  };
}

export async function fetchTrades(limit = 100): Promise<TradeRow[]> {
  const rows = (await apiFetch(`/api/trades?limit=${limit}`)) as any[];
  return rows.map((row) => ({
    id: String(row.id),
    symbol: String(row.symbol),
    side: row.side,
    qty: Number(row.qty ?? 0),
    entry_price: Number(row.entry_price ?? row.entryPrice ?? 0),
    exit_price: row.exit_price ?? row.exitPrice ?? null,
    sl_price: row.sl_price ?? row.slPrice ?? null,
    tp_price: row.tp_price ?? row.tpPrice ?? null,
    fee: Number(row.fee ?? 0),
    slippage: Number(row.slippage ?? 0),
    pnl_abs: row.pnl_abs ?? row.pnlAbs ?? null,
    pnl_pct: row.pnl_pct ?? row.pnlPct ?? null,
    status: String(row.status ?? 'UNKNOWN'),
    opened_at: String(row.opened_at ?? row.tsOpen),
    closed_at: row.closed_at ?? row.tsClose ?? null,
  }));
}

export async function fetchDecisions(limit = 100): Promise<DecisionRow[]> {
  const rows = (await apiFetch(`/api/decisions?limit=${limit}`)) as any[];
  return rows.map((row) => ({
    ts: String(row.ts),
    symbol: String(row.symbol),
    decision: row.decision,
    confidence: Number(row.confidence ?? 0),
    reasons: Array.isArray(row.reasons) ? row.reasons.map((item: unknown) => String(item)) : [String(row.reasons ?? '')],
    model_version: String(row.model_version ?? row.modelVersion ?? 'unknown'),
  }));
}

export async function forceTrade(payload: ForceTradePayload): Promise<{ tradeId: string; decisionId: string }> {
  return apiFetch('/api/force-trade', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateSettings(payload: SettingsPayload): Promise<{ autoPaper: boolean; confidenceThreshold: number }> {
  return apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
