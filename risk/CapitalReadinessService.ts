export interface ReadinessInput {
  noLookaheadBias: boolean;
  pnlValidated: boolean;
  slippageRealistic: boolean;
  websocketUptimePct: number;
  circuitBreakerFunctional: boolean;
  walkForwardProfitable: boolean;
  stressScenariosPassed: number;
  liquidityLimitsEnforced: boolean;
}

export interface ReadinessResult {
  score: number;
  passedChecks: string[];
  failedChecks: string[];
  stressResults: Record<string, boolean>;
}

export class CapitalReadinessService {
  runChecklist(input: ReadinessInput): ReadinessResult {
    const checks: Array<[string, boolean]> = [
      ['No lookahead bias', input.noLookaheadBias],
      ['PnL validated', input.pnlValidated],
      ['Slippage realistic', input.slippageRealistic],
      ['WebSocket uptime > 99%', input.websocketUptimePct > 99],
      ['Circuit breaker functional', input.circuitBreakerFunctional],
      ['Walk-forward OOS profitable', input.walkForwardProfitable],
      ['Stress scenarios passed', input.stressScenariosPassed >= 4],
      ['Liquidity impact limits enforced', input.liquidityLimitsEnforced],
    ];

    const passedChecks = checks.filter(([, ok]) => ok).map(([n]) => n);
    const failedChecks = checks.filter(([, ok]) => !ok).map(([n]) => n);
    const score = Math.round((passedChecks.length / checks.length) * 100);

    const stressResults = {
      flashCrash5pct: input.stressScenariosPassed >= 1,
      orderRejection: input.stressScenariosPassed >= 2,
      websocketFailure: input.stressScenariosPassed >= 3,
      exchangeOutage: input.stressScenariosPassed >= 4,
    };

    return { score, passedChecks, failedChecks, stressResults };
  }
}
