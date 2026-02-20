import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  apiFetch,
  DecisionRow,
  EngineStatus,
  ForceTradePayload,
  SettingsPayload,
  TradeRow,
  fetchDecisions,
  fetchStatus,
  fetchTrades,
  forceTrade,
  updateSettings,
} from './lib/api';

const PAGE_SIZE = 10;

const currency = (value: number | null, digits = 2) =>
  typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';

const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

const decisionColor = (decision: DecisionRow['decision']) => {
  if (decision === 'BUY') return 'text-emerald-400';
  if (decision === 'SELL') return 'text-red-400';
  return 'text-slate-400';
};

const pnlColor = (value: number | null) => {
  if (typeof value !== 'number') return 'text-slate-200';
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-slate-200';
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.includes('API error 500')) {
    return 'Backend error';
  }
  return 'Backend unreachable';
};

const App: React.FC = () => {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);

  const [statusLoading, setStatusLoading] = useState(true);
  const [tradesLoading, setTradesLoading] = useState(true);
  const [decisionsLoading, setDecisionsLoading] = useState(true);

  const [statusError, setStatusError] = useState<string | null>(null);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);

  const [connected, setConnected] = useState(false);

  const [tradePage, setTradePage] = useState(1);
  const [decisionPage, setDecisionPage] = useState(1);

  const [forceTradeForm, setForceTradeForm] = useState<ForceTradePayload>({
    symbol: 'ETHUSDC',
    side: 'BUY',
    notionalUsd: 100,
    tpPct: 1.5,
    slPct: 1,
  });
  const [settingsForm, setSettingsForm] = useState<SettingsPayload>({ confidenceThreshold: 0.6, autoPaper: true });
  const [formStatus, setFormStatus] = useState<string | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      await apiFetch('/api/status');
      setConnected(true);
    } catch (err) {
      console.error(err);
      setConnected(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      setStatusError(null);
      const next = await fetchStatus();
      setStatus(next);
      setSettingsForm({ confidenceThreshold: next.confidenceThreshold, autoPaper: next.autoPaper });
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setStatusError(getErrorMessage(error));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      setTradesLoading(true);
      setTradesError(null);
      const next = await fetchTrades(100);
      setTrades(next);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setTradesError(getErrorMessage(error));
    } finally {
      setTradesLoading(false);
    }
  }, []);

  const loadDecisions = useCallback(async () => {
    try {
      setDecisionsLoading(true);
      setDecisionsError(null);
      const next = await fetchDecisions(100);
      setDecisions(next);
      setConnected(true);
    } catch (error) {
      setConnected(false);
      setDecisionsError(getErrorMessage(error));
    } finally {
      setDecisionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkConnection();
    void loadStatus();
    void loadTrades();
    void loadDecisions();
  }, [checkConnection, loadStatus, loadTrades, loadDecisions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadStatus();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [loadStatus]);

  const pagedTrades = useMemo(
    () => trades.slice((tradePage - 1) * PAGE_SIZE, tradePage * PAGE_SIZE),
    [trades, tradePage],
  );
  const pagedDecisions = useMemo(
    () => decisions.slice((decisionPage - 1) * PAGE_SIZE, decisionPage * PAGE_SIZE),
    [decisions, decisionPage],
  );

  const tradePages = Math.max(1, Math.ceil(trades.length / PAGE_SIZE));
  const decisionPages = Math.max(1, Math.ceil(decisions.length / PAGE_SIZE));

  const submitForceTrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormStatus(null);

    try {
      await forceTrade(forceTradeForm);
      setFormStatus('Force trade submitted successfully.');
      await loadTrades();
    } catch (error) {
      setFormStatus(getErrorMessage(error));
    }
  };

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormStatus(null);

    try {
      const result = await updateSettings(settingsForm);
      setSettingsForm(result);
      setFormStatus('Settings updated successfully.');
      await loadStatus();
    } catch (error) {
      setFormStatus(getErrorMessage(error));
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold">KuCoin AI Trader Dashboard</h1>
          <p className="text-slate-400 text-sm">Backend-driven dashboard (Railway + Neon)</p>
        </header>

        {connected && (
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-4 py-2">Connected</div>
        )}
        {!connected && (
          <div className="rounded border border-red-500/30 bg-red-500/10 text-red-300 px-4 py-2">Backend unreachable</div>
        )}

        <section className="bg-slate-900 border border-slate-800 rounded p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Engine Status</h2>
            <button onClick={() => void loadStatus()} className="text-sm px-3 py-1 rounded bg-slate-800 hover:bg-slate-700">
              Refresh
            </button>
          </div>

          {statusLoading && <p className="text-slate-400">Loading status…</p>}
          {statusError && (
            <div className="text-red-400">
              {statusError}{' '}
              <button onClick={() => void loadStatus()} className="underline">
                Retry
              </button>
            </div>
          )}
          {!statusLoading && !statusError && status && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>running: <span className="font-semibold">{String(status.running)}</span></div>
              <div>lastHeartbeat: <span className="font-semibold">{dateTime(status.lastHeartbeat)}</span></div>
              <div>evaluations: <span className="font-semibold">{status.evaluations}</span></div>
              <div>signals: <span className="font-semibold">{status.signals}</span></div>
              <div>tradesExecuted: <span className="font-semibold">{status.tradesExecuted}</span></div>
              <div>openPositions: <span className="font-semibold">{status.openPositions}</span></div>
            </div>
          )}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form onSubmit={submitForceTrade} className="bg-slate-900 border border-slate-800 rounded p-4 space-y-3">
            <h2 className="font-semibold">Force Trade</h2>
            <input
              className="w-full bg-slate-800 rounded px-3 py-2"
              value={forceTradeForm.symbol}
              onChange={(event) => setForceTradeForm((prev) => ({ ...prev, symbol: event.target.value.trim().toUpperCase() }))}
              placeholder="Symbol (ETHUSDC)"
            />
            <select
              className="w-full bg-slate-800 rounded px-3 py-2"
              value={forceTradeForm.side}
              onChange={(event) => setForceTradeForm((prev) => ({ ...prev, side: event.target.value as 'BUY' | 'SELL' }))}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <input
              className="w-full bg-slate-800 rounded px-3 py-2"
              type="number"
              step="0.01"
              value={forceTradeForm.notionalUsd}
              onChange={(event) => setForceTradeForm((prev) => ({ ...prev, notionalUsd: Number(event.target.value) }))}
              placeholder="Notional USD"
            />
            <input
              className="w-full bg-slate-800 rounded px-3 py-2"
              type="number"
              step="0.01"
              value={forceTradeForm.tpPct}
              onChange={(event) => setForceTradeForm((prev) => ({ ...prev, tpPct: Number(event.target.value) }))}
              placeholder="TP %"
            />
            <input
              className="w-full bg-slate-800 rounded px-3 py-2"
              type="number"
              step="0.01"
              value={forceTradeForm.slPct}
              onChange={(event) => setForceTradeForm((prev) => ({ ...prev, slPct: Number(event.target.value) }))}
              placeholder="SL %"
            />
            <button className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-2" type="submit">Confirm Force Trade</button>
          </form>

          <form onSubmit={submitSettings} className="bg-slate-900 border border-slate-800 rounded p-4 space-y-3">
            <h2 className="font-semibold">Settings</h2>
            <input
              className="w-full bg-slate-800 rounded px-3 py-2"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={settingsForm.confidenceThreshold ?? 0}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, confidenceThreshold: Number(event.target.value) }))}
              placeholder="confidenceThreshold"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(settingsForm.autoPaper)}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, autoPaper: event.target.checked }))}
              />
              autoPaper
            </label>
            <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-2" type="submit">Update Settings</button>
          </form>
        </section>

        {formStatus && <div className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm">{formStatus}</div>}

        <section className="bg-slate-900 border border-slate-800 rounded p-4 overflow-x-auto">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Trades</h2>
            <button onClick={() => void loadTrades()} className="text-sm px-3 py-1 rounded bg-slate-800 hover:bg-slate-700">Refresh</button>
          </div>
          {tradesLoading && <p className="text-slate-400">Loading trades…</p>}
          {tradesError && (
            <div className="text-red-400">
              {tradesError}{' '}
              <button onClick={() => void loadTrades()} className="underline">Retry</button>
            </div>
          )}
          {!tradesLoading && !tradesError && (
            <>
              <table className="min-w-full text-sm">
                <thead className="text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="text-left py-2 pr-3">Time</th>
                    <th className="text-left py-2 pr-3">Symbol</th>
                    <th className="text-left py-2 pr-3">Side</th>
                    <th className="text-left py-2 pr-3">Entry</th>
                    <th className="text-left py-2 pr-3">Exit</th>
                    <th className="text-left py-2 pr-3">Qty</th>
                    <th className="text-left py-2 pr-3">TP</th>
                    <th className="text-left py-2 pr-3">SL</th>
                    <th className="text-left py-2 pr-3">Fee</th>
                    <th className="text-left py-2 pr-3">PnL</th>
                    <th className="text-left py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTrades.map((trade) => (
                    <tr key={trade.id} className="border-b border-slate-800">
                      <td className="py-2 pr-3">{dateTime(trade.opened_at)}</td>
                      <td className="py-2 pr-3">{trade.symbol}</td>
                      <td className="py-2 pr-3">{trade.side}</td>
                      <td className="py-2 pr-3">{currency(trade.entry_price)}</td>
                      <td className="py-2 pr-3">{currency(trade.exit_price)}</td>
                      <td className="py-2 pr-3">{trade.qty.toFixed(6)}</td>
                      <td className="py-2 pr-3">{currency(trade.tp_price)}</td>
                      <td className="py-2 pr-3">{currency(trade.sl_price)}</td>
                      <td className="py-2 pr-3">{currency(trade.fee)}</td>
                      <td className={`py-2 pr-3 ${pnlColor(trade.pnl_abs)}`}>{currency(trade.pnl_abs)}</td>
                      <td className="py-2 pr-3">
                        <span className={trade.status === 'OPEN' ? 'text-amber-300 font-semibold' : 'text-cyan-300 font-semibold'}>{trade.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-end gap-2 mt-3">
                <button disabled={tradePage <= 1} onClick={() => setTradePage((prev) => Math.max(1, prev - 1))} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-400">{tradePage} / {tradePages}</span>
                <button disabled={tradePage >= tradePages} onClick={() => setTradePage((prev) => Math.min(tradePages, prev + 1))} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Next</button>
              </div>
            </>
          )}
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded p-4 overflow-x-auto">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Decisions</h2>
            <button onClick={() => void loadDecisions()} className="text-sm px-3 py-1 rounded bg-slate-800 hover:bg-slate-700">Refresh</button>
          </div>
          {decisionsLoading && <p className="text-slate-400">Loading decisions…</p>}
          {decisionsError && (
            <div className="text-red-400">
              {decisionsError}{' '}
              <button onClick={() => void loadDecisions()} className="underline">Retry</button>
            </div>
          )}
          {!decisionsLoading && !decisionsError && (
            <>
              <table className="min-w-full text-sm">
                <thead className="text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="text-left py-2 pr-3">Time</th>
                    <th className="text-left py-2 pr-3">Symbol</th>
                    <th className="text-left py-2 pr-3">Decision</th>
                    <th className="text-left py-2 pr-3">Confidence</th>
                    <th className="text-left py-2 pr-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedDecisions.map((decision, index) => (
                    <tr key={`${decision.ts}-${index}`} className="border-b border-slate-800">
                      <td className="py-2 pr-3">{dateTime(decision.ts)}</td>
                      <td className="py-2 pr-3">{decision.symbol}</td>
                      <td className={`py-2 pr-3 font-semibold ${decisionColor(decision.decision)}`}>{decision.decision}</td>
                      <td className="py-2 pr-3">{(decision.confidence * 100).toFixed(1)}%</td>
                      <td className="py-2 pr-3">{decision.reasons.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-end gap-2 mt-3">
                <button disabled={decisionPage <= 1} onClick={() => setDecisionPage((prev) => Math.max(1, prev - 1))} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-400">{decisionPage} / {decisionPages}</span>
                <button disabled={decisionPage >= decisionPages} onClick={() => setDecisionPage((prev) => Math.min(decisionPages, prev + 1))} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Next</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default App;
