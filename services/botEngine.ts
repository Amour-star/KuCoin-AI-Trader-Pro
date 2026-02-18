import { TRADING_FEE_RATE } from '../constants';
import {
  ActionType,
  BotState,
  Candle,
  IndicatorSnapshot,
  MarketRegime,
  MarketStatus,
  PendingTrade,
  Position,
  RefinementStatus,
  SetupScoreBreakdown,
  Trade,
  TradeExitReason,
} from '../types';
import { runStrategyRefinementCycle } from './ai/strategyRefiner';
import { simulateEntryExecution, simulateExitExecution } from './engine/executionSimulator';
import { evaluateRisk } from './engine/riskManager';
import { getStrategySummary, loadStrategyState } from './engine/strategyState';
import { appendTrade } from './storage/tradeStorage';
import { getRuntimeConfig, validateRuntimeConfig } from './engine/runtimeConfig';
import { tradeHistoryService } from './storage/tradeHistoryService';

const REFINEMENT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SCHEDULER_CHECK_MS = 60 * 1000;
const MAX_TRAINING_LOG = 500;
const INACTIVITY_RELAX_START_MS = 2 * 60 * 60 * 1000;
const INACTIVITY_RELAX_WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_MIN_SCORE_RELAX = 0.08;

let tradeSequence = 0;
let schedulerId: number | null = null;
let refinementInFlight = false;

interface EngineSignal {
  action: ActionType;
  confidence: number;
  setupScore: number;
  breakdown: SetupScoreBreakdown;
  marketRegime: MarketRegime;
  indicators: IndicatorSnapshot;
  entryReason: string;
  notes: string[];
  atr: number;
}

interface ConsumePositionsResult {
  positions: Position[];
  consumedAmount: number;
  weightedEntryPrice: number;
  weightedRiskPerUnit: number;
  weightedEntryFeePerUnit: number;
  metadata: {
    setupScore?: number;
    marketRegime?: MarketRegime;
    entryReason?: string;
    indicatorsSnapshot?: IndicatorSnapshot;
    aiNotes?: string[];
    strategyVersion?: string;
    stopLoss?: number;
    takeProfit?: number;
  };
}

export interface BotEngineCycleInput {
  state: BotState;
  symbol: string;
  candles: Candle[];
  currentPrice: number;
  confidenceThreshold: number;
}

export interface BotEngineCycleResult {
  state: BotState;
  pendingTrade: PendingTrade | null;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const round = (value: number, decimals: number = 8): number => Number(value.toFixed(decimals));

const hashInput = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash >>> 0).toString(16);
};

const isFinitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const normalizeSymbol = (symbol: string): string => {
  if (symbol.includes('-')) return symbol.toUpperCase();
  const normalized = symbol.toUpperCase();
  if (normalized.endsWith('USDT')) return `${normalized.slice(0, -4)}-USDC`;
  if (normalized.endsWith('USDC')) return `${normalized.slice(0, -4)}-USDC`;
  return normalized;
};

const generateTradeId = (symbol: string, type: ActionType, timestamp: number): string => {
  tradeSequence += 1;
  return `${symbol}-${type}-${timestamp}-${tradeSequence}`;
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((acc, value) => acc + value, 0) / values.length;

const getLatestTradeTimestamp = (trades: Trade[]): number | null => {
  if (trades.length === 0) return null;
  return trades.reduce((latest, trade) => Math.max(latest, trade.timestamp), 0);
};

const calculateAtr = (candles: Candle[], period: number = 14): number => {
  if (candles.length < 2) return 0;
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trueRanges.push(tr);
  }
  return average(trueRanges.slice(-period));
};

const detectMarketRegime = (candle: Candle, atrPct: number, minAtrPct: number, maxAtrPct: number): MarketRegime => {
  const emaShort = candle.emaShort || candle.close;
  const emaLong = candle.emaLong || candle.close;
  const trendGap = (emaShort - emaLong) / Math.max(candle.close, 1);

  if (atrPct < minAtrPct) return 'CHOP';
  if (atrPct > maxAtrPct * 1.2) return 'HIGH_VOLATILITY';

  if (trendGap > 0.0015 && candle.close >= emaShort) return 'TRENDING_UP';
  if (trendGap < -0.0015 && candle.close <= emaShort) return 'TRENDING_DOWN';
  return 'RANGING';
};

