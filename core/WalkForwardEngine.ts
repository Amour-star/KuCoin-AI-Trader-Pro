import { ActionType, Trade } from '../types.ts';

export interface WalkForwardWindowResult {
  modelVersion: string;
  trainingStart: number;
  trainingEnd: number;
  testMetrics: {
    sharpe: number;
    profitFactor: number;
    drawdownPct: number;
  };
  accepted: boolean;
}

const dayMs = 24 * 60 * 60 * 1000;

export class WalkForwardEngine {
  run(trades: Trade[], nowTs: number = Date.now(), trainDays: number = 60, testDays: number = 14): WalkForwardWindowResult[] {
    const out: WalkForwardWindowResult[] = [];
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
    let cursor = nowTs - 180 * dayMs;

    while (cursor + (trainDays + testDays) * dayMs <= nowTs) {
      const trainStart = cursor;
      const trainEnd = cursor + trainDays * dayMs;
      const testEnd = trainEnd + testDays * dayMs;
      const testTrades = sorted.filter(t => t.type === ActionType.SELL && t.timestamp >= trainEnd && t.timestamp < testEnd);

      const rets = testTrades.map(t => t.pnl || 0);
      const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
      const variance = rets.length > 1 ? rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1) : 0;
      const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 0;
      const gp = testTrades.filter(t => (t.pnl || 0) > 0).reduce((a, b) => a + (b.pnl || 0), 0);
      const gl = Math.abs(testTrades.filter(t => (t.pnl || 0) < 0).reduce((a, b) => a + (b.pnl || 0), 0));
      const profitFactor = gl > 0 ? gp / gl : gp > 0 ? Number.POSITIVE_INFINITY : 0;

      let eq = 1;
      let peak = 1;
      let dd = 0;
      for (const t of testTrades) {
        eq += (t.pnl || 0) / 1000;
        peak = Math.max(peak, eq);
        dd = Math.max(dd, peak > 0 ? (peak - eq) / peak : 0);
      }

      const accepted = sharpe > 0.2 && profitFactor > 1 && dd < 0.2;
      out.push({
        modelVersion: testTrades[testTrades.length - 1]?.modelVersion || 'n/a',
        trainingStart: trainStart,
        trainingEnd: trainEnd,
        testMetrics: { sharpe, profitFactor, drawdownPct: dd * 100 },
        accepted,
      });

      cursor += testDays * dayMs;
    }

    return out;
  }
}
