export type ColocationMode = 'RETAIL' | 'VPS' | 'COLOCATED';

export interface ColocationRunResult {
  mode: ColocationMode;
  injectedMarketDataDelayMs: number;
  injectedOrderDelayMs: number;
  fillQualityDeltaBps: number;
  arbitrageCaptureRate: number;
  slippageDeltaBps: number;
}

const ranges: Record<ColocationMode, [number, number]> = {
  RETAIL: [200, 500],
  VPS: [50, 100],
  COLOCATED: [1, 5],
};

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export class ColocationSimulator {
  async injectDelay(mode: ColocationMode): Promise<{ marketDataDelayMs: number; orderDelayMs: number }> {
    const [lo, hi] = ranges[mode];
    const marketDataDelayMs = rand(lo, hi);
    const orderDelayMs = rand(lo, hi);
    await new Promise(resolve => setTimeout(resolve, Math.round(orderDelayMs)));
    return { marketDataDelayMs, orderDelayMs };
  }

  runComparison(): ColocationRunResult[] {
    return (Object.keys(ranges) as ColocationMode[]).map(mode => {
      const [lo, hi] = ranges[mode];
      const latency = (lo + hi) / 2;
      return {
        mode,
        injectedMarketDataDelayMs: latency,
        injectedOrderDelayMs: latency,
        fillQualityDeltaBps: Math.max(0, (latency / 10) * 0.8),
        arbitrageCaptureRate: Math.max(0.05, 1 - latency / 600),
        slippageDeltaBps: Math.max(0.1, latency / 15),
      };
    });
  }
}
