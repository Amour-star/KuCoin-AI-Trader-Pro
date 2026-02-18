import { ActionType, BotState, Candle, Position, Trade } from '../types.ts';
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

interface StrategyCounters {
  totalEvaluations: number;
  totalSignals: number;
  totalTradesExecuted: number;
}

const ONE_MINUTE_MS = 60_000;
const SIGNAL_CONFIDENCE_THRESHOLD = Number((typeof process !== 'undefined' ? process.env.BOT_CONFIDENCE_THRESHOLD : undefined) || '0.6');
const DEBUG_MODE = (((typeof process !== 'undefined' ? process.env.DEBUG_MODE : undefined) || '').toLowerCase() === 'true');

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
  private readonly counters: StrategyCounters = {
    totalEvaluations: 0,
    totalSignals: 0,
    totalTradesExecuted: 0,
  };
  private readonly lastDecisionTsBySymbol = new Map<string, number>();
  private stream: MarketStreamService;
  private schedulerId: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly cfg: MultiSymbolConfig, private readonly getPortfolio: () => BotState, private readonly onState: (trade: Trade) => void) {
    this.stream = new MarketStreamService({ symbols: cfg.symbols.slice(0, cfg.maxConcurrentSymbols), interval: cfg.interval, maxBuffer: cfg.maxBuffer }, async (symbol, candle) => {
      await this.onCandleClose(symbol, candle);
    });
    for (const symbol of cfg.symbols.slice(0, cfg.maxConcurrentSymbols)) {
      this.symbolStates.set(symbol, { positions: [], trades: [] });
    }
  }

  async start(): Promise<void> {
    await this.stream.bootstrap();
    this.startEvaluationScheduler();
  }

  stop(): void {
    this.stream.shutdown();
    if (this.schedulerId) clearInterval(this.schedulerId);
    this.schedulerId = null;
  }

  private startEvaluationScheduler(): void {
    if (this.schedulerId) clearInterval(this.schedulerId);
    this.schedulerId = setInterval(() => {
      for (const symbol of this.cfg.symbols.slice(0, this.cfg.maxConcurrentSymbols)) {
        void this.evaluateSymbol(symbol, 'SCHEDULED_1M');
      }
    }, ONE_MINUTE_MS);
  }

  private async onCandleClose(symbol: string, candle: Candle): Promise<void> {
    await this.evaluateSymbol(symbol, 'CANDLE_CLOSE', candle);
  }

  private async evaluateSymbol(symbol: string, trigger: 'CANDLE_CLOSE' | 'SCHEDULED_1M', incomingCandle?: Candle): Promise<void> {
    const portfolio = this.getPortfolio();
    const symbolState = this.symbolStates.get(symbol);
    if (!symbolState) return;

    const buffer = this.stream.getBuffer(symbol);
    const latestRaw = incomingCandle || buffer[buffer.length - 1];
    if (!latestRaw) {
      console.warn(`[HEARTBEAT] ${symbol} | ${trigger} | no candle available.`);
      return;
    }

    const updated = this.indicatorEngine.update(symbol, { ...latestRaw });
    coreEventBus.emit('indicator:update', { symbol, timestamp: updated.timestamp });

    const decision = this.refinementEngine.decide(buffer.length > 0 ? buffer : [updated]);

    this.counters.totalEvaluations += 1;
    if (decision.action !== ActionType.HOLD) this.counters.totalSignals += 1;
    coreEventBus.emit('strategy:stats', { ...this.counters });

    const timestamp = new Date(decision.timestamp).toISOString();
    console.info(
      `[HEARTBEAT] Strategy evaluated at ${timestamp} | ${symbol} | trigger=${trigger} | Price: ${updated.close.toFixed(4)} | EMA9: ${(updated.emaShort || updated.close).toFixed(4)} | EMA21: ${(updated.emaLong || updated.close).toFixed(4)} | RSI: ${(updated.rsi || 50).toFixed(2)} | Decision: ${decision.action}`,
    );

    if (DEBUG_MODE) {
      console.debug('[DEBUG_FEATURE_VECTOR]', JSON.stringify({
        symbol,
        timestamp: decision.timestamp,
        close: updated.close,
        high: updated.high,
        low: updated.low,
        volume: updated.volume,
        ema9: updated.emaShort,
        ema21: updated.emaLong,
        rsi: updated.rsi,
        atr: updated.atr,
        volumeRatio: updated.volumeRatio,
        reasons: decision.reasons,
      }));
    }

    coreEventBus.emit('signal:update', { symbol, action: decision.action, confidence: decision.confidence, modelVersion: decision.modelVersion });
    console.info(`[DECISION] ${symbol} | ${decision.action} | conf: ${decision.confidence.toFixed(2)} | reason: ${decision.reasons.join('; ')}`);

    let finalAction = decision.action;
    if (finalAction !== ActionType.HOLD && decision.confidence < SIGNAL_CONFIDENCE_THRESHOLD) {
      console.info(`[BLOCKED] Signal below confidence threshold. ${decision.confidence.toFixed(3)} < ${SIGNAL_CONFIDENCE_THRESHOLD.toFixed(3)}`);
      finalAction = ActionType.HOLD;
    }

    if (finalAction === ActionType.HOLD) return;

    const lastDecisionTs = this.lastDecisionTsBySymbol.get(symbol);
    if (lastDecisionTs && lastDecisionTs === updated.timestamp) {
      console.info(`[SKIP] Duplicate candle decision prevented for ${symbol} at ${updated.timestamp}.`);
      return;
    }

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
    if (cb.halted) {
      console.warn(`[SKIP] Circuit breaker halted execution for ${symbol}.`);
      return;
    }

    if (finalAction === ActionType.BUY) {
      if (symbolState.positions.length > 0) {
        console.info(`[SKIP] Position already open for ${symbol}.`);
        return;
      }

      const gate = this.risk.evaluate({
        symbol,
        side: ActionType.BUY,
        qty: 0.001,
        price: updated.close,
        equity: portfolio.totalPortfolioValue,
        positions: portfolio.activePositions,
        trades: portfolio.trades,
      });
      if (!gate.allowed) {
        console.info(`[ORDER REJECTED] ${symbol} BUY blocked by risk gate.`);
        return;
      }

      const qty = Math.max(0.0001, Math.min(0.02, (portfolio.balance / updated.close) * 0.08));
      console.info(`[ORDER ATTEMPT] ${symbol} BUY qty=${qty.toFixed(8)} px=${updated.close.toFixed(6)} mode=PAPER`);
      try {
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
        this.lastDecisionTsBySymbol.set(symbol, updated.timestamp);
        this.counters.totalTradesExecuted += 1;
        coreEventBus.emit('strategy:stats', { ...this.counters });
        coreEventBus.emit('order:execute', { symbol, side: 'BUY', qty, expectedPrice: updated.close, executedPrice: exec.trade.price });
        console.info(`[ORDER FILLED] ${symbol} BUY qty=${qty.toFixed(8)} avg=${exec.trade.price.toFixed(6)} slippage=${(exec.trade.slippage || 0).toFixed(6)}`);
        this.onState(exec.trade);
      } catch (error) {
        console.error('[ORDER REJECTED]', error);
      }
      return;
    }

    if (finalAction === ActionType.SELL) {
      if (symbolState.positions.length <= 0) {
        console.info(`[SKIP] No open position to close for ${symbol}.`);
        return;
      }

      const pos = symbolState.positions.shift()!;
      const qty = pos.amount;
      console.info(`[ORDER ATTEMPT] ${symbol} SELL qty=${qty.toFixed(8)} px=${updated.close.toFixed(6)} mode=PAPER`);
      try {
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
        this.lastDecisionTsBySymbol.set(symbol, updated.timestamp);
        this.counters.totalTradesExecuted += 1;
        coreEventBus.emit('strategy:stats', { ...this.counters });
        coreEventBus.emit('order:execute', { symbol, side: 'SELL', qty, expectedPrice: updated.close, executedPrice: exec.trade.price });
        console.info(`[ORDER FILLED] ${symbol} SELL qty=${qty.toFixed(8)} avg=${exec.trade.price.toFixed(6)} pnl=${(exec.trade.pnl || 0).toFixed(6)}`);
        this.onState(exec.trade);
      } catch (error) {
        console.error('[ORDER REJECTED]', error);
      }
    }
  }
}
