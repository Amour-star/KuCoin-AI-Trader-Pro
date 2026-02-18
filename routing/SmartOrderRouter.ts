import { BaseExchangeAdapter } from '../exchanges/BaseExchangeAdapter.ts';
import { LiquidityImpactModel } from '../liquidity/LiquidityImpactModel.ts';

export interface RoutingDecision {
  venue: string;
  score: number;
  expectedPrice: number;
  projectedSlippagePct: number;
  estimatedLatencyMs: number;
}

export interface VenueScore {
  venue: string;
  realizedSpread: number;
  fillReliability: number;
  qualityScore: number;
}

export class SmartOrderRouter {
  private venueStats = new Map<string, { fills: number; rejects: number; realizedSpread: number }>();

  constructor(private readonly adapters: BaseExchangeAdapter[], private readonly impactModel: LiquidityImpactModel = new LiquidityImpactModel()) {}

  async route(symbol: string, side: 'BUY' | 'SELL', qty: number): Promise<RoutingDecision> {
    const candidates = await Promise.all(this.adapters.map(async adapter => {
      const quote = await adapter.getBestBidAsk(symbol);
      const fees = await adapter.getFees(symbol);
      const latency = await adapter.getLatency();
      const ob = await adapter.getOrderBook(symbol, 20);
      const depth = ob.bids.concat(ob.asks).slice(0, 20).reduce((acc, [, q]) => acc + q, 0);
      const mid = (quote.bid + quote.ask) / 2;
      const impact = this.impactModel.estimate(qty, depth, mid);
      const px = side === 'BUY' ? quote.ask : quote.bid;
      const effective = px * (1 + fees.taker + impact.impactPct + latency / 1_000_000);
      return { venue: adapter.name, score: -effective, expectedPrice: px, projectedSlippagePct: impact.impactPct, estimatedLatencyMs: latency };
    }));

    return candidates.sort((a, b) => b.score - a.score)[0];
  }

  recordExecution(venue: string, realizedSpread: number, filled: boolean): void {
    const prev = this.venueStats.get(venue) || { fills: 0, rejects: 0, realizedSpread: 0 };
    if (filled) prev.fills += 1;
    else prev.rejects += 1;
    prev.realizedSpread += realizedSpread;
    this.venueStats.set(venue, prev);
  }

  getVenueRanking(): VenueScore[] {
    return [...this.venueStats.entries()].map(([venue, s]) => {
      const total = s.fills + s.rejects;
      const fillReliability = total > 0 ? s.fills / total : 0;
      const avgSpread = s.fills > 0 ? s.realizedSpread / s.fills : 0;
      return { venue, realizedSpread: avgSpread, fillReliability, qualityScore: fillReliability * 0.7 + Math.max(0, avgSpread) * 0.3 };
    }).sort((a, b) => b.qualityScore - a.qualityScore);
  }
}
