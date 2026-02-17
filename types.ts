export enum ActionType {
  BUY = 'BUY',
  SELL = 'SELL',
  HOLD = 'HOLD'
}

export type ConnectivityStatus = 'REALTIME' | 'SIMULATED' | 'CONNECTING';

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
}

export interface Position {
  id: string;
  symbol: string;
  entryPrice: number;
  amount: number;
  stopLoss?: number;
  takeProfit?: number;
  timestamp: number;
}

export interface TrainingDataPoint {
  timestamp: number;
  candle: Candle;
  action: ActionType;
  confidence: number;
  marketStatus: 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE';
  pnl?: number;
}

export interface BotState {
  isRunning: boolean;
  connectivity: ConnectivityStatus;
  balance: number; // USDT
  holdings: Record<string, number>; // Symbol -> Amount
  averageEntryPrices: Record<string, number>; // Symbol -> Avg Entry Price (Cost Basis)
  activePositions: Position[]; // Track individual open positions for SL/TP
  totalPortfolioValue: number;
  activeSymbol: string;
  marketStatus: 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE';
  lastTrainingTime: number;
  trades: Trade[];
  trainingDataLog: TrainingDataPoint[];
}

export interface MarketData {
  symbol: string;
  price: number;
  volume24h: number;
  change24h: number;
}

export interface PendingTrade {
  symbol: string;
  action: ActionType;
  price: number;
  amount: number;      // Amount of crypto
  totalValue: number;  // Total USDT value involved
  fee: number;         // Estimated fee in USDT
  stopLoss?: number;
  takeProfit?: number;
}