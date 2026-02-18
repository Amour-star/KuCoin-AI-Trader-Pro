import React, { useEffect, useMemo, useState } from 'react';
import { Trade, ActionType } from '../types';
import { Download, Filter, X } from 'lucide-react';
import { loadTrades, subscribeToTradeStorage } from '../services/storage/tradeStorage';

interface TradeLogProps {
  trades: Trade[];
}

interface TradeHistoryRow {
  id: string;
  time: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice?: number;
  size: number;
  fee: number;
  pnl?: number;
  pnlPct?: number;
  confidence?: number;
  strategyVersion?: string;
  aiNote?: string;
}

const round4 = (value: number): number => Number(value.toFixed(4));

const mergeTrades = (propTrades: Trade[], storedTrades: Trade[]): Trade[] => {
  const map = new Map<string, Trade>();
  for (const trade of [...propTrades, ...storedTrades]) {
    map.set(trade.id, trade);
  }
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
};

const buildRows = (sourceTrades: Trade[]): TradeHistoryRow[] => {
  const sorted = [...sourceTrades].sort((a, b) => a.timestamp - b.timestamp);
  const lastBuyBySymbol = new Map<string, Trade>();
  const rows: TradeHistoryRow[] = [];

  for (const trade of sorted) {
    if (trade.type === ActionType.BUY) {
      lastBuyBySymbol.set(trade.symbol, trade);
      rows.push({
        id: trade.id,
        time: trade.timestamp,
        symbol: trade.symbol,
        side: 'BUY',
        entryPrice: round4(trade.price),
        size: round4(trade.amount),
        fee: round4(trade.fee),
        confidence: trade.setupScore,
        strategyVersion: trade.strategyVersion,
        aiNote: trade.aiNotes?.[0],
      });
      continue;
    }

    const entryTrade = lastBuyBySymbol.get(trade.symbol);
    const entryPrice = entryTrade?.price ?? trade.price;
    const pnl = typeof trade.pnl === 'number' ? trade.pnl : undefined;
    const pnlPct = pnl !== undefined && entryPrice > 0 && trade.amount > 0 ? (pnl / (entryPrice * trade.amount)) * 100 : undefined;

    rows.push({
      id: trade.id,
      time: trade.timestamp,
      symbol: trade.symbol,
      side: 'SELL',
      entryPrice: round4(entryPrice),
      exitPrice: round4(trade.price),
      size: round4(trade.amount),
      fee: round4(trade.fee),
      pnl: pnl !== undefined ? round4(pnl) : undefined,
      pnlPct: pnlPct !== undefined ? round4(pnlPct) : undefined,
      confidence: trade.setupScore,
      strategyVersion: trade.strategyVersion,
      aiNote: trade.aiNotes?.[0],
    });
  }

  return rows.sort((a, b) => b.time - a.time);
};

