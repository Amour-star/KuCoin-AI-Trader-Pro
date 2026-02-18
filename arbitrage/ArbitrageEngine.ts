import { BaseExchangeAdapter } from '../exchanges/BaseExchangeAdapter.ts';

export interface ArbitrageOpportunity {
  arbitrageId: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  estimatedNetPct: number;
  latencyBufferMs: number;
  detectedAt: number;
}

export interface ArbitrageExecution {
  opportunity: ArbitrageOpportunity;
  buyLegStatus: string;
  sellLegStatus: string;
  hedgeExecuted: boolean;
  latencyMs: number;
  executionSlippagePct: number;
}

export class ArbitrageEngine {
  private capitalByExchange = new Map<string, number>();

  constructor(private readonly adapters: BaseExchangeAdapter[], initialCapitalPerExchange: number = 10_000) {
    for (const adapter of adapters) this.capitalByExchange.set(adapter.name, initialCapitalPerExchange);
  }

  getCapitalFragmentation(): Record<string, number> {
    return Object.fromEntries(this.capitalByExchange.entries());
  }

  async detect(symbol: string): Promise<ArbitrageOpportunity | null> {
    const quotes = await Promise.all(this.adapters.map(async adapter => ({
      adapter,
      quote: await adapter.getBestBidAsk(symbol),
      fees: await adapter.getFees(symbol),
      latency: await adapter.getLatency(),
    })));

    let bestBuy = quotes[0];
    let bestSell = quotes[0];
    for (const q of quotes) {
      if (q.quote.ask < bestBuy.quote.ask) bestBuy = q;
      if (q.quote.bid > bestSell.quote.bid) bestSell = q;
    }
    if (bestBuy.adapter.name === bestSell.adapter.name) return null;

    const grossPct = (bestSell.quote.bid - bestBuy.quote.ask) / Math.max(bestBuy.quote.ask, 1);
    const feePct = bestBuy.fees.taker + bestSell.fees.taker;
    const slippagePct = 0.00025;
    const latencyBufferPct = Math.max(bestBuy.latency, bestSell.latency) / 1_000_000;
    const netPct = grossPct - feePct - slippagePct - latencyBufferPct;

    if (netPct <= 0) return null;

    return {
      arbitrageId: `arb-${Date.now()}-${bestBuy.adapter.name}-${bestSell.adapter.name}`,
      symbol,
      buyExchange: bestBuy.adapter.name,
      sellExchange: bestSell.adapter.name,
      buyPrice: bestBuy.quote.ask,
      sellPrice: bestSell.quote.bid,
      spreadPct: grossPct,
      estimatedNetPct: netPct,
      latencyBufferMs: Math.max(bestBuy.latency, bestSell.latency),
      detectedAt: Date.now(),
    };
  }

  async execute(opportunity: ArbitrageOpportunity, qty: number): Promise<ArbitrageExecution> {
    const buyAdapter = this.adapters.find(a => a.name === opportunity.buyExchange);
    const sellAdapter = this.adapters.find(a => a.name === opportunity.sellExchange);
    if (!buyAdapter || !sellAdapter) throw new Error('Adapters not found for opportunity');

    const t0 = performance.now();
    const [buyLeg, sellLeg] = await Promise.allSettled([
      buyAdapter.placeOrder(opportunity.symbol, 'BUY', qty, opportunity.buyPrice),
      sellAdapter.placeOrder(opportunity.symbol, 'SELL', qty, opportunity.sellPrice),
    ]);

    let hedgeExecuted = false;
    if (buyLeg.status === 'fulfilled' && sellLeg.status === 'rejected') {
      await buyAdapter.placeOrder(opportunity.symbol, 'SELL', qty);
      hedgeExecuted = true;
    }
    if (sellLeg.status === 'fulfilled' && buyLeg.status === 'rejected') {
      await sellAdapter.placeOrder(opportunity.symbol, 'BUY', qty);
      hedgeExecuted = true;
    }

    const latencyMs = performance.now() - t0;
    const executionSlippagePct = Math.abs((opportunity.sellPrice - opportunity.buyPrice) / Math.max(opportunity.buyPrice, 1) - opportunity.spreadPct);

    return {
      opportunity,
      buyLegStatus: buyLeg.status === 'fulfilled' ? buyLeg.value.status : 'FAILED',
      sellLegStatus: sellLeg.status === 'fulfilled' ? sellLeg.value.status : 'FAILED',
      hedgeExecuted,
      latencyMs,
      executionSlippagePct,
    };
  }
}