const toMarketStatus = (regime: MarketRegime): MarketStatus => {
  if (regime === 'CHOP') return 'LOW_VOLATILITY';
  return 'ACTIVE';
};

const scoreSetup = (
  candles: Candle[],
  current: Candle,
  regime: MarketRegime,
  threshold: number,
): { score: number; breakdown: SetupScoreBreakdown; entryReason: string } => {
  const previous = candles[candles.length - 2] || current;
  const emaShort = current.emaShort || current.close;
  const emaLong = current.emaLong || current.close;
  const avgVolume = average(candles.slice(-20).map(candle => candle.volume));
  const volumeRatio = avgVolume > 0 ? current.volume / avgVolume : 1;
  const momentum = previous.close > 0 ? (current.close - previous.close) / previous.close : 0;
  const rsi = current.rsi ?? 50;
  const rsiPrev = previous.rsi ?? rsi;

  const pullbackDistancePct = Math.abs(current.close - emaShort) / Math.max(current.close, 1);
  const pullbackToEma = clamp(1 - pullbackDistancePct / 0.0035, 0, 1);
  const rsiRecovery = clamp(((rsi - 45) / 20) + (rsi > rsiPrev ? 0.2 : 0), 0, 1);
  const momentumConfirmation = clamp((momentum / 0.004) + (current.close > previous.close ? 0.3 : 0), 0, 1);
  const volumeConfirmation = clamp((volumeRatio - 0.9) / 0.4, 0, 1);
  const trendAlignment = regime === 'TRENDING_UP' ? 1 : regime === 'RANGING' ? 0.45 : 0;

  const score = clamp(
    pullbackToEma * 0.22 +
      rsiRecovery * 0.20 +
      momentumConfirmation * 0.20 +
      volumeConfirmation * 0.16 +
      trendAlignment * 0.22,
    0,
    1,
  );

  const entryReason = `Confluence ${score.toFixed(2)} | pullback ${pullbackToEma.toFixed(2)} | rsi ${rsiRecovery.toFixed(2)} | momentum ${momentumConfirmation.toFixed(2)} | volume ${volumeConfirmation.toFixed(2)} | trend ${trendAlignment.toFixed(2)}`;

  return {
    score,
    breakdown: {
      pullbackToEma,
      rsiRecovery,
      momentumConfirmation,
      volumeConfirmation,
      trendAlignment,
      total: score,
      threshold,
    },
    entryReason,
  };
};

