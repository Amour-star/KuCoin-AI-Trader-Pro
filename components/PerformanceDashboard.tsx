import React, { useMemo } from 'react';
import { Trade, TradePerformanceSnapshot } from '../types';
import { PerformanceEngine } from '../core/PerformanceEngine';

interface Props {
  trades: Trade[];
  initialEquity: number;
  exposureBySymbol: Record<string, number>;
}

const metric = (label: string, value: string) => (
  <div className="bg-slate-900 border border-slate-800 rounded p-3">
    <div className="text-slate-500 text-xs uppercase">{label}</div>
    <div className="text-slate-200 font-semibold">{value}</div>
  </div>
);

const PerformanceDashboard: React.FC<Props> = ({ trades, initialEquity, exposureBySymbol }) => {
  const snapshot: TradePerformanceSnapshot = useMemo(() => new PerformanceEngine().snapshot(trades, initialEquity), [trades, initialEquity]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {metric('Equity', snapshot.equity.toFixed(2))}
        {metric('Rolling Sharpe', snapshot.sharpe.toFixed(3))}
        {metric('Rolling Sortino', snapshot.sortino.toFixed(3))}
        {metric('MAR', snapshot.mar.toFixed(3))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {metric('Drawdown', `${snapshot.drawdownPct.toFixed(2)}%`)}
        {metric('Win Rate Trend', `${(snapshot.winRate * 100).toFixed(2)}%`)}
        {metric('Symbols PnL', Object.keys(snapshot.symbolContribution).length.toString())}
        {metric('Exposure Heatmap', Object.entries(exposureBySymbol).map(([s, e]) => `${s}:${e.toFixed(0)}`).join(' | ') || 'n/a')}
      </div>
    </div>
  );
};

export default PerformanceDashboard;
