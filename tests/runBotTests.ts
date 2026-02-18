import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { runBotEngineCycle } from '../services/botEngine.ts';
import { ActionType, BotState, Candle } from '../types.ts';
import { INITIAL_BALANCE } from '../constants.ts';
import { getStrategySummary } from '../services/engine/strategyState.ts';
import { TradeHistoryService } from '../services/storage/tradeHistoryService.ts';

const symbol = 'BTC-USDT';

const makeState = (): BotState => {
  const strategy = getStrategySummary();
  return {
    isRunning: true,
    autoPaperTrading: true,
    connectivity: 'SIMULATED',
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
    aiWarnings: [],
  };
};

const makeCandles = (): Candle[] => {
  const baseTs = Date.now() - 100 * 60 * 60 * 1000;
  return Array.from({ length: 60 }, (_, idx) => {
    const price = 60000 + idx * 10;
    return {
      time: new Date(baseTs + idx * 60 * 60 * 1000).toISOString(),
      timestamp: baseTs + idx * 60 * 60 * 1000,
      open: price - 5,
      high: price + 12,
      low: price - 8,
      close: price,
      volume: 1000 + idx,
      rsi: 52,
      emaShort: price - 2,
      emaLong: price - 6,
    };
  });
};

const testRefinementStableOutput = () => {
  const candles = makeCandles();
  const result = runBotEngineCycle({
    state: makeState(),
    symbol,
    candles,
    currentPrice: candles[candles.length - 1].close,
    confidenceThreshold: 0.6,
  });
  const latestLog = result.state.trainingDataLog[0];
  assert(latestLog, 'Expected training log item');
  assert([ActionType.BUY, ActionType.SELL, ActionType.HOLD].includes(latestLog.action));
};

const testTradeHistoryWriteRead = () => {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    for (const f of ['decisions.jsonl', 'orders.jsonl', 'fills.jsonl', 'positions.jsonl']) {
      const fp = path.join(dataDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }

  const service = new TradeHistoryService();
  const now = Date.now();
  service.recordDecision({ id: 'd1', ts: now, symbol, timeframe: '1h', inputsHash: 'abc', signal: 'BUY', confidence: 0.7, reasons: ['test'] });
  service.recordOrder({ orderId: 'o1', decisionId: 'd1', idempotencyKey: 'k1', ts: now, symbol, side: 'BUY', qty: 1, requestedPrice: 1, status: 'ACCEPTED' });
  service.recordFill({ fillId: 'f1', orderId: 'o1', ts: now, symbol, qty: 1, avgPrice: 1, fees: 0.01, status: 'FILLED' });
  service.recordPositionSnapshot({ ts: now, symbol, balance: 100, positionSize: 1, avgEntryPrice: 1, totalPortfolioValue: 100 });

  const recent = service.getRecentTrades(10);
  assert.equal(recent.length, 1);
  assert.equal(recent[0].orderId, 'o1');
};

const testOneCycleStoresDecision = () => {
  const candles = makeCandles();
  runBotEngineCycle({ state: makeState(), symbol, candles, currentPrice: candles[candles.length - 1].close, confidenceThreshold: 0.6 });
  const decisionsPath = path.resolve(process.cwd(), 'data', 'decisions.jsonl');
  assert(fs.existsSync(decisionsPath), 'Expected decisions.jsonl to exist after one cycle');
  const content = fs.readFileSync(decisionsPath, 'utf8').trim();
  assert(content.length > 0, 'Expected decisions history content');
};

testRefinementStableOutput();
testTradeHistoryWriteRead();
testOneCycleStoresDecision();
console.log('All bot tests passed');
