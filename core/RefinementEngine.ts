import { ActionType, Candle, Trade } from '../types.ts';

export interface RefinementDecision {
  action: ActionType;
  confidence: number;
  regime: 'TRENDING' | 'RANGING' | 'VOLATILE';
  modelVersion: string;
}

export interface StabilityReport {
  stabilityScore: number;
  fragility: string[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class RefinementEngine {
  private version = `rf-${Date.now()}`;
  private closedCountByVersion = new Map<string, number>();

  decide(candles: Candle[]): RefinementDecision {
    const last = candles[candles.length - 1];
    if (!last) return { action: ActionType.HOLD, confidence: 0, regime: 'RANGING', modelVersion: this.version };
    const trend = ((last.emaShort || last.close) - (last.emaLong || last.close)) / Math.max(last.close, 1);
    const vol = (last.atr || 0) / Math.max(last.close, 1);
    const regime = vol > 0.02 ? 'VOLATILE' : Math.abs(trend) > 0.0015 ? 'TRENDING' : 'RANGING';
    const rawConfidence = clamp(Math.abs(trend) * 350 + ((last.rsi || 50) - 50) / 100, 0, 1);
    const decay = Math.max(0.7, 1 - (this.closedCountByVersion.get(this.version) || 0) * 0.002);
    const confidence = clamp(rawConfidence * decay, 0, 1);
    const action = trend > 0.0012 ? ActionType.BUY : trend < -0.0012 ? ActionType.SELL : ActionType.HOLD;
    return { action, confidence, regime, modelVersion: this.version };
  }

  registerClosedTrade(trade: Trade): void {
    const version = trade.modelVersion || this.version;
    this.closedCountByVersion.set(version, (this.closedCountByVersion.get(version) || 0) + 1);
  }

  auditStability(candles: Candle[]): StabilityReport {
    const base = this.decide(candles);
    let deterministicOk = true;
    for (let i = 0; i < 100; i += 1) {
      const d = this.decide(candles);
      if (d.action !== base.action || Math.abs(d.confidence - base.confidence) > 1e-12) deterministicOk = false;
    }

    let perturbedMatches = 0;
    for (let i = 0; i < 20; i += 1) {
      const noisy = candles.map(c => ({ ...c, close: c.close * (1 + ((i % 2 === 0 ? 1 : -1) * 0.001)) }));
      const d = this.decide(noisy);
      if (d.action === base.action) perturbedMatches += 1;
    }

    const fragility: string[] = [];
    if (!deterministicOk) fragility.push('Non-deterministic output detected');
    if (perturbedMatches < 12) fragility.push('High sensitivity to ±0.1% noise');
    if (candles.length < 60) fragility.push('Insufficient history for robust regime audit');

    const score = clamp((deterministicOk ? 45 : 10) + (perturbedMatches / 20) * 35 + (candles.length >= 60 ? 20 : 5), 0, 100);
    return { stabilityScore: score, fragility };
  }

  bumpVersion(): string {
    this.version = `rf-${Date.now()}`;
    return this.version;
  }
}
