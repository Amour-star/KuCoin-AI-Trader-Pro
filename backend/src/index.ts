import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { BinanceMarketData } from './services/BinanceMarketData';
import { TradeStore } from './services/TradeStore';
import { PositionStore } from './services/PositionStore';
import { StrategyCoordinator } from './engine/StrategyCoordinator';
import { ExecutionEngine } from './engine/ExecutionEngine';
import { RiskGuards } from './engine/RiskGuards';
import { EngineRunner } from './engine/EngineRunner';
import { decisionsRoute, tradesRoute } from './routes/trades';
import { forceTradeRoute } from './routes/forceTrade';
import { settingsRoute } from './routes/settings';
import { statusRoute } from './routes/status';

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));

const symbol = process.env.ENGINE_SYMBOL ?? 'ETHUSDC';
let threshold = Number(process.env.CONFIDENCE_THRESHOLD ?? 0.6);
const port = Number(process.env.BACKEND_PORT ?? 8787);
let testSignalMode = false;

const metrics = {
  lastHeartbeatTs: null,
  evaluations: 0,
  signals: 0,
  tradesExecuted: 0,
};

const marketData = new BinanceMarketData();
const tradeStore = new TradeStore();
const positionStore = new PositionStore();
const execution = new ExecutionEngine(tradeStore, positionStore);
const strategy = new StrategyCoordinator();
const risk = new RiskGuards(positionStore);
const runner = new EngineRunner(symbol, () => threshold, marketData, strategy, tradeStore, execution, risk, metrics, () => testSignalMode);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/status', statusRoute(metrics, symbol));
app.get('/api/trades', tradesRoute(tradeStore));
app.get('/api/decisions', decisionsRoute(tradeStore));
app.post('/api/force-trade', forceTradeRoute(marketData, tradeStore, execution));
app.post('/api/settings', async (req, res) => {
  const result = await settingsRoute(req, res);
  if (typeof req.body?.confidenceThreshold === 'number') threshold = req.body.confidenceThreshold;
  return result;
});
app.post('/api/test-signal-mode', (req, res) => {
  testSignalMode = Boolean(req.body?.enabled);
  res.json({ enabled: testSignalMode });
});

app.listen(port, () => {
  console.log(`Backend engine listening on :${port}`);
  runner.start();
});
