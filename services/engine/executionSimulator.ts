import { TRADING_FEE_RATE } from '../../constants';
import { ActionType, ExecutionSimulation, TradeExitReason } from '../../types';

export interface EntrySimulationInput {
  symbol: string;
  action: ActionType;
  marketPrice: number;
  amount: number;
  atr: number;
  timestamp: number;
  feeRate?: number;
}

export interface ExitSimulationInput {
  symbol: string;
  marketPrice: number;
  entryPrice: number;
  amount: number;
  atr: number;
  timestamp: number;
  reason: TradeExitReason;
  initialRiskPerUnit?: number;
  entryFee?: number;
  feeRate?: number;
}

const hashToUnit = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return Math.abs(hash % 10000) / 10000;
};

const calcSpread = (price: number, atr: number): number => {
  const atrPct = atr / Math.max(price, 1);
  const spreadPct = 0.00015 + Math.min(0.001, atrPct * 0.18);
  return price * spreadPct;
};

const calcSlippage = (price: number, atr: number, symbol: string, timestamp: number, side: ActionType): number => {
  const atrPct = atr / Math.max(price, 1);
  const noise = hashToUnit(`${symbol}:${timestamp}:${side}`);
  const slipPct = 0.00005 + atrPct * 0.08 + noise * 0.0002;
  return price * slipPct;
};

const round = (value: number, decimals: number = 8): number =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;

export const simulateEntryExecution = (input: EntrySimulationInput): ExecutionSimulation => {
  const spread = calcSpread(input.marketPrice, input.atr);
  const slippage = calcSlippage(input.marketPrice, input.atr, input.symbol, input.timestamp, input.action);
  const feeRate = input.feeRate ?? TRADING_FEE_RATE;

  const directionalImpact = input.action === ActionType.BUY ? 1 : -1;
  const fillPrice = input.marketPrice + directionalImpact * (spread / 2 + slippage);
  const fees = Math.max(0, fillPrice * input.amount * feeRate);

  return {
    entryPrice: round(fillPrice, 6),
    exitPrice: round(fillPrice, 6),
    pnl: 0,
    rMultiple: 0,
    reason: 'ENTRY',
    spread: round(spread, 6),
    slippage: round(slippage, 6),
    fees: round(fees, 6),
  };
};

export const simulateExitExecution = (input: ExitSimulationInput): ExecutionSimulation => {
  const spread = calcSpread(input.marketPrice, input.atr);
  const slippage = calcSlippage(input.marketPrice, input.atr, input.symbol, input.timestamp, ActionType.SELL);
  const feeRate = input.feeRate ?? TRADING_FEE_RATE;

  const fillPrice = input.marketPrice - (spread / 2 + slippage);
  const exitFee = Math.max(0, fillPrice * input.amount * feeRate);
  const entryFee = input.entryFee ?? Math.max(0, input.entryPrice * input.amount * feeRate);
  const grossPnl = (fillPrice - input.entryPrice) * input.amount;
  const pnl = grossPnl - exitFee - entryFee;

  const totalRisk = Math.max((input.initialRiskPerUnit || 0) * input.amount, 1e-8);
  const rMultiple = pnl / totalRisk;

  return {
    entryPrice: round(input.entryPrice, 6),
    exitPrice: round(fillPrice, 6),
    pnl: round(pnl, 6),
    rMultiple: round(rMultiple, 4),
    reason: input.reason,
    spread: round(spread, 6),
    slippage: round(slippage, 6),
    fees: round(entryFee + exitFee, 6),
  };
};
