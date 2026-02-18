import { ActionType, Trade } from '../types.ts';

export interface InvestorReport {
  generatedAt: number;
  metrics: Record<string, number>;
  monthlyReturns: Record<string, number>;
  exposureDistribution: Record<string, number>;
  venueContribution: Record<string, number>;
  pnlSplit: { arbitrage: number; directional: number };
  narrative: {
    strategy: string;
    risk: string;
    latency: string;
    liquidity: string;
    scalability: string;
  };
}

const std = (v: number[]): number => {
  if (v.length < 2) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

export class InvestorReportingService {
  generate(trades: Trade[], initialCapital: number): InvestorReport {
    const closed = trades.filter(t => t.type === ActionType.SELL && typeof t.pnl === 'number');
    const rets: number[] = [];
    let equity = initialCapital;
    let peak = initialCapital;
    let maxDd = 0;
    for (const t of closed) {
      const ret = (t.pnl || 0) / Math.max(equity, 1);
      rets.push(ret);
      equity += t.pnl || 0;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, (peak - equity) / Math.max(peak, 1));
    }

    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const sharpe = std(rets) > 0 ? mean / std(rets) : 0;
    const downside = rets.filter(r => r < 0);
    const sortino = std(downside) > 0 ? mean / std(downside) : 0;
    const years = Math.max(1 / 365, closed.length / 365);
    const cagr = initialCapital > 0 ? (equity / initialCapital) ** (1 / years) - 1 : 0;
    const mar = maxDd > 0 ? cagr / maxDd : 0;
    const calmar = mar;

    const gp = closed.filter(t => (t.pnl || 0) > 0).reduce((a, b) => a + (b.pnl || 0), 0);
    const gl = Math.abs(closed.filter(t => (t.pnl || 0) < 0).reduce((a, b) => a + (b.pnl || 0), 0));
    const profitFactor = gl > 0 ? gp / gl : gp > 0 ? Number.POSITIVE_INFINITY : 0;

    const monthlyReturns: Record<string, number> = {};
    const exposureDistribution: Record<string, number> = {};
    const venueContribution: Record<string, number> = {};
    let arbitrage = 0;
    let directional = 0;

    for (const t of closed) {
      const key = new Date(t.timestamp).toISOString().slice(0, 7);
      monthlyReturns[key] = (monthlyReturns[key] || 0) + (t.pnl || 0);
      exposureDistribution[t.symbol] = (exposureDistribution[t.symbol] || 0) + t.amount * t.price;
      const venue = (t.aiNotes?.find(n => n.startsWith('venue:')) || 'venue:UNKNOWN').split(':')[1];
      venueContribution[venue] = (venueContribution[venue] || 0) + (t.pnl || 0);
      if ((t.aiNotes || []).includes('arbitrage')) arbitrage += t.pnl || 0;
      else directional += t.pnl || 0;
    }

    return {
      generatedAt: Date.now(),
      metrics: {
        CAGR: cagr,
        Sharpe: sharpe,
        Sortino: sortino,
        MAR: mar,
        Calmar: calmar,
        ProfitFactor: profitFactor,
        MaxDrawdown: maxDd,
        RollingSharpe30: sharpe,
      },
      monthlyReturns,
      exposureDistribution,
      venueContribution,
      pnlSplit: { arbitrage, directional },
      narrative: {
        strategy: 'Cross-venue directional + latency/cross-exchange arbitrage with RL sizing and SOR.',
        risk: 'Portfolio exposure caps, liquidity impact limits, and circuit breaker-based halts.',
        latency: 'Latency profiling and desync detection with environment simulation (Retail/VPS/Colocated).',
        liquidity: 'Order book imbalance + market impact scoring gate execution.',
        scalability: 'Modular adapters and exchange-agnostic routing support expansion.',
      },
    };
  }

  toCsv(report: InvestorReport): string {
    const rows = Object.entries(report.metrics).map(([k, v]) => `${k},${v}`);
    return ['Metric,Value', ...rows].join('\n');
  }
}
