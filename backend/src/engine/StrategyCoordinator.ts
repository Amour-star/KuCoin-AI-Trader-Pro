import { DecisionType } from '@prisma/client';

type EvalInput = {
  price: number;
  ema9: number;
  ema21: number;
  rsi: number;
  threshold: number;
  testSignalMode: boolean;
};

export class StrategyCoordinator {
  decide(input: EvalInput) {
    const bullish = input.ema9 > input.ema21 && input.rsi > 52;
    const bearish = input.ema9 < input.ema21 && input.rsi < 48;
    const baseConfidence = Math.min(0.95, Math.abs(input.ema9 - input.ema21) / input.price + Math.abs(input.rsi - 50) / 100 + 0.4);
    const confidence = input.testSignalMode ? Math.max(baseConfidence, 0.45) : baseConfidence;
    const threshold = input.testSignalMode ? Math.min(input.threshold, 0.45) : input.threshold;

    if (bullish && confidence >= threshold) {
      return { decision: DecisionType.BUY, confidence, reasons: ['EMA9_GT_EMA21', 'RSI_STRENGTH'] };
    }
    if (bearish && confidence >= threshold) {
      return { decision: DecisionType.SELL, confidence, reasons: ['EMA9_LT_EMA21', 'RSI_WEAKNESS'] };
    }
    return { decision: DecisionType.HOLD, confidence, reasons: ['NO_EDGE'] };
  }
}
