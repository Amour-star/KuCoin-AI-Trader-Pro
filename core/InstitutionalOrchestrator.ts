import { BinanceAdapter } from '../exchanges/BinanceAdapter.ts';
import { KuCoinAdapter } from '../exchanges/KuCoinAdapter.ts';
import { BybitAdapter } from '../exchanges/BybitAdapter.ts';
import { ArbitrageEngine } from '../arbitrage/ArbitrageEngine.ts';
import { LatencyArbitrageDetector } from '../latency/LatencyArbitrageDetector.ts';
import { ColocationSimulator } from '../colocation/ColocationSimulator.ts';
import { LiquidityImpactModel } from '../liquidity/LiquidityImpactModel.ts';
import { OrderBookImbalanceModel } from '../orderbook/OrderBookImbalanceModel.ts';
import { RLPositionSizingEngine } from '../rl/RLPositionSizingEngine.ts';
import { SmartOrderRouter } from '../routing/SmartOrderRouter.ts';
import { CapitalReadinessService } from '../risk/CapitalReadinessService.ts';

export class InstitutionalOrchestrator {
  readonly adapters = [new BinanceAdapter(), new KuCoinAdapter(), new BybitAdapter()];
  readonly arbitrage = new ArbitrageEngine(this.adapters);
  readonly latencyDetector = new LatencyArbitrageDetector();
  readonly colocation = new ColocationSimulator();
  readonly liquidity = new LiquidityImpactModel();
  readonly imbalance = new OrderBookImbalanceModel();
  readonly rlSizing = new RLPositionSizingEngine();
  readonly router = new SmartOrderRouter(this.adapters, this.liquidity);
  readonly readiness = new CapitalReadinessService();

  async connectAll(): Promise<void> {
    await Promise.all(this.adapters.map(a => a.connect()));
  }
}
