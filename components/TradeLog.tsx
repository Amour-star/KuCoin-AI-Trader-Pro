import React, { useEffect, useMemo, useState } from 'react';
import { Trade, ActionType, MarketRegime } from '../types';
import { Download, Filter, X } from 'lucide-react';
import { loadTrades, subscribeToTradeStorage } from '../services/storage/tradeStorage';
import { tradeHistoryCoreService } from '../core/TradeHistoryService';

interface TradeLogProps {
  trades: Trade[];
}

const mergeTrades = (propTrades: Trade[], storedTrades: Trade[]): Trade[] => {
  const map = new Map<string, Trade>();
  for (const trade of [...propTrades, ...storedTrades]) map.set(trade.id, trade);
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
};

const TradeLog: React.FC<TradeLogProps> = ({ trades }) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [confidenceMin, setConfidenceMin] = useState<string>('0');
  const [modelVersion, setModelVersion] = useState<string>('ALL');
  const [regime, setRegime] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [storedTrades, setStoredTrades] = useState<Trade[]>(() => loadTrades());

  useEffect(() => {
    const sync = () => setStoredTrades(loadTrades());
    const unsubscribe = subscribeToTradeStorage(sync);
    return unsubscribe;
  }, []);

  const sourceTrades = useMemo(() => mergeTrades(trades, storedTrades), [trades, storedTrades]);
  const summary = useMemo(() => tradeHistoryCoreService.summarize(sourceTrades), [sourceTrades]);

  const symbols = useMemo(() => Array.from(new Set(sourceTrades.map(t => t.symbol))).sort(), [sourceTrades]);
  const versions = useMemo(() => Array.from(new Set(sourceTrades.map(t => t.modelVersion || t.strategyVersion).filter(Boolean))).sort(), [sourceTrades]);

  const filtered = useMemo(() => sourceTrades.filter(t => {
    if (symbolFilter !== 'ALL' && t.symbol !== symbolFilter) return false;
    if (modelVersion !== 'ALL' && (t.modelVersion || t.strategyVersion) !== modelVersion) return false;
    if (regime !== 'ALL' && (t.marketRegime || 'UNKNOWN') !== regime) return false;
    if ((t.confidence ?? t.setupScore ?? 0) < Number(confidenceMin)) return false;
    if (startDate && t.timestamp < new Date(startDate).setHours(0, 0, 0, 0)) return false;
    if (endDate && t.timestamp > new Date(endDate).setHours(23, 59, 59, 999)) return false;
    return true;
  }), [sourceTrades, symbolFilter, modelVersion, regime, confidenceMin, startDate, endDate]);

  const downloadCSV = () => {
    const headers = ['Time', 'Symbol', 'Side', 'Entry', 'Exit', 'Size', 'Fee', 'Slippage', 'R:R', 'Hold Time', 'PnL', 'PnL%', 'Confidence', 'Regime', 'Version'];
    const rows = filtered.map(t => [
      new Date(t.timestamp).toISOString(),
      t.symbol,
      t.type,
      t.expectedPrice ?? t.price,
      t.executedPrice ?? t.price,
      t.amount,
      t.fee,
      t.slippage ?? t.simulation?.slippage ?? '',
      t.rMultiple ?? '',
      t.holdTimeMs ?? '',
      t.pnl ?? '',
      typeof t.pnl === 'number' && t.price > 0 && t.amount > 0 ? ((t.pnl / (t.price * t.amount)) * 100).toFixed(4) : '',
      t.confidence ?? t.setupScore ?? '',
      t.marketRegime ?? '',
      t.modelVersion ?? t.strategyVersion ?? '',
    ]);

    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.href = encodeURI(csv);
    link.download = 'institutional_trade_history.csv';
    link.click();
  };

  return (
    <div className="bg-slate-950 rounded-lg border border-slate-800 flex flex-col h-full">
      <div className="p-3 border-b border-slate-800">
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
          <div>Total Trades: <span className="text-slate-200">{summary.totalTrades}</span></div>
          <div>Win Rate: <span className="text-slate-200">{(summary.winRate * 100).toFixed(2)}%</span></div>
          <div>Profit Factor: <span className="text-slate-200">{summary.profitFactor.toFixed(2)}</span></div>
          <div>Expectancy: <span className="text-slate-200">{summary.expectancy.toFixed(4)}</span></div>
          <div>Max DD: <span className="text-red-300">{summary.maxDrawdownPct.toFixed(2)}%</span></div>
          <div>Sharpe Proxy: <span className="text-slate-200">{summary.sharpeProxy.toFixed(3)}</span></div>
          <div>MAR: <span className="text-slate-200">{summary.mar.toFixed(3)}</span></div>
        </div>
      </div>

      <div className="p-3 border-b border-slate-800 flex justify-between">
        <button onClick={() => setIsFilterOpen(v => !v)} className="text-xs flex items-center gap-1 px-2 py-1 bg-slate-800 rounded"><Filter size={13} />Filters</button>
        <button onClick={downloadCSV} className="text-xs px-2 py-1 bg-slate-800 rounded"><Download size={13} className="inline mr-1" />CSV</button>
      </div>

      {isFilterOpen && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 p-3 border-b border-slate-800 text-xs">
          <select className="bg-slate-900 p-1 rounded" value={symbolFilter} onChange={e => setSymbolFilter(e.target.value)}><option value="ALL">Symbol</option>{symbols.map(s => <option key={s} value={s}>{s}</option>)}</select>
          <select className="bg-slate-900 p-1 rounded" value={regime} onChange={e => setRegime(e.target.value)}><option value="ALL">Regime</option>{['TRENDING_UP','TRENDING_DOWN','RANGING','CHOP','HIGH_VOLATILITY'].map(r => <option key={r} value={r}>{r}</option>)}</select>
          <input className="bg-slate-900 p-1 rounded" type="number" min="0" max="1" step="0.01" value={confidenceMin} onChange={e => setConfidenceMin(e.target.value)} placeholder="Min Confidence" />
          <select className="bg-slate-900 p-1 rounded" value={modelVersion} onChange={e => setModelVersion(e.target.value)}><option value="ALL">Version</option>{versions.map(v => <option key={v} value={v}>{v}</option>)}</select>
          <input className="bg-slate-900 p-1 rounded [color-scheme:dark]" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <input className="bg-slate-900 p-1 rounded [color-scheme:dark]" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <button className="col-span-2 md:col-span-6 text-red-300 flex items-center justify-center gap-1" onClick={() => { setSymbolFilter('ALL'); setRegime('ALL'); setConfidenceMin('0'); setModelVersion('ALL'); setStartDate(''); setEndDate(''); }}><X size={12} />Reset Filters</button>
        </div>
      )}

      <div className="overflow-auto max-h-[420px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-950 text-slate-400"><tr>
            <th>Time</th><th>Symbol</th><th>Side</th><th className="text-right">Entry</th><th className="text-right">Exit</th><th className="text-right">Size</th><th className="text-right">Fee</th><th className="text-right">Slippage</th><th className="text-right">R:R</th><th className="text-right">Hold</th><th className="text-right">PnL</th><th className="text-right">PnL%</th><th className="text-right">Confidence</th><th className="text-right">Regime</th><th className="text-right">Version</th>
          </tr></thead>
          <tbody>
            {filtered.map(t => {
              const pnlPct = typeof t.pnl === 'number' && t.price > 0 && t.amount > 0 ? (t.pnl / (t.price * t.amount)) * 100 : undefined;
              return <tr key={t.id} className="border-t border-slate-800/60 hover:bg-slate-900/70">
                <td>{new Date(t.timestamp).toLocaleString()}</td><td>{t.symbol}</td><td className={t.type === ActionType.BUY ? 'text-emerald-400' : 'text-red-400'}>{t.type}</td>
                <td className="text-right">{(t.expectedPrice ?? t.price).toFixed(4)}</td><td className="text-right">{(t.executedPrice ?? t.price).toFixed(4)}</td><td className="text-right">{t.amount.toFixed(5)}</td><td className="text-right">{t.fee.toFixed(4)}</td><td className="text-right">{(t.slippage ?? t.simulation?.slippage ?? 0).toFixed(6)}</td><td className="text-right">{(t.rMultiple ?? 0).toFixed(2)}</td><td className="text-right">{t.holdTimeMs ? `${Math.round(t.holdTimeMs / 1000)}s` : '-'}</td>
                <td className={`text-right ${typeof t.pnl === 'number' && t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{typeof t.pnl === 'number' ? t.pnl.toFixed(4) : '-'}</td>
                <td className="text-right">{typeof pnlPct === 'number' ? `${pnlPct.toFixed(3)}%` : '-'}</td><td className="text-right">{(t.confidence ?? t.setupScore ?? 0).toFixed(3)}</td><td className="text-right">{(t.marketRegime || 'N/A') as MarketRegime | 'N/A'}</td><td className="text-right">{t.modelVersion || t.strategyVersion || '-'}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TradeLog;
