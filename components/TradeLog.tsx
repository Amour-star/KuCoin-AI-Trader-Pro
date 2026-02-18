import React, { useEffect, useMemo, useState } from 'react';
import { Trade, ActionType } from '../types';
import { Download, TrendingUp, TrendingDown, Minus, Filter, X } from 'lucide-react';
import { loadTrades, subscribeToTradeStorage } from '../services/storage/tradeStorage';

interface TradeLogProps {
  trades: Trade[];
}

const mergeTrades = (propTrades: Trade[], storedTrades: Trade[]): Trade[] => {
  const map = new Map<string, Trade>();
  for (const trade of [...propTrades, ...storedTrades]) {
    map.set(trade.id, trade);
  }
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
};

const TradeLog: React.FC<TradeLogProps> = ({ trades }) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
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

  const uniqueSymbols = useMemo(() => {
    const symbols = new Set(sourceTrades.map(trade => trade.symbol));
    return Array.from(symbols).sort();
  }, [sourceTrades]);

  const filteredTrades = useMemo(() => {
    return sourceTrades.filter(trade => {
      if (typeFilter !== 'ALL' && trade.type !== typeFilter) return false;
      if (symbolFilter !== 'ALL' && trade.symbol !== symbolFilter) return false;
      if (startDate) {
        const startTimestamp = new Date(startDate).setHours(0, 0, 0, 0);
        if (trade.timestamp < startTimestamp) return false;
      }
      if (endDate) {
        const endTimestamp = new Date(endDate).setHours(23, 59, 59, 999);
        if (trade.timestamp > endTimestamp) return false;
      }
      return true;
    });
  }, [sourceTrades, typeFilter, symbolFilter, startDate, endDate]);

  const downloadCSV = () => {
    const headers = [
      'ID',
      'Symbol',
      'Type',
      'Price',
      'Amount',
      'Setup Score',
      'Market Regime',
      'Entry Reason',
      'AI Notes',
      'Stop Loss',
      'Take Profit',
      'Exit Reason',
      'R Multiple',
      'Fee',
      'Time',
      'PnL',
    ];
    const rows = filteredTrades.map(trade => [
      trade.id,
      trade.symbol,
      trade.type,
      trade.price,
      trade.amount,
      trade.setupScore?.toFixed(3) || '',
      trade.marketRegime || '',
      trade.entryReason || '',
      (trade.aiNotes || []).join(' | '),
      trade.stopLoss ? trade.stopLoss.toFixed(2) : '',
      trade.takeProfit ? trade.takeProfit.toFixed(2) : '',
      trade.exitReason || '',
      trade.rMultiple?.toFixed(3) || '',
      trade.fee,
      new Date(trade.timestamp).toISOString(),
      trade.pnl ? trade.pnl.toFixed(4) : '',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'kucoin_bot_trades.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setTypeFilter('ALL');
    setSymbolFilter('ALL');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters = typeFilter !== 'ALL' || symbolFilter !== 'ALL' || startDate !== '' || endDate !== '';

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800 flex flex-col h-full">
      <div className="p-4 border-b border-slate-800 flex justify-between items-center shrink-0">
        <h3 className="text-slate-300 font-semibold flex items-center gap-2">
          Trade History <span className="text-slate-500 text-xs font-normal">({filteredTrades.length})</span>
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
        <div className="p-3 bg-slate-950/50 border-b border-slate-800 grid grid-cols-2 md:grid-cols-4 gap-3 animate-in slide-in-from-top-2 duration-200">
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={event => setTypeFilter(event.target.value)}
              className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Types</option>
              <option value={ActionType.BUY}>Buy</option>
              <option value={ActionType.SELL}>Sell</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Symbol</label>
            <select
              value={symbolFilter}
              onChange={event => setSymbolFilter(event.target.value)}
              className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5 focus:outline-none focus:border-blue-500"
            >
              <option value="ALL">All Symbols</option>
              {uniqueSymbols.map(symbol => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">From</label>
            <input
              type="date"
              value={startDate}
              onChange={event => setStartDate(event.target.value)}
              className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5 focus:outline-none focus:border-blue-500 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">To</label>
            <input
              type="date"
              value={endDate}
              onChange={event => setEndDate(event.target.value)}
              className="w-full bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded p-1.5 focus:outline-none focus:border-blue-500 [color-scheme:dark]"
            />
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="col-span-2 md:col-span-4 text-xs text-red-400 hover:text-red-300 flex items-center justify-center gap-1 mt-1 py-1"
            >
              <X size={12} /> Clear Active Filters
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-2 min-h-0">
        <table className="w-full text-left text-xs text-slate-400">
          <thead className="text-slate-500 font-medium sticky top-0 bg-slate-900 z-10 shadow-sm">
            <tr>
              <th className="pb-2 pl-2 bg-slate-900">Time</th>
              <th className="pb-2 bg-slate-900">Type</th>
              <th className="pb-2 text-right bg-slate-900">Price</th>
              <th className="pb-2 text-right bg-slate-900">Amount</th>
              <th className="pb-2 text-right bg-slate-900">Score</th>
              <th className="pb-2 text-right bg-slate-900">Regime</th>
              <th className="pb-2 text-right bg-slate-900">AI Note</th>
              <th className="pb-2 text-right bg-slate-900 text-red-400/70">SL</th>
              <th className="pb-2 text-right bg-slate-900 text-emerald-400/70">TP</th>
              <th className="pb-2 text-right bg-slate-900">Exit</th>
              <th className="pb-2 text-right bg-slate-900">R</th>
              <th className="pb-2 text-right bg-slate-900">Fee</th>
              <th className="pb-2 text-right pr-2 bg-slate-900">PnL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {filteredTrades.map(trade => (
              <tr key={trade.id} className="hover:bg-slate-800/50 transition">
                <td className="py-2 pl-2 font-mono text-slate-500 whitespace-nowrap">{new Date(trade.timestamp).toLocaleTimeString()}</td>
                <td className="py-2">
                  <span className={`flex items-center gap-1 font-bold ${trade.type === ActionType.BUY ? 'text-emerald-500' : 'text-red-500'}`}>
                    {trade.type === ActionType.BUY ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    {trade.type}
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-slate-200">{trade.price.toFixed(2)}</td>
                <td className="py-2 text-right font-mono">{trade.amount.toFixed(4)}</td>
                <td className="py-2 text-right font-mono text-blue-300">{typeof trade.setupScore === 'number' ? trade.setupScore.toFixed(2) : '-'}</td>
                <td className="py-2 text-right font-mono text-amber-300">{trade.marketRegime || '-'}</td>
                <td className="py-2 text-right font-mono text-slate-500 max-w-[180px] truncate">
                  {trade.aiNotes && trade.aiNotes.length > 0 ? trade.aiNotes[0] : '-'}
                </td>
                <td className="py-2 text-right font-mono text-slate-500">{trade.stopLoss ? trade.stopLoss.toFixed(2) : '-'}</td>
                <td className="py-2 text-right font-mono text-slate-500">{trade.takeProfit ? trade.takeProfit.toFixed(2) : '-'}</td>
                <td className="py-2 text-right font-mono text-slate-500">{trade.exitReason || '-'}</td>
                <td className="py-2 text-right font-mono text-slate-500">{typeof trade.rMultiple === 'number' ? trade.rMultiple.toFixed(2) : '-'}</td>
                <td className="py-2 text-right font-mono text-slate-500">{trade.fee.toFixed(4)}</td>
                <td className="py-2 text-right pr-2 font-mono">
                  {trade.type === ActionType.SELL ? (
                    <span className={trade.pnl && trade.pnl > 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {trade.pnl ? (trade.pnl > 0 ? '+' : '') + trade.pnl.toFixed(2) : '0.00'}
                    </span>
                  ) : (
                    <Minus size={12} className="ml-auto text-slate-600" />
                  )}
                </td>
              </tr>
            ))}
            {filteredTrades.length === 0 && (
              <tr>
                <td colSpan={13} className="text-center py-8 text-slate-600 italic">
                  {sourceTrades.length === 0 ? 'No trades recorded yet. Start the bot.' : 'No trades match the current filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TradeLog;
