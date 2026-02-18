import { ActionType, BotState, Position, Trade } from '../types.ts';
import { MarketStreamService } from './MarketStreamService.ts';
import { IndicatorEngine } from './IndicatorEngine.ts';
import { RefinementEngine } from './RefinementEngine.ts';
import { ExecutionEngine } from './ExecutionEngine.ts';
import { PortfolioRiskManager } from './PortfolioRiskManager.ts';
import { CircuitBreaker } from './CircuitBreaker.ts';
import { coreEventBus } from './EventBus.ts';

interface MultiSymbolConfig {
  symbols: string[];
  interval: string;
  maxConcurrentSymbols: number;
  maxBuffer: number;
}

interface SymbolState {
  positions: Position[];
  trades: Trade[];
}

export class MultiSymbolEngine {
  private readonly indicatorEngine = new IndicatorEngine();
  private readonly refinementEngine = new RefinementEngine();
  private readonly executionEngine = new ExecutionEngine('PAPER');
  private readonly risk = new PortfolioRiskManager({
    maxExposurePerSymbolPct: 0.35,
    maxPortfolioExposurePct: 0.8,
    maxDailyLossPct: 0.04,
    maxOpenTrades: 8,
  });
  private readonly breaker = new CircuitBreaker();
  private readonly symbolStates = new Map<string, SymbolState>();
  private stream: MarketStreamService;

  constructor(private readonly cfg: MultiSymbolConfig, private readonly getPortfolio: () => BotState, private readonly onState: (trade: Trade) => void) {
    this.stream = new MarketStreamService({ symbols: cfg.symbols.slice(0, cfg.maxConcurrentSymbols), interval: cfg.interval, maxBuffer: cfg.maxBuffer }, async (symbol, candle) => {
      await this.onCandle(symbol, candle);
    });
    for (const symbol of cfg.symbols.slice(0, cfg.maxConcurrentSymbols)) {
      this.symbolStates.set(symbol, { positions: [], trades: [] });
    }
  }

  async start(): Promise<void> {
    await this.stream.bootstrap();
  }

  stop(): void {
    this.stream.shutdown();
  }

  private async onCandle(symbol: string, candle: any): Promise<void> {
    const portfolio = this.getPortfolio();
    const symbolState = this.symbolStates.get(symbol);
    if (!symbolState) return;

    const updated = this.indicatorEngine.update(symbol, candle);
    coreEventBus.emit('indicator:update', { symbol, timestamp: updated.timestamp });

    const decision = this.refinementEngine.decide(this.stream.getBuffer(symbol));
    coreEventBus.emit('signal:update', { symbol, action: decision.action, confidence: decision.confidence, modelVersion: decision.modelVersion });

    const recent = symbolState.trades.filter(t => t.type === ActionType.SELL).slice(-3);
    const largeLosses = recent.filter(t => (t.pnl || 0) < -20).length;
    const cb = this.breaker.evaluate({
      dailyDrawdownPct: Math.max(0, ((portfolio.totalPortfolioValue - portfolio.balance) / Math.max(portfolio.totalPortfolioValue, 1)) * 100),
      consecutiveLargeLosses: largeLosses,
      volatilityPct: ((updated.atr || 0) / Math.max(updated.close, 1)) * 100,
      wsUnstable: this.stream.isUnstable(symbol),
    }, {
      maxDailyDrawdownPct: 5,
      maxConsecutiveLargeLosses: 3,
      volatilitySpikePct: 6,
    });
    if (cb.halted) return;

    if (decision.action === ActionType.BUY) {
      const gate = this.risk.evaluate({
        symbol,
        side: decision.action,
        qty: 0.001,
        price: updated.close,
        equity: portfolio.totalPortfolioValue,
        positions: portfolio.activePositions,
        trades: portfolio.trades,
      });
      if (!gate.allowed) return;

      const qty = Math.max(0.0001, Math.min(0.02, portfolio.balance / updated.close * 0.08));
      const exec = this.executionEngine.execute({
        symbol,
        side: ActionType.BUY,
        qty,
        expectedPrice: updated.close,
        candleHigh: updated.high,
        candleLow: updated.low,
        confidence: decision.confidence,
        modelVersion: decision.modelVersion,
      });
      symbolState.positions.push({ id: exec.trade.id, symbol, entryPrice: exec.trade.price, amount: qty, timestamp: exec.trade.timestamp, strategyVersion: decision.modelVersion });
      symbolState.trades.push(exec.trade);
      coreEventBus.emit('order:execute', { symbol, side: 'BUY', qty, expectedPrice: updated.close, executedPrice: exec.trade.price });
      this.onState(exec.trade);
      return;
    }

    if (decision.action === ActionType.SELL && symbolState.positions.length > 0) {
      const pos = symbolState.positions.shift()!;
      const qty = pos.amount;
      const exec = this.executionEngine.execute({
        symbol,
        side: ActionType.SELL,
        qty,
        expectedPrice: updated.close,
        candleHigh: updated.high,
        candleLow: updated.low,
        confidence: decision.confidence,
        modelVersion: decision.modelVersion,
        entryTimestamp: pos.timestamp,
      });
      const totalFees = (pos.entryFeePerUnit || pos.entryPrice * 0.001) * qty + exec.trade.fee;
      exec.trade.pnl = ExecutionEngine.calcRealizedPnl(pos.entryPrice, exec.trade.price, qty, ActionType.BUY, totalFees);
      symbolState.trades.push(exec.trade);
      this.refinementEngine.registerClosedTrade(exec.trade);
      coreEventBus.emit('order:execute', { symbol, side: 'SELL', qty, expectedPrice: updated.close, executedPrice: exec.trade.price });
      this.onState(exec.trade);
    }
  }
}
