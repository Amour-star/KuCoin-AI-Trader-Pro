import { Candle } from '../types.ts';

interface IndicatorState {
  emaShort?: number;
  emaLong?: number;
  prevClose?: number;
  avgGain?: number;
  avgLoss?: number;
  atr?: number;
  trCount: number;
  volumeWindow: number[];
}

const ema = (price: number, prev: number | undefined, period: number): number => {
  if (prev === undefined) return price;
  const k = 2 / (period + 1);
  return (price - prev) * k + prev;
};

export class IndicatorEngine {
  private readonly stateBySymbol = new Map<string, IndicatorState>();

  update(symbol: string, candle: Candle): Candle {
    const state = this.stateBySymbol.get(symbol) || { trCount: 0, volumeWindow: [] };
    state.emaShort = ema(candle.close, state.emaShort, 9);
    state.emaLong = ema(candle.close, state.emaLong, 21);

    if (state.prevClose !== undefined) {
      const delta = candle.close - state.prevClose;
      const gain = Math.max(0, delta);
      const loss = Math.max(0, -delta);
      state.avgGain = state.avgGain === undefined ? gain : ((state.avgGain * 13) + gain) / 14;
      state.avgLoss = state.avgLoss === undefined ? loss : ((state.avgLoss * 13) + loss) / 14;
      const rs = (state.avgGain || 0) / ((state.avgLoss || 0) || 1e-8);
      candle.rsi = 100 - (100 / (1 + rs));

      const tr = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - state.prevClose),
        Math.abs(candle.low - state.prevClose),
      );
      state.atr = state.atr === undefined ? tr : ((state.atr * 13) + tr) / 14;
      state.trCount += 1;
      candle.atr = state.atr;
    }

    state.prevClose = candle.close;
    state.volumeWindow.push(candle.volume);
    if (state.volumeWindow.length > 20) state.volumeWindow.shift();
    const volSma = state.volumeWindow.reduce((a, b) => a + b, 0) / state.volumeWindow.length;

    candle.emaShort = state.emaShort;
    candle.emaLong = state.emaLong;
    candle.volumeSma20 = volSma;
    candle.volumeRatio = volSma > 0 ? candle.volume / volSma : 1;

    this.stateBySymbol.set(symbol, state);
    return candle;
  }
}
