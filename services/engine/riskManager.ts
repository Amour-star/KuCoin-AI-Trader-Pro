import { ActionType, BotState, MarketRegime, StrategyParameters, Trade } from '../../types';

export interface RiskEvaluationInput {
  state: BotState;
  symbol: string;
  action: ActionType;
  price: number;
  atr: number;
  setupScore: number;
  marketRegime: MarketRegime;
  parameters: StrategyParameters;
}

export interface RiskEvaluationResult {
  allowed: boolean;
  reason: string;
  amount: number;
  stopLoss?: number;
  takeProfit?: number;
  riskAmount: number;
  notes: string[];
}

const round = (value: number, decimals: number = 8): number =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;

const getTodaysClosedTrades = (trades: Trade[]): Trade[] => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return trades.filter(trade => trade.type === ActionType.SELL && trade.timestamp >= start.getTime());
};

const getDailyPnl = (trades: Trade[]): number =>
  getTodaysClosedTrades(trades).reduce((acc, trade) => acc + (trade.pnl || 0), 0);

const getLossStreak = (trades: Trade[]): number => {
  const closed = trades
    .filter(trade => trade.type === ActionType.SELL && typeof trade.pnl === 'number')
    .sort((a, b) => b.timestamp - a.timestamp);

  let streak = 0;
  for (const trade of closed) {
    if ((trade.pnl || 0) < 0) streak += 1;
    else break;
  }
  return streak;
};

export const evaluateRisk = (input: RiskEvaluationInput): RiskEvaluationResult => {
  if (input.action === ActionType.SELL) {
    const held = input.state.holdings[input.symbol] || 0;
    return {
      allowed: held > 0,
      reason: held > 0 ? 'Exit allowed' : 'No position to exit',
      amount: held,
      riskAmount: 0,
      notes: [],
    };
  }

  const notes: string[] = [];
  const { state, price, atr, marketRegime, parameters } = input;

  if (state.balance <= 15) {
    return {
      allowed: false,
      reason: 'Insufficient paper capital',
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  if (marketRegime === 'CHOP') {
    return {
      allowed: false,
      reason: 'Chop filter blocked low-quality setup',
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  if (state.activePositions.length >= parameters.maxConcurrentTrades) {
    return {
      allowed: false,
      reason: `Max concurrent trades (${parameters.maxConcurrentTrades}) reached`,
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  const dailyPnl = getDailyPnl(state.trades);
  const maxDailyLoss = state.totalPortfolioValue * parameters.dailyMaxLossPct;
  if (dailyPnl <= -maxDailyLoss) {
    return {
      allowed: false,
      reason: 'Daily max loss reached. Kill-switch enabled for the session.',
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  const lossStreak = getLossStreak(state.trades);
  if (lossStreak >= parameters.killSwitchLosses) {
    return {
      allowed: false,
      reason: `Kill-switch: ${lossStreak} consecutive losses`,
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  if (!Number.isFinite(atr) || atr <= 0) {
    return {
      allowed: false,
      reason: 'Invalid ATR. Risk model unavailable.',
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  const atrPct = atr / Math.max(price, 1);
  if (atrPct < parameters.minAtrPct || atrPct > parameters.maxAtrPct) {
    return {
      allowed: false,
      reason: 'ATR regime outside allowed volatility window',
      amount: 0,
      riskAmount: 0,
      notes: [`ATR ${atrPct.toFixed(4)} not in [${parameters.minAtrPct}, ${parameters.maxAtrPct}]`],
    };
  }

  const baseRisk = state.totalPortfolioValue * parameters.maxRiskPerTradePct;
  const streakMultiplier = Math.max(0.45, 1 - lossStreak * 0.15);
  const dailyDrawdownMultiplier = dailyPnl < 0 ? Math.max(0.5, 1 + dailyPnl / Math.max(maxDailyLoss, 1)) : 1;
  const adaptiveMultiplier = streakMultiplier * dailyDrawdownMultiplier;

  if (adaptiveMultiplier < 0.95) {
    notes.push(`Adaptive risk scaling active (${adaptiveMultiplier.toFixed(2)}x).`);
  }

  const effectiveRisk = baseRisk * adaptiveMultiplier;
  const stopDistance = atr * parameters.stopLossATR * parameters.atrMultiplier;
  const takeProfitDistance = atr * parameters.takeProfitATR * parameters.atrMultiplier;
  const stopLoss = price - stopDistance;
  const takeProfit = price + takeProfitDistance;

  if (stopLoss <= 0 || takeProfit <= price) {
    return {
      allowed: false,
      reason: 'Calculated stop-loss/take-profit invalid',
      amount: 0,
      riskAmount: 0,
      notes,
    };
  }

  const amountByRisk = effectiveRisk / Math.max(stopDistance, 1e-8);
  const maxAffordable = state.balance / price;
  const amount = Math.max(0, Math.min(amountByRisk, maxAffordable));

  if (amount * price < 10) {
    return {
      allowed: false,
      reason: 'Position size below minimum practical threshold',
      amount: 0,
      riskAmount: effectiveRisk,
      notes,
    };
  }

  return {
    allowed: true,
    reason: 'Risk accepted',
    amount: round(amount),
    stopLoss: round(stopLoss, 6),
    takeProfit: round(takeProfit, 6),
    riskAmount: round(effectiveRisk, 4),
    notes,
  };
};