const deriveSignal = (state: BotState, candles: Candle[]): EngineSignal => {
  const strategy = loadStrategyState();
  if (candles.length < 50) {
    const fallback: IndicatorSnapshot = {
      emaShort: candles[candles.length - 1]?.close || 0,
      emaLong: candles[candles.length - 1]?.close || 0,
      rsi: candles[candles.length - 1]?.rsi ?? 50,
      atr: 0,
      momentum: 0,
      volumeRatio: 1,
    };
    return {
      action: ActionType.HOLD,
      confidence: 0.2,
      setupScore: 0,
      breakdown: {
        pullbackToEma: 0,
        rsiRecovery: 0,
        momentumConfirmation: 0,
        volumeConfirmation: 0,
        trendAlignment: 0,
        total: 0,
        threshold: strategy.parameters.minScore,
      },
      marketRegime: 'CHOP',
      indicators: fallback,
      entryReason: 'Insufficient candles for setup scoring (min 50 required).',
      notes: ['Waiting for enough history before evaluating entries.'],
      atr: 0,
    };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const latestTradeTimestamp = getLatestTradeTimestamp(state.trades);
  const inactivityMs = latestTradeTimestamp ? Date.now() - latestTradeTimestamp : Number.POSITIVE_INFINITY;
  const inactivityRelaxRatio =
    inactivityMs > INACTIVITY_RELAX_START_MS
      ? clamp((inactivityMs - INACTIVITY_RELAX_START_MS) / INACTIVITY_RELAX_WINDOW_MS, 0, 1)
      : 0;
  const scoreRelaxation = MAX_MIN_SCORE_RELAX * inactivityRelaxRatio;
  const effectiveMinScore = clamp(strategy.parameters.minScore - scoreRelaxation, 0.56, 0.95);

  const atr = calculateAtr(candles, 14);
  const atrPct = atr / Math.max(current.close, 1);
  const regime = detectMarketRegime(current, atrPct, strategy.parameters.minAtrPct, strategy.parameters.maxAtrPct);
  const { score, breakdown, entryReason } = scoreSetup(candles, current, regime, effectiveMinScore);
  const avgVolume = average(candles.slice(-20).map(candle => candle.volume));
  const volumeRatio = avgVolume > 0 ? current.volume / avgVolume : 1;
  const momentum = previous.close > 0 ? (current.close - previous.close) / previous.close : 0;

  const indicators: IndicatorSnapshot = {
    emaShort: current.emaShort || current.close,
    emaLong: current.emaLong || current.close,
    rsi: current.rsi ?? 50,
    atr,
    momentum,
    volumeRatio,
  };

  let action = ActionType.HOLD;
  const rangingEntryBuffer = inactivityMs >= 6 * 60 * 60 * 1000 ? 0.01 : 0.04;
  const rangingEntryAllowed =
    regime === 'RANGING' &&
    score >= effectiveMinScore + rangingEntryBuffer &&
    breakdown.rsiRecovery >= 0.55 &&
    breakdown.momentumConfirmation >= 0.5 &&
    volumeRatio >= 0.9;

  if (regime === 'TRENDING_UP' && score >= effectiveMinScore) {
    action = ActionType.BUY;
  } else if (rangingEntryAllowed) {
    action = ActionType.BUY;
  } else if ((regime === 'TRENDING_DOWN' || regime === 'HIGH_VOLATILITY') && (state.holdings[state.activeSymbol] || 0) > 0) {
    action = ActionType.SELL;
  }

  const confidenceBase = 0.35 + score * 0.55;
  const confidencePenalty = regime === 'CHOP' ? 0.2 : regime === 'HIGH_VOLATILITY' ? 0.12 : regime === 'RANGING' ? 0.05 : 0;
  let confidence = clamp(confidenceBase - confidencePenalty, 0.1, 0.95);
  if (action === ActionType.BUY) {
    confidence = clamp(Math.max(confidence, 0.62), 0.1, 0.95);
  }

  const notes: string[] = [];
  if (scoreRelaxation > 0.0001) {
    notes.push(`Inactivity adaptation active: min score relaxed by ${scoreRelaxation.toFixed(3)}.`);
  }
  if (regime === 'CHOP') notes.push('Chop regime detected; skipping low-volatility setups.');
  if (regime === 'HIGH_VOLATILITY') notes.push('High volatility regime; risk tightened.');
  if (regime === 'RANGING' && action === ActionType.BUY) {
    notes.push('Ranging high-confluence entry allowed with extra RSI/momentum confirmation.');
  }
  if (score < effectiveMinScore) notes.push('Setup score below adaptive threshold.');

  return {
    action,
    confidence,
    setupScore: score,
    breakdown,
    marketRegime: regime,
    indicators,
    entryReason,
    notes,
    atr,
  };
};

const recalculateSymbolState = (state: BotState, symbol: string): BotState => {
  const symbolPositions = state.activePositions.filter(position => position.symbol === symbol);
  const totalAmount = symbolPositions.reduce((acc, position) => acc + position.amount, 0);
  const totalCost = symbolPositions.reduce((acc, position) => acc + position.entryPrice * position.amount, 0);

  const holdings = { ...state.holdings, [symbol]: round(Math.max(totalAmount, 0), 8) };
  const averageEntryPrices = {
    ...state.averageEntryPrices,
    [symbol]: totalAmount > 0 ? round(totalCost / totalAmount, 6) : 0,
  };

  return { ...state, holdings, averageEntryPrices };
};

const recalculatePortfolioValue = (state: BotState, symbol: string, currentPrice: number): BotState => {
  const holdingsValue = Object.entries(state.holdings).reduce((acc, [asset, amount]) => {
    if (amount <= 0) return acc;
    if (asset === symbol) return acc + amount * currentPrice;
    return acc + amount * (state.averageEntryPrices[asset] || 0);
  }, 0);

  return {
    ...state,
    totalPortfolioValue: round(state.balance + holdingsValue, 4),
  };
};

const recordTrade = (state: BotState, trade: Trade): BotState => {
  appendTrade(trade);
  return {
    ...state,
    trades: [trade, ...state.trades].slice(0, 2000),
  };
};

const consumePositions = (
  state: BotState,
  symbol: string,
  amountRequested: number,
  targetPositionId?: string,
): ConsumePositionsResult => {
  let remaining = amountRequested;
  let weightedEntryPrice = 0;
  let weightedRisk = 0;
  let weightedEntryFee = 0;
  let consumedAmount = 0;
  const metadata: ConsumePositionsResult['metadata'] = {};
  const nextPositions: Position[] = [];

  for (const position of state.activePositions) {
    if (position.symbol !== symbol) {
      nextPositions.push(position);
      continue;
    }

    if (targetPositionId && position.id !== targetPositionId) {
      nextPositions.push(position);
      continue;
    }

    if (remaining <= 0) {
      nextPositions.push(position);
      continue;
    }

    const consume = Math.min(position.amount, remaining);
    const keep = position.amount - consume;

    consumedAmount += consume;
    weightedEntryPrice += position.entryPrice * consume;
    weightedRisk +=
      (position.initialRiskPerUnit || Math.max(position.entryPrice - (position.stopLoss || position.entryPrice * 0.995), 1e-8)) *
      consume;
    weightedEntryFee += (position.entryFeePerUnit || 0) * consume;

    if (!metadata.marketRegime) metadata.marketRegime = position.marketRegime;
    if (!metadata.entryReason) metadata.entryReason = position.entryReason;
    if (!metadata.indicatorsSnapshot) metadata.indicatorsSnapshot = position.indicatorsSnapshot;
    if (!metadata.aiNotes) metadata.aiNotes = position.aiNotes;
    if (!metadata.strategyVersion) metadata.strategyVersion = position.strategyVersion;
    if (metadata.setupScore === undefined && typeof position.setupScore === 'number') metadata.setupScore = position.setupScore;
    if (metadata.stopLoss === undefined) metadata.stopLoss = position.stopLoss;
    if (metadata.takeProfit === undefined) metadata.takeProfit = position.takeProfit;

    remaining -= consume;

    if (keep > 0) {
      nextPositions.push({
        ...position,
        amount: round(keep, 8),
      });
    }
  }

  if (consumedAmount <= 0) {
    return {
      positions: state.activePositions,
      consumedAmount: 0,
      weightedEntryPrice: 0,
      weightedRiskPerUnit: 0,
      weightedEntryFeePerUnit: 0,
      metadata,
    };
  }

  return {
    positions: nextPositions,
    consumedAmount: round(consumedAmount, 8),
    weightedEntryPrice: weightedEntryPrice / consumedAmount,
    weightedRiskPerUnit: weightedRisk / consumedAmount,
    weightedEntryFeePerUnit: weightedEntryFee / consumedAmount,
    metadata,
  };
};

const executeBuyTrade = (state: BotState, pending: PendingTrade, atr: number): BotState => {
  const timestamp = Date.now();
  const simulation =
    pending.simulation ||
    simulateEntryExecution({
      symbol: pending.symbol,
      action: ActionType.BUY,
      marketPrice: pending.price,
      amount: pending.amount,
      atr,
      timestamp,
      feeRate: TRADING_FEE_RATE,
    });

  const totalCost = simulation.entryPrice * pending.amount + simulation.fees;
  if (totalCost > state.balance) return state;

  const nextStateBase: BotState = {
    ...state,
    balance: round(state.balance - totalCost, 6),
  };

  const trade: Trade = {
    id: generateTradeId(pending.symbol, ActionType.BUY, timestamp),
    symbol: pending.symbol,
    type: ActionType.BUY,
    price: simulation.entryPrice,
    amount: pending.amount,
    timestamp,
    fee: simulation.fees,
    stopLoss: pending.stopLoss,
    takeProfit: pending.takeProfit,
    marketRegime: pending.marketRegime,
    setupScore: pending.setupScore,
    scoreBreakdown: pending.scoreBreakdown,
    indicatorsSnapshot: pending.indicatorsSnapshot,
    entryReason: pending.entryReason,
    aiNotes: pending.aiNotes,
    strategyVersion: pending.strategyVersion,
    simulation,
  };

  const position: Position = {
    id: trade.id,
    symbol: pending.symbol,
    entryPrice: simulation.entryPrice,
    amount: pending.amount,
    stopLoss: pending.stopLoss,
    takeProfit: pending.takeProfit,
    timestamp,
    initialRiskPerUnit: Math.max(simulation.entryPrice - (pending.stopLoss || simulation.entryPrice * 0.995), 1e-8),
    setupScore: pending.setupScore,
    marketRegime: pending.marketRegime,
    entryReason: pending.entryReason,
    indicatorsSnapshot: pending.indicatorsSnapshot,
    aiNotes: pending.aiNotes,
    strategyVersion: pending.strategyVersion,
    entryFeePerUnit: simulation.fees / Math.max(pending.amount, 1e-8),
  };

  const withTrade = recordTrade(nextStateBase, trade);
  const withPosition = {
    ...withTrade,
    activePositions: [...withTrade.activePositions, position],
  };
  return recalculateSymbolState(withPosition, pending.symbol);
};

const executeSellTrade = (
  state: BotState,
  params: {
    symbol: string;
    amount: number;
    marketPrice: number;
    atr: number;
    exitReason: TradeExitReason;
    targetPositionId?: string;
    fallbackMetadata?: {
      setupScore?: number;
      marketRegime?: MarketRegime;
      entryReason?: string;
      indicatorsSnapshot?: IndicatorSnapshot;
      aiNotes?: string[];
      strategyVersion?: string;
      stopLoss?: number;
      takeProfit?: number;
    };
  },
): BotState => {
  const timestamp = Date.now();
  const consumed = consumePositions(state, params.symbol, params.amount, params.targetPositionId);
  if (consumed.consumedAmount <= 0) return state;

  const metadata = {
    ...consumed.metadata,
    ...params.fallbackMetadata,
  };
  const entryPrice = consumed.weightedEntryPrice;
  const entryFee = consumed.weightedEntryFeePerUnit * consumed.consumedAmount;
  const simulation = simulateExitExecution({
    symbol: params.symbol,
    marketPrice: params.marketPrice,
    entryPrice,
    amount: consumed.consumedAmount,
    atr: params.atr,
    timestamp,
    reason: params.exitReason,
    initialRiskPerUnit: consumed.weightedRiskPerUnit,
    entryFee,
    feeRate: TRADING_FEE_RATE,
  });

  const exitFee = simulation.exitPrice * consumed.consumedAmount * TRADING_FEE_RATE;
  const netRevenue = simulation.exitPrice * consumed.consumedAmount - exitFee;
  const costBasis = entryPrice * consumed.consumedAmount + entryFee;
  const pnl = netRevenue - costBasis;

  const nextStateBase: BotState = {
    ...state,
    balance: round(state.balance + netRevenue, 6),
    activePositions: consumed.positions,
  };

  const trade: Trade = {
    id: generateTradeId(params.symbol, ActionType.SELL, timestamp),
    symbol: params.symbol,
    type: ActionType.SELL,
    price: simulation.exitPrice,
    amount: consumed.consumedAmount,
    timestamp,
    fee: exitFee,
    pnl: round(pnl, 6),
    stopLoss: metadata.stopLoss,
    takeProfit: metadata.takeProfit,
    exitReason: params.exitReason,
    marketRegime: metadata.marketRegime,
    setupScore: metadata.setupScore,
    indicatorsSnapshot: metadata.indicatorsSnapshot,
    entryReason: metadata.entryReason,
    rMultiple: simulation.rMultiple,
    aiNotes: metadata.aiNotes,
    strategyVersion: metadata.strategyVersion,
    simulation: {
      ...simulation,
      pnl: round(pnl, 6),
    },
  };

  const withTrade = recordTrade(nextStateBase, trade);
  return recalculateSymbolState(withTrade, params.symbol);
};

const processAutoExits = (state: BotState, symbol: string, marketPrice: number, atr: number): BotState => {
  let nextState = state;
  const positions = state.activePositions.filter(position => position.symbol === symbol);

  for (const position of positions) {
    if (position.stopLoss && marketPrice <= position.stopLoss) {
      nextState = executeSellTrade(nextState, {
        symbol,
        amount: position.amount,
        marketPrice,
        atr,
        exitReason: 'STOP_LOSS',
        targetPositionId: position.id,
      });
      continue;
    }

    if (position.takeProfit && marketPrice >= position.takeProfit) {
      nextState = executeSellTrade(nextState, {
        symbol,
        amount: position.amount,
        marketPrice,
        atr,
        exitReason: 'TAKE_PROFIT',
        targetPositionId: position.id,
      });
    }
  }

  return nextState;
};

const maybeScheduleRefinement = (): void => {
  if (refinementInFlight) return;
  const summary = getStrategySummary();
  const last = summary.lastRefinementTime || 0;
  if (Date.now() - last < REFINEMENT_INTERVAL_MS) return;

  refinementInFlight = true;
  void runStrategyRefinementCycle().finally(() => {
    refinementInFlight = false;
  });
};

export const ensureRefinementScheduler = (): void => {
  if (typeof window === 'undefined' || schedulerId !== null) return;
  schedulerId = window.setInterval(() => {
    maybeScheduleRefinement();
  }, SCHEDULER_CHECK_MS);
  maybeScheduleRefinement();
};

export const triggerStrategyRefinement = async (): Promise<RefinementStatus> => {
  if (refinementInFlight) return 'RUNNING';
  refinementInFlight = true;
  try {
    const result = await runStrategyRefinementCycle();
    if (result.status === 'applied') return 'APPLIED';
    if (result.status === 'failed') return 'FAILED';
    if (result.status === 'rejected') return 'REJECTED';
    return 'IDLE';
  } finally {
    refinementInFlight = false;
  }
};

export const runBotEngineCycle = (input: BotEngineCycleInput): BotEngineCycleResult => {
  ensureRefinementScheduler();
  maybeScheduleRefinement();

  const runtimeConfig = getRuntimeConfig();
  const runtimeErrors = validateRuntimeConfig(runtimeConfig);
  if (runtimeErrors.length > 0) {
    return {
      state: {
        ...input.state,
        aiWarnings: [...runtimeErrors, ...input.state.aiWarnings].slice(0, 20),
      },
      pendingTrade: null,
    };
  }

  const strategy = loadStrategyState();
  const symbol = normalizeSymbol(input.symbol);
  const latest = input.candles[input.candles.length - 1];
  if (!latest || !isFinitePositive(input.currentPrice) || !isFinitePositive(latest.close)) {
    return {
      state: {
        ...input.state,
        aiWarnings: ['Invalid market data: missing/NaN price candle.', ...input.state.aiWarnings].slice(0, 20),
      },
      pendingTrade: null,
    };
  }

  const staleAge = Date.now() - latest.timestamp;
  if (staleAge > runtimeConfig.staleDataMs) {
    return {
      state: {
        ...input.state,
        aiWarnings: [`Stale market data for ${symbol}: ${staleAge}ms old.`, ...input.state.aiWarnings].slice(0, 20),
      },
      pendingTrade: null,
    };
  }

  const signal = deriveSignal(input.state, input.candles);
  let nextState: BotState = {
    ...input.state,
    strategyVersion: strategy.version,
    lastRefinementTime: strategy.lastRefinementTime,
    aiWarnings: strategy.warnings,
    marketStatus: toMarketStatus(signal.marketRegime),
  };

  nextState = processAutoExits(nextState, symbol, input.currentPrice, Math.max(signal.atr, 1e-8));

  let pendingTrade: PendingTrade | null = null;
  const holdings = nextState.holdings[symbol] || 0;
  const confidenceEligible = signal.confidence >= input.confidenceThreshold;
  const decisionTs = Date.now();
  const inputsHash = hashInput(`${symbol}:${runtimeConfig.timeframe}:${latest.close}:${latest.volume}`);
  const decisionId = `${symbol}-${decisionTs}-${signal.action}`;
  tradeHistoryService.recordDecision({
    id: decisionId,
    ts: decisionTs,
    symbol,
    timeframe: runtimeConfig.timeframe,
    inputsHash,
    signal: signal.action,
    confidence: signal.confidence,
    reasons: [signal.entryReason, ...signal.notes],
    modelVersion: strategy.version,
  });

  console.info('[trade-cycle]', JSON.stringify({
    symbol,
    timeframe: runtimeConfig.timeframe,
    price: Number(input.currentPrice.toFixed(8)),
    ema: Number(signal.indicators.emaShort.toFixed(8)),
    rsi: Number(signal.indicators.rsi.toFixed(4)),
    signal: signal.action,
    confidence: Number(signal.confidence.toFixed(4)),
    decisionId,
  }));

  if (nextState.isRunning && confidenceEligible) {
    if (signal.action === ActionType.BUY) {
      const risk = evaluateRisk({
        state: nextState,
        symbol,
        action: ActionType.BUY,
        price: input.currentPrice,
        atr: Math.max(signal.atr, 1e-8),
        setupScore: signal.setupScore,
        marketRegime: signal.marketRegime,
        parameters: strategy.parameters,
      });

      if (risk.allowed) {
        const expectedEdge = (risk.takeProfit && risk.stopLoss) ? (risk.takeProfit - input.currentPrice) / Math.max(input.currentPrice - risk.stopLoss, 1e-8) : 0;
        const currentExposure = (nextState.totalPortfolioValue - nextState.balance) / Math.max(nextState.totalPortfolioValue, 1e-8);
        const proposedNotional = risk.amount * input.currentPrice;
        const proposedPct = proposedNotional / Math.max(nextState.totalPortfolioValue, 1e-8);

        if (expectedEdge < runtimeConfig.minExpectedEdge || proposedPct > runtimeConfig.maxPositionSizePct || currentExposure + proposedPct > runtimeConfig.maxExposurePct) {
          nextState = {
            ...nextState,
            aiWarnings: [`Risk filter blocked order. expectedEdge=${expectedEdge.toFixed(4)} proposedPct=${proposedPct.toFixed(4)} exposure=${currentExposure.toFixed(4)}`, ...nextState.aiWarnings].slice(0, 20),
          };
        } else {
        const simulation = simulateEntryExecution({
          symbol,
          action: ActionType.BUY,
          marketPrice: input.currentPrice,
          amount: risk.amount,
          atr: Math.max(signal.atr, 1e-8),
          timestamp: Date.now(),
          feeRate: TRADING_FEE_RATE,
        });

        pendingTrade = {
          symbol,
          action: ActionType.BUY,
          price: simulation.entryPrice,
          amount: risk.amount,
          totalValue: simulation.entryPrice * risk.amount + simulation.fees,
          fee: simulation.fees,
          stopLoss: risk.stopLoss,
          takeProfit: risk.takeProfit,
          marketRegime: signal.marketRegime,
          setupScore: signal.setupScore,
          scoreBreakdown: signal.breakdown,
          indicatorsSnapshot: signal.indicators,
          entryReason: signal.entryReason,
          aiNotes: [...signal.notes, ...risk.notes],
          strategyVersion: strategy.version,
          simulation,
          decisionId,
          idempotencyKey: `${symbol}:${runtimeConfig.timeframe}:${decisionTs}:${signal.action}` ,
        };
        }
      } else {
        nextState = {
          ...nextState,
          aiWarnings: [risk.reason, ...nextState.aiWarnings].slice(0, 20),
        };
      }
    }

    if (signal.action === ActionType.SELL && holdings > 0) {
      const simulation = simulateEntryExecution({
        symbol,
        action: ActionType.SELL,
        marketPrice: input.currentPrice,
        amount: holdings,
        atr: Math.max(signal.atr, 1e-8),
        timestamp: Date.now(),
        feeRate: TRADING_FEE_RATE,
      });
      pendingTrade = {
        symbol,
        action: ActionType.SELL,
        price: simulation.entryPrice,
        amount: holdings,
        totalValue: simulation.entryPrice * holdings,
        fee: simulation.fees,
        marketRegime: signal.marketRegime,
        setupScore: signal.setupScore,
        scoreBreakdown: signal.breakdown,
        indicatorsSnapshot: signal.indicators,
        entryReason: 'Defensive exit: trend deterioration detected.',
        aiNotes: signal.notes,
        strategyVersion: strategy.version,
        simulation,
      };
    }
  }

  if (pendingTrade && nextState.autoPaperTrading) {
    nextState = confirmPendingTrade(nextState, pendingTrade, 'SIGNAL');
    pendingTrade = null;
  }

  const currentCandle = input.candles[input.candles.length - 1];
  if (currentCandle) {
    nextState = {
      ...nextState,
      trainingDataLog: [
        {
          timestamp: Date.now(),
          candle: currentCandle,
          action: signal.action,
          confidence: signal.confidence,
          marketStatus: nextState.marketStatus,
          setupScore: signal.setupScore,
          marketRegime: signal.marketRegime,
        },
        ...nextState.trainingDataLog,
      ].slice(0, MAX_TRAINING_LOG),
    };
  }

  nextState = recalculatePortfolioValue(nextState, symbol, input.currentPrice);
  return { state: nextState, pendingTrade };
};

export const confirmPendingTrade = (
  state: BotState,
  pendingTrade: PendingTrade,
  exitReason: TradeExitReason = 'MANUAL',
): BotState => {
  const atr = pendingTrade.indicatorsSnapshot?.atr || Math.max(pendingTrade.price * 0.003, 1e-8);
  let nextState = state;
  const orderId = `${pendingTrade.symbol}-${pendingTrade.action}-${Date.now()}`;
  const decisionId = pendingTrade.decisionId || `${pendingTrade.symbol}-${Date.now()}-${pendingTrade.action}`;
  const idempotencyKey = pendingTrade.idempotencyKey || `${pendingTrade.symbol}:${decisionId}:${pendingTrade.action}`;

  if (tradeHistoryService.hasOrderForIdempotencyKey(idempotencyKey)) {
    tradeHistoryService.recordOrder({
      orderId,
      decisionId,
      idempotencyKey,
      ts: Date.now(),
      symbol: pendingTrade.symbol,
      side: pendingTrade.action === ActionType.BUY ? 'BUY' : 'SELL',
      qty: pendingTrade.amount,
      requestedPrice: pendingTrade.price,
      status: 'SKIPPED',
      reason: 'Duplicate idempotency key on restart',
    });
    return state;
  }

  tradeHistoryService.recordOrder({
    orderId,
    decisionId,
    idempotencyKey,
    ts: Date.now(),
    symbol: pendingTrade.symbol,
    side: pendingTrade.action === ActionType.BUY ? 'BUY' : 'SELL',
    qty: pendingTrade.amount,
    requestedPrice: pendingTrade.price,
    status: 'ACCEPTED',
  });

  if (pendingTrade.action === ActionType.BUY) {
    nextState = executeBuyTrade(state, pendingTrade, atr);
  } else {
    nextState = executeSellTrade(state, {
      symbol: pendingTrade.symbol,
      amount: pendingTrade.amount,
      marketPrice: pendingTrade.price,
      atr,
      exitReason,
      fallbackMetadata: {
        setupScore: pendingTrade.setupScore,
        marketRegime: pendingTrade.marketRegime,
        entryReason: pendingTrade.entryReason,
        indicatorsSnapshot: pendingTrade.indicatorsSnapshot,
        aiNotes: pendingTrade.aiNotes,
        strategyVersion: pendingTrade.strategyVersion,
        stopLoss: pendingTrade.stopLoss,
        takeProfit: pendingTrade.takeProfit,
      },
    });
  }

  const currentPrice = pendingTrade.price;
  nextState = recalculatePortfolioValue(nextState, pendingTrade.symbol, currentPrice);
  tradeHistoryService.recordFill({
    fillId: `${orderId}-fill`,
    orderId,
    ts: Date.now(),
    symbol: pendingTrade.symbol,
    qty: pendingTrade.amount,
    avgPrice: pendingTrade.price,
    fees: pendingTrade.fee,
    status: 'FILLED',
  });
  tradeHistoryService.recordPositionSnapshot({
    ts: Date.now(),
    symbol: pendingTrade.symbol,
    balance: nextState.balance,
    positionSize: nextState.holdings[pendingTrade.symbol] || 0,
    avgEntryPrice: nextState.averageEntryPrices[pendingTrade.symbol] || 0,
    totalPortfolioValue: nextState.totalPortfolioValue,
  });
  return nextState;
};

export const syncBotStateWithStrategy = (state: BotState): BotState => {
  const summary = getStrategySummary();
  return {
    ...state,
    strategyVersion: summary.version,
    lastRefinementTime: summary.lastRefinementTime,
    aiWarnings: summary.warnings,
  };
};
