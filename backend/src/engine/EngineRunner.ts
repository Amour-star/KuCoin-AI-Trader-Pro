import crypto from 'node:crypto';
import { DecisionType } from '@prisma/client';
import { BinanceMarketData } from '../services/BinanceMarketData';
import { TradeStore } from '../services/TradeStore';
import { StrategyCoordinator } from './StrategyCoordinator';
import { ExecutionEngine } from './ExecutionEngine';
import { RiskGuards } from './RiskGuards';

export type EngineMetrics = {
  lastHeartbeatTs: string | null;
  evaluations: number;
  signals: number;
  tradesExecuted: number;
};

export class EngineRunner {
  private timer: NodeJS.Timeout | null = null;
  private priceHistory: number[] = [];

  constructor(
    private symbol: string,
    private getThreshold: () => number,
    private data: BinanceMarketData,
    private strategy: StrategyCoordinator,
    private tradeStore: TradeStore,
    private execution: ExecutionEngine,
    private risk: RiskGuards,
    private metrics: EngineMetrics,
    private isTestSignalMode: () => boolean,
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 60_000);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const price = await this.data.getTickerPrice(this.symbol);
      this.priceHistory.push(price);
      if (this.priceHistory.length > 30) this.priceHistory.shift();
      const ema9 = this.calcEma(9);
      const ema21 = this.calcEma(21);
      const rsi = this.calcRsi(14);

      const decision = this.strategy.decide({
        price,
        ema9,
        ema21,
        rsi,
        threshold: this.getThreshold(),
        testSignalMode: this.isTestSignalMode(),
      });

      const featuresHash = crypto.createHash('sha1').update(`${price}|${ema9}|${ema21}|${rsi}`).digest('hex');
      const record = await this.tradeStore.recordDecision({
        symbol: this.symbol,
        timeframe: '1m',
        decision: decision.decision,
        confidence: decision.confidence,
        reasons: decision.reasons,
        featuresHash,
        modelVersion: 'ema-rsi-v1',
      });

      this.metrics.lastHeartbeatTs = new Date().toISOString();
      this.metrics.evaluations += 1;
      if (decision.decision !== DecisionType.HOLD) this.metrics.signals += 1;

      console.log(`[HEARTBEAT] ${this.metrics.lastHeartbeatTs} ${this.symbol} ${price.toFixed(4)} ${ema9.toFixed(4)} ${ema21.toFixed(4)} ${rsi.toFixed(2)} ${decision.decision} ${decision.confidence.toFixed(3)}`);

      await this.execution.monitorAndClose(this.symbol, price);

      if (decision.decision !== DecisionType.HOLD && await this.risk.canOpen(this.symbol)) {
        const qty = Number((50 / price).toFixed(6));
        await this.execution.openPaperTrade({
          symbol: this.symbol,
          side: decision.decision as DecisionType.BUY | DecisionType.SELL,
          qty,
          entryPrice: price,
          decisionId: record.id,
        });
        this.metrics.tradesExecuted += 1;
      }
    } catch (error) {
      console.error('[ENGINE_ERROR]', error);
    }
  }

  private calcEma(period: number) {
    if (this.priceHistory.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = this.priceHistory[0];
    for (let i = 1; i < this.priceHistory.length; i += 1) {
      ema = this.priceHistory[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calcRsi(period: number) {
    if (this.priceHistory.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    const start = this.priceHistory.length - period;
    for (let i = start; i < this.priceHistory.length; i += 1) {
      const diff = this.priceHistory[i] - this.priceHistory[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }
}
