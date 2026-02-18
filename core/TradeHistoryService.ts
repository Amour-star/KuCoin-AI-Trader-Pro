import { ActionType, Trade } from '../types.ts';

export interface TradeHistorySummary {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdownPct: number;
  sharpeProxy: number;
  mar: number;
}

export class TradeHistoryService {
  summarize(trades: Trade[]): TradeHistorySummary {
    const closed = trades.filter(t => t.type === ActionType.SELL && typeof t.pnl === 'number');
    const totalTrades = closed.length;
    const wins = closed.filter(t => (t.pnl || 0) > 0);
    const losses = closed.filter(t => (t.pnl || 0) < 0);
    const gp = wins.reduce((a, b) => a + (b.pnl || 0), 0);
    const glAbs = Math.abs(losses.reduce((a, b) => a + (b.pnl || 0), 0));
    const expectancy = totalTrades > 0 ? closed.reduce((a, b) => a + (b.pnl || 0), 0) / totalTrades : 0;

    let eq = 1;
    let peak = 1;
    let dd = 0;
    const returns: number[] = [];
    for (const t of closed) {
      const r = (t.pnl || 0) / 1000;
      returns.push(r);
      eq += r;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak > 0 ? (peak - eq) / peak : 0);
    }
    const mean = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
    const varc = returns.length > 1 ? returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1) : 0;
    const sharpeProxy = varc > 0 ? mean / Math.sqrt(varc) : 0;
    const cagr = eq - 1;
    const mar = dd > 0 ? cagr / dd : 0;

    return {
      totalTrades,
      winRate: totalTrades > 0 ? wins.length / totalTrades : 0,
      profitFactor: glAbs > 0 ? gp / glAbs : gp > 0 ? Number.POSITIVE_INFINITY : 0,
      expectancy,
      maxDrawdownPct: dd * 100,
      sharpeProxy,
      mar,
    };
  }
}

export const tradeHistoryCoreService = new TradeHistoryService();