const TradeLog: React.FC<TradeLogProps> = ({ trades }) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sideFilter, setSideFilter] = useState<string>('ALL');
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [storedTrades, setStoredTrades] = useState<Trade[]>(() => loadTrades());

  useEffect(() => {
    const sync = () => setStoredTrades(loadTrades());
    sync();
    const unsubscribe = subscribeToTradeStorage(sync);
    return unsubscribe;
  }, []);

  const sourceTrades = useMemo(() => mergeTrades(trades, storedTrades), [trades, storedTrades]);
  const historyRows = useMemo(() => buildRows(sourceTrades), [sourceTrades]);

  const uniqueSymbols = useMemo(() => {
    const symbols = new Set(historyRows.map(row => row.symbol));
    return Array.from(symbols).sort();
  }, [historyRows]);

  const filteredRows = useMemo(() => {
    return historyRows.filter(row => {
      if (sideFilter !== 'ALL' && row.side !== sideFilter) return false;
      if (symbolFilter !== 'ALL' && row.symbol !== symbolFilter) return false;
      if (startDate) {
        const startTimestamp = new Date(startDate).setHours(0, 0, 0, 0);
        if (row.time < startTimestamp) return false;
      }
      if (endDate) {
        const endTimestamp = new Date(endDate).setHours(23, 59, 59, 999);
        if (row.time > endTimestamp) return false;
      }
      return true;
    });
  }, [historyRows, sideFilter, symbolFilter, startDate, endDate]);

  const downloadCSV = () => {
    const headers = ['Time', 'Symbol', 'Side', 'Entry Price', 'Exit Price', 'Size', 'Fee', 'PnL', 'PnL %', 'Confidence Score', 'Strategy Version', 'AI Notes'];
    const rows = filteredRows.map(row => [
      new Date(row.time).toISOString(),
      row.symbol,
      row.side,
      row.entryPrice,
      row.exitPrice ?? '',
      row.size,
      row.fee,
      row.pnl ?? '',
      row.pnlPct ?? '',
      typeof row.confidence === 'number' ? row.confidence.toFixed(4) : '',
      row.strategyVersion ?? '',
      row.aiNote ?? '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'trade_history_usdc.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setSideFilter('ALL');
    setSymbolFilter('ALL');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters = sideFilter !== 'ALL' || symbolFilter !== 'ALL' || startDate !== '' || endDate !== '';

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 flex flex-col h-full">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
        <h3 className="text-slate-300 font-semibold flex items-center gap-2">
          Trade History <span className="text-slate-500 text-xs font-normal">({filteredRows.length})</span>
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded transition border ${
              isFilterOpen || hasActiveFilters
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                : 'bg-slate-800 text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Filter size={14} /> {isFilterOpen ? 'Hide Filters' : 'Filter'}
          </button>
          <button
            onClick={downloadCSV}
            className="text-xs flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded transition"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {isFilterOpen && (
        <div className="p-3 bg-slate-950/50 border-b border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Side</label>
            <select
              value={sideFilter}
              onChange={event => setSideFilter(event.target.value)}
              className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5"
            >
              <option value="ALL">All</option>
              <option value={ActionType.BUY}>Buy</option>
              <option value={ActionType.SELL}>Sell</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Symbol</label>
            <select
              value={symbolFilter}
              onChange={event => setSymbolFilter(event.target.value)}
              className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5"
            >
              <option value="ALL">All Symbols</option>
              {uniqueSymbols.map(symbol => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">From</label>
            <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5 [color-scheme:dark]" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">To</label>
            <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5 [color-scheme:dark]" />
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="col-span-2 md:col-span-4 text-xs text-red-400 hover:text-red-300 flex items-center justify-center gap-1 mt-1 py-1">
              <X size={12} /> Clear Active Filters
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-2 min-h-0">
        <table className="w-full text-left text-xs text-slate-400">
          <thead className="text-slate-500 font-medium sticky top-0 bg-slate-900 z-10">
            <tr>
              <th className="pb-2 pl-2">Time</th><th className="pb-2">Symbol</th><th className="pb-2">Side</th>
              <th className="pb-2 text-right">Entry Price</th><th className="pb-2 text-right">Exit Price</th><th className="pb-2 text-right">Size</th>
              <th className="pb-2 text-right">Fee</th><th className="pb-2 text-right">PnL</th><th className="pb-2 text-right">PnL %</th>
              <th className="pb-2 text-right">Confidence</th><th className="pb-2 text-right">Strategy</th><th className="pb-2 text-right pr-2">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filteredRows.map(row => (
              <tr key={row.id} className="hover:bg-slate-800/40">
                <td className="py-2 pl-2 font-mono whitespace-nowrap">{new Date(row.time).toLocaleString()}</td>
                <td className="py-2 font-mono text-slate-200">{row.symbol}</td>
                <td className={`py-2 font-bold ${row.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>{row.side}</td>
                <td className="py-2 text-right font-mono">{row.entryPrice.toFixed(4)}</td>
                <td className="py-2 text-right font-mono">{typeof row.exitPrice === 'number' ? row.exitPrice.toFixed(4) : '-'}</td>
                <td className="py-2 text-right font-mono">{row.size.toFixed(4)}</td>
                <td className="py-2 text-right font-mono text-amber-300">{row.fee.toFixed(4)}</td>
                <td className={`py-2 text-right font-mono ${typeof row.pnl === 'number' ? (row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                  {typeof row.pnl === 'number' ? row.pnl.toFixed(4) : '-'}
                </td>
                <td className={`py-2 text-right font-mono ${typeof row.pnlPct === 'number' ? (row.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                  {typeof row.pnlPct === 'number' ? `${row.pnlPct.toFixed(4)}%` : '-'}
                </td>
                <td className="py-2 text-right font-mono text-blue-300">{typeof row.confidence === 'number' ? row.confidence.toFixed(4) : '-'}</td>
                <td className="py-2 text-right font-mono">{row.strategyVersion ?? '-'}</td>
                <td className="py-2 text-right pr-2 max-w-[220px] truncate" title={row.aiNote || ''}>{row.aiNote || '-'}</td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr><td colSpan={12} className="text-center py-8 text-slate-600 italic">No persisted trade history entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TradeLog;
