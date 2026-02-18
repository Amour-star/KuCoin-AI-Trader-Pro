export enum ActionType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD'
}

export type TradeExitReason = 'SIGNAL' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'MANUAL';
export type ConnectivityStatus = 'REALTIME' | 'SIMULATED' | 'CONNECTING';
export type MarketStatus = 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE';
export type MarketRegime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'CHOP' | 'HIGH_VOLATILITY';
export type RefinementStatus = 'IDLE' | 'RUNNING' | 'APPLIED' | 'REJECTED' | 'FAILED';

export interface IndicatorSnapshot {
  emaShort: number;
  emaLong: number;
  rsi: number;
  atr: number;
  momentum: number;
  volumeRatio: number;
}

export interface SetupScoreBreakdown {
  pullbackToEma: number;
  rsiRecovery: number;
  momentumConfirmation: number;
  volumeConfirmation: number;
  trendAlignment: number;
  total: number;
  threshold: number;
}

export interface StrategyParameters {
  minScore: number;
  atrMultiplier: number;
  stopLossATR: number;
  takeProfitATR: number;
  maxRiskPerTradePct: number;
  dailyMaxLossPct: number;
  maxConcurrentTrades: number;
  killSwitchLosses: number;
  minAtrPct: number;
  maxAtrPct: number;
}

export interface StrategyVersionRecord {
  version: string;
  timestamp: number;
  parameters: StrategyParameters;
  notes: string[];
}

export interface StrategyState {
  version: string;
  parameters: StrategyParameters;
  lastRefinementTime: number | null;
  history: StrategyVersionRecord[];
  warnings: string[];
}

export interface StrategySummary {
  version: string;
  lastRefinementTime: number | null;
  warnings: string[];
}

export interface ExecutionSimulation {
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  rMultiple: number;
  reason: TradeExitReason | 'ENTRY';
  spread: number;
  slippage: number;
  fees: number;
}

export interface Candle {
  time: string; // ISO string or formatted time
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rsi?: number;
  emaShort?: number;
  emaLong?: number;
  atr?: number;
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  volumeSma20?: number;
  volumeRatio?: number;
}

export interface Trade {
  id: string;
  symbol: string;
  type: ActionType;
  price: number;
  amount: number;
  timestamp: number;
  pnl?: number; // Realized PnL for Sell trades
  fee: number;
  stopLoss?: number;
  takeProfit?: number;
  exitReason?: TradeExitReason;
  marketRegime?: MarketRegime;
  setupScore?: number;
  scoreBreakdown?: SetupScoreBreakdown;
  indicatorsSnapshot?: IndicatorSnapshot;
  entryReason?: string;
  rMultiple?: number;
  aiNotes?: string[];
  strategyVersion?: string;
  simulation?: ExecutionSimulation;
  decisionId?: string;
  idempotencyKey?: string;
}


export interface Position {
  id: string;
  symbol: string;
  entryPrice: number;
  amount: number;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: number;
  initialRiskPerUnit?: number;
  setupScore?: number;
  marketRegime?: MarketRegime;
  entryReason?: string;
  indicatorsSnapshot?: IndicatorSnapshot;
  aiNotes?: string[];
  strategyVersion?: string;
  entryFeePerUnit?: number;
}

export interface TrainingDataPoint {
  timestamp: number;
  candle: Candle;
  action: ActionType;
  confidence: number;
  marketStatus: MarketStatus;
  pnl?: number;
  setupScore?: number;
  marketRegime?: MarketRegime;
}

export interface BotState {
  isRunning: boolean;
  autoPaperTrading: boolean;
  connectivity: ConnectivityStatus;
  balance: number; // USDC
  holdings: Record<string, number>; // Symbol -> Amount
  averageEntryPrices: Record<string, number>; // Symbol -> Avg Entry Price (Cost Basis)
  activePositions: Position[]; // Track individual open positions for SL/TP
  totalPortfolioValue: number;
  activeSymbol: string;
  marketStatus: MarketStatus;
  lastTrainingTime: number;
  trades: Trade[];
  trainingDataLog: TrainingDataPoint[];
  strategyVersion: string;
  lastRefinementTime: number | null;
  refinementStatus: RefinementStatus;
  aiWarnings: string[];
}

export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
}


export interface DecisionRecord {
  id: string;
  ts: number;
  symbol: string;
  timeframe: string;
  inputsHash: string;
  signal: ActionType;
  confidence: number;
  reasons: string[];
  modelVersion?: string;
}

export interface ExecutionReceipt {
  decisionId: string;
  orderId: string;
  status: 'ACCEPTED' | 'SKIPPED' | 'REJECTED' | 'FILLED' | 'FAILED';
  filledQty: number;
  avgPrice: number;
  fees: number;
  error?: string;
}

export interface PendingTrade {
  symbol: string;
  action: ActionType;
  price: number;
  amount: number;      // Amount of crypto
  totalValue: number;  // Total USDC value involved
  fee: number;         // Estimated fee in USDC
  stopLoss?: number;
  takeProfit?: number;
  marketRegime?: MarketRegime;
  setupScore?: number;
  scoreBreakdown?: SetupScoreBreakdown;
  indicatorsSnapshot?: IndicatorSnapshot;
  entryReason?: string;
  aiNotes?: string[];
  strategyVersion?: string;
  simulation?: ExecutionSimulation;
  decisionId?: string;
  idempotencyKey?: string;
}


export interface PerformanceMetrics {
  totalTrades: number;
  closedTrades: number;
  winRate: number;
  expectancy: number;
  avgR: number;
  maxDrawdownPct: number;
  profitFactor: number;
  grossProfit: number;
  grossLossAbs: number;
}

export interface ConditionBucket {
  key: string;
  trades: number;
  winRate: number;
  expectancy: number;
}

export interface LossCluster {
  label: string;
  occurrences: number;
  averageLoss: number;
}
