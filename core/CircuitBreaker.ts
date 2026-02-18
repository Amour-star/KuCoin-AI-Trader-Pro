export interface CircuitConfig {
  maxDailyDrawdownPct: number;
  maxConsecutiveLargeLosses: number;
  volatilitySpikePct: number;
}

export interface CircuitState {
  halted: boolean;
  reasons: string[];
  manualResetRequired: boolean;
}

export class CircuitBreaker {
  private state: CircuitState = { halted: false, reasons: [], manualResetRequired: false };

  evaluate(input: {
    dailyDrawdownPct: number;
    consecutiveLargeLosses: number;
    volatilityPct: number;
    wsUnstable: boolean;
  }, cfg: CircuitConfig): CircuitState {
    const reasons: string[] = [];
    if (input.dailyDrawdownPct > cfg.maxDailyDrawdownPct) reasons.push('Daily drawdown exceeded');
    if (input.consecutiveLargeLosses >= cfg.maxConsecutiveLargeLosses) reasons.push('Consecutive large losses');
    if (input.volatilityPct > cfg.volatilitySpikePct) reasons.push('Volatility spike');
    if (input.wsUnstable) reasons.push('WebSocket unstable');

    if (reasons.length > 0) {
      this.state = { halted: true, reasons, manualResetRequired: true };
    }

    return this.state;
  }

  reset(): CircuitState {
    this.state = { halted: false, reasons: [], manualResetRequired: false };
    return this.state;
  }

  snapshot(): CircuitState {
    return this.state;
  }
}
