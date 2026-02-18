import { ActionType, ConditionBucket, LossCluster, PerformanceMetrics, StrategyParameters, Trade } from '../../types';

const safeDivide = (a: number, b: number): number => (b === 0 ? 0 : a / b);

const closedTradesAscending = (trades: Trade[]): Trade[] =>
  trades
    .filter(trade => trade.type === ActionType.SELL && typeof trade.pnl === 'number')
    .sort((a, b) => a.timestamp - b.timestamp);

export const calculatePerformanceMetrics = (trades: Trade[], initialBalance: number): PerformanceMetrics => {
  const closed = closedTradesAscending(trades);
  const closedCount = closed.length;
  const wins = closed.filter(trade => (trade.pnl || 0) > 0);
  const losses = closed.filter(trade => (trade.pnl || 0) < 0);
  const grossProfit = wins.reduce((acc, trade) => acc + (trade.pnl || 0), 0);
  const grossLossAbs = losses.reduce((acc, trade) => acc + Math.abs(trade.pnl || 0), 0);

  const expectancy = safeDivide(closed.reduce((acc, trade) => acc + (trade.pnl || 0), 0), closedCount);
  const avgR = safeDivide(
    closed.reduce((acc, trade) => acc + (trade.rMultiple || 0), 0),
    closed.filter(trade => typeof trade.rMultiple === 'number').length,
  );
  const winRate = safeDivide(wins.length, closedCount) * 100;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

  let equity = initialBalance;
  let peak = initialBalance;
  let maxDrawdownPct = 0;
  for (const trade of closed) {
    equity += trade.pnl || 0;
    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
  }

  return {
    totalTrades: trades.length,
    closedTrades: closedCount,
    winRate,
    expectancy,
    avgR,
    maxDrawdownPct,
    profitFactor,
    grossProfit,
    grossLossAbs,
  };
};

export const buildConditionBuckets = (trades: Trade[]): ConditionBucket[] => {
  const buckets = new Map<string, Trade[]>();
  for (const trade of trades) {
    if (trade.type !== ActionType.SELL || typeof trade.pnl !== 'number') continue;
    const regime = trade.marketRegime || 'UNKNOWN';
    const scoreBand =
      typeof trade.setupScore === 'number'
        ? trade.setupScore >= 0.8
          ? 'SCORE_HIGH'
          : trade.setupScore >= 0.68
            ? 'SCORE_MID'
            : 'SCORE_LOW'
        : 'SCORE_UNKNOWN';
    const key = `${regime}:${scoreBand}`;
    const group = buckets.get(key) || [];
    group.push(trade);
    buckets.set(key, group);
  }

  return [...buckets.entries()].map(([key, group]) => {
    const wins = group.filter(trade => (trade.pnl || 0) > 0).length;
    const expectancy = safeDivide(group.reduce((acc, trade) => acc + (trade.pnl || 0), 0), group.length);
    return {
      key,
      trades: group.length,
      winRate: safeDivide(wins, group.length) * 100,
      expectancy,
    };
  });
};

export const buildLossClusters = (trades: Trade[]): LossCluster[] => {
  const clusters = new Map<string, number[]>();
  for (const trade of trades) {
    if (trade.type !== ActionType.SELL || (trade.pnl || 0) >= 0) continue;
    const reason = trade.exitReason || 'UNKNOWN_EXIT';
    const regime = trade.marketRegime || 'UNKNOWN_REGIME';
    const key = `${reason}:${regime}`;
    const values = clusters.get(key) || [];
    values.push(trade.pnl || 0);
    clusters.set(key, values);
  }

  return [...clusters.entries()]
    .map(([label, values]) => ({
      label,
      occurrences: values.length,
      averageLoss: safeDivide(values.reduce((acc, value) => acc + value, 0), values.length),
    }))
    .sort((a, b) => b.occurrences - a.occurrences);
};

export const walkForwardFilterTrades = (trades: Trade[], parameters: StrategyParameters): Trade[] =>
  trades.filter(trade => {
    if (trade.type !== ActionType.SELL) return false;
    const scoreOk = (trade.setupScore ?? 0) >= parameters.minScore;
    const regimeOk = trade.marketRegime !== 'CHOP';
    return scoreOk && regimeOk;
  });
