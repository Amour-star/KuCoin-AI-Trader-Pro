import { ActionType, BotState } from '../types.ts';
import { INITIAL_BALANCE, SYMBOLS } from '../constants.ts';
import { fetchCandles, fetchLatestTicker, getConnectivityStatus } from '../services/marketService.ts';
import { runBotEngineCycle, syncBotStateWithStrategy } from '../services/botEngine.ts';
import { getStrategySummary } from '../services/engine/strategyState.ts';
import { tradeHistoryService } from '../services/storage/tradeHistoryService.ts';

const symbol = process.env.BOT_SYMBOL || SYMBOLS[0];

const createInitialState = (): BotState => {
  const strategy = getStrategySummary();
  return {
    isRunning: true,
    autoPaperTrading: true,
    connectivity: 'CONNECTING',
    balance: INITIAL_BALANCE,
    holdings: {},
    averageEntryPrices: {},
    activePositions: [],
    totalPortfolioValue: INITIAL_BALANCE,
    activeSymbol: symbol,
    marketStatus: 'ACTIVE',
    lastTrainingTime: Date.now(),
    trades: [],
    trainingDataLog: [],
    strategyVersion: strategy.version,
    lastRefinementTime: strategy.lastRefinementTime,
    refinementStatus: 'IDLE',
    aiWarnings: strategy.warnings,
  };
};

const main = async () => {
  const candles = await fetchCandles(symbol);
  const ticker = await fetchLatestTicker(symbol);

  if (!ticker) {
    console.error('No ticker available');
    process.exit(1);
  }

  const cycle = runBotEngineCycle({
    state: createInitialState(),
    symbol,
    candles,
    currentPrice: ticker.price,
    confidenceThreshold: 0.6,
  });

  const finalState = syncBotStateWithStrategy({
    ...cycle.state,
    connectivity: getConnectivityStatus(),
  });

  const recent = tradeHistoryService.getRecentTrades(5);
  const pnl = tradeHistoryService.getPnLSummary(Date.now() - 24 * 60 * 60 * 1000, Date.now());

  console.log(JSON.stringify({
    symbol,
    connectivity: finalState.connectivity,
    trades: finalState.trades.length,
    lastTradeType: finalState.trades[0]?.type || ActionType.HOLD,
    warnings: finalState.aiWarnings.slice(0, 3),
    recentOrders: recent.length,
    pnl,
  }, null, 2));
};

void main();
