export interface LiquidityImpactEstimate {
  orderSize: number;
  orderBookDepth: number;
  impactPct: number;
  expectedFillDeviation: number;
  liquidityExhaustionRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  blocked: boolean;
}

export class LiquidityImpactModel {
  constructor(private readonly k: number = 0.15, private readonly thresholdPct: number = 0.004) {}

  estimate(orderSize: number, orderBookDepth: number, midPrice: number): LiquidityImpactEstimate {
    const ratio = orderBookDepth > 0 ? orderSize / orderBookDepth : 1;
    const impactPct = this.k * ratio;
    const expectedFillDeviation = midPrice * impactPct;
    const liquidityExhaustionRisk = impactPct > 0.01 ? 'HIGH' : impactPct > 0.004 ? 'MEDIUM' : 'LOW';
    return {
      orderSize,
      orderBookDepth,
      impactPct,
      expectedFillDeviation,
      liquidityExhaustionRisk,
      blocked: impactPct > this.thresholdPct,
    };
  }

  scenarioSimulation(orderBookDepth: number, midPrice: number): LiquidityImpactEstimate[] {
    return [0.1, 0.5, 1].map(f => this.estimate(orderBookDepth * f * 0.1, orderBookDepth, midPrice));
  }
}
