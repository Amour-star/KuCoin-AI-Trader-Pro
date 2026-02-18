import { ActionType, Trade } from '../types.ts';
import { TRADING_FEE_RATE } from '../constants.ts';

export interface ExecuteInput {
  symbol: string;
  side: ActionType.BUY | ActionType.SELL;
  qty: number;
  expectedPrice: number;
  candleHigh: number;
  candleLow: number;
  confidence: number;
  modelVersion: string;
  entryTimestamp?: number;
}

const round = (v: number, d: number = 8): number => Number(v.toFixed(d));

export class ExecutionEngine {
  constructor(private readonly mode: 'PAPER' | 'LIVE' = 'PAPER') {}

  execute(input: ExecuteInput): { trade: Trade; fee: number } {
    const dynamicSlip = (input.candleHigh - input.candleLow) * 0.08;
    const pctSlip = input.expectedPrice * (0.0001 + (Math.random() * 0.0004));
    const slippage = this.mode === 'PAPER' ? Math.max(dynamicSlip, pctSlip) : 0;
    const executedPrice = input.side === ActionType.BUY ? input.expectedPrice + slippage : input.expectedPrice - slippage;
    const fee = executedPrice * input.qty * TRADING_FEE_RATE;

    const trade: Trade = {
      id: `${input.symbol}-${input.side}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      symbol: input.symbol,
      type: input.side,
      price: round(executedPrice, 6),
      amount: round(input.qty, 8),
      timestamp: Date.now(),
      fee: round(fee, 6),
      expectedPrice: round(input.expectedPrice, 6),
      executedPrice: round(executedPrice, 6),
      slippage: round(Math.abs(slippage), 6),
      confidence: input.confidence,
      modelVersion: input.modelVersion,
      holdTimeMs: input.entryTimestamp ? Date.now() - input.entryTimestamp : undefined,
    };

    return { trade, fee };
  }

  static calcRealizedPnl(entryPrice: number, exitPrice: number, qty: number, side: ActionType, fees: number): number {
    const gross = side === ActionType.BUY ? (exitPrice - entryPrice) * qty : (entryPrice - exitPrice) * qty;
    return gross - fees;
  }
}
