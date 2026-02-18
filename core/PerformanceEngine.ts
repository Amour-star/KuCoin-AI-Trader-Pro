import { ActionType, Trade, TradePerformanceSnapshot } from '../types.ts';

const std = (values: number[]): number => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
};

export class PerformanceEngine {
  private equityCurve: number[] = [];

  snapshot(trades: Trade[], initialEquity: number): TradePerformanceSnapshot {
    const closed = trades.filter(t => t.type === ActionType.SELL && typeof t.pnl === 'number');
    let equity = initialEquity;
    let peak = initialEquity;
    let maxDD = 0;
    const rets: number[] = [];
    const symbolContribution: Record<string, number> = {};

    for (const t of closed) {
      const pnl = t.pnl || 0;
      const prev = equity;
      equity += pnl;
      rets.push(prev !== 0 ? pnl / prev : 0);
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, peak > 0 ? (peak - equity) / peak : 0);
      symbolContribution[t.symbol] = (symbolContribution[t.symbol] || 0) + pnl;
      this.equityCurve.push(equity);
    }

    const rolling = rets.slice(-30);
    const sharpe = std(rolling) > 0 ? (rolling.reduce((a, b) => a + b, 0) / rolling.length) / std(rolling) : 0;
    const downside = rolling.filter(v => v < 0);
    const sortino = std(downside) > 0 ? (rolling.reduce((a, b) => a + b, 0) / rolling.length) / std(downside) : 0;
    const years = Math.max(1 / 365, closed.length / 365);
    const cagr = initialEquity > 0 ? (equity / initialEquity) ** (1 / years) - 1 : 0;
    const mar = maxDD > 0 ? cagr / maxDD : 0;
    const winRate = closed.length > 0 ? closed.filter(t => (t.pnl || 0) > 0).length / closed.length : 0;

    return {
      equity,
      drawdownPct: maxDD * 100,
      sharpe,
      sortino,
      mar,
      winRate,
      symbolContribution,
    };
  }
}
