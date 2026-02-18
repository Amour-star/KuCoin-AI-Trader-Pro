export interface RLState {
  volatility: number;
  confidence: number;
  drawdown: number;
  recentWinRate: number;
  exposure: number;
  imbalanceScore: number;
  lossStreak: number;
}

export interface RLDecision {
  multiplier: number;
  policyVersion: string;
  mode: 'SIMULATION' | 'LIVE_ADAPTIVE';
}

export class RLPositionSizingEngine {
  private policyVersion = `rl-${Date.now()}`;
  private q = new Map<string, number>();

  private key(state: RLState, action: number): string {
    return [state.volatility.toFixed(2), state.confidence.toFixed(2), state.drawdown.toFixed(2), state.recentWinRate.toFixed(2), state.exposure.toFixed(2), state.imbalanceScore.toFixed(2), state.lossStreak, action.toFixed(2)].join('|');
  }

  decide(state: RLState, mode: 'SIMULATION' | 'LIVE_ADAPTIVE' = 'LIVE_ADAPTIVE'): RLDecision {
    const actions = [0.5, 0.75, 1, 1.25, 1.5];
    let best = 1;
    let bestQ = -Infinity;
    for (const a of actions) {
      const penalized = state.lossStreak >= 2 ? Math.min(a, 1) : a;
      const q = this.q.get(this.key(state, penalized)) ?? 0;
      if (q > bestQ) {
        bestQ = q;
        best = penalized;
      }
    }

    if (state.drawdown > 0.08 || state.exposure > 0.7) best = Math.min(best, 0.75);
    if (state.confidence < 0.45) best = Math.min(best, 0.7);
    return { multiplier: best, policyVersion: this.policyVersion, mode };
  }

  learn(state: RLState, action: number, pnl: number, drawdownPenalty: number): void {
    const reward = pnl - drawdownPenalty;
    const k = this.key(state, action);
    const prev = this.q.get(k) ?? 0;
    this.q.set(k, prev * 0.9 + reward * 0.1);
  }
}
