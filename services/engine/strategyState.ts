import { StrategyParameters, StrategyState, StrategySummary, StrategyVersionRecord } from '../../types';

const STRATEGY_STATE_KEY = 'strategy_state.json';
const MAX_HISTORY = 40;
const MAX_PARAMETER_CHANGE_PCT = 0.15;

export const DEFAULT_STRATEGY_PARAMETERS: StrategyParameters = {
  minScore: 0.68,
  atrMultiplier: 1.2,
  stopLossATR: 1.6,
  takeProfitATR: 2.4,
  maxRiskPerTradePct: 0.012,
  dailyMaxLossPct: 0.04,
  maxConcurrentTrades: 2,
  killSwitchLosses: 3,
  minAtrPct: 0.002,
  maxAtrPct: 0.03,
};

const canUseLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const buildInitialState = (): StrategyState => ({
  version: 'v1',
  parameters: { ...DEFAULT_STRATEGY_PARAMETERS },
  lastRefinementTime: null,
  history: [],
  warnings: [],
});

const parseVersionNumber = (version: string): number => {
  const numeric = Number(version.replace(/^v/i, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
};

const nextVersion = (currentVersion: string): string => `v${parseVersionNumber(currentVersion) + 1}`;

const boundedChange = (current: number, suggested: number): number => {
  const maxDelta = Math.abs(current) * MAX_PARAMETER_CHANGE_PCT;
  if (maxDelta === 0) return suggested;
  const minAllowed = current - maxDelta;
  const maxAllowed = current + maxDelta;
  return Math.max(minAllowed, Math.min(maxAllowed, suggested));
};

const sanitizeParameters = (raw: StrategyParameters): StrategyParameters => ({
  minScore: Math.max(0.5, Math.min(0.95, raw.minScore)),
  atrMultiplier: Math.max(0.6, Math.min(2.5, raw.atrMultiplier)),
  stopLossATR: Math.max(0.8, Math.min(3.5, raw.stopLossATR)),
  takeProfitATR: Math.max(1.2, Math.min(5, raw.takeProfitATR)),
  maxRiskPerTradePct: Math.max(0.003, Math.min(0.03, raw.maxRiskPerTradePct)),
  dailyMaxLossPct: Math.max(0.01, Math.min(0.1, raw.dailyMaxLossPct)),
  maxConcurrentTrades: Math.max(1, Math.min(5, Math.round(raw.maxConcurrentTrades))),
  killSwitchLosses: Math.max(2, Math.min(6, Math.round(raw.killSwitchLosses))),
  minAtrPct: Math.max(0.0008, Math.min(0.02, raw.minAtrPct)),
  maxAtrPct: Math.max(0.005, Math.min(0.08, raw.maxAtrPct)),
});

export const loadStrategyState = (): StrategyState => {
  const fallback = buildInitialState();
  if (!canUseLocalStorage()) return fallback;

  try {
    const raw = window.localStorage.getItem(STRATEGY_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StrategyState>;

    const parameters = sanitizeParameters({
      ...DEFAULT_STRATEGY_PARAMETERS,
      ...(parsed.parameters || {}),
    });

    const history = Array.isArray(parsed.history) ? parsed.history : [];
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];

    return {
      version: typeof parsed.version === 'string' ? parsed.version : fallback.version,
      parameters,
      lastRefinementTime: typeof parsed.lastRefinementTime === 'number' ? parsed.lastRefinementTime : null,
      history: history.slice(0, MAX_HISTORY),
      warnings: warnings.filter((item): item is string => typeof item === 'string').slice(0, 20),
    };
  } catch {
    return fallback;
  }
};

export const saveStrategyState = (state: StrategyState): StrategyState => {
  const normalized: StrategyState = {
    ...state,
    parameters: sanitizeParameters(state.parameters),
    history: state.history.slice(0, MAX_HISTORY),
    warnings: state.warnings.slice(0, 20),
  };

  if (canUseLocalStorage()) {
    window.localStorage.setItem(STRATEGY_STATE_KEY, JSON.stringify(normalized));
  }

  return normalized;
};

export const getStrategySummary = (): StrategySummary => {
  const state = loadStrategyState();
  return {
    version: state.version,
    lastRefinementTime: state.lastRefinementTime,
    warnings: state.warnings,
  };
};

export const buildCandidateParameters = (
  base: StrategyParameters,
  suggested: Partial<Pick<StrategyParameters, 'minScore' | 'atrMultiplier' | 'stopLossATR'>>,
): StrategyParameters => {
  const next: StrategyParameters = {
    ...base,
    minScore: suggested.minScore !== undefined ? boundedChange(base.minScore, suggested.minScore) : base.minScore,
    atrMultiplier:
      suggested.atrMultiplier !== undefined
        ? boundedChange(base.atrMultiplier, suggested.atrMultiplier)
        : base.atrMultiplier,
    stopLossATR:
      suggested.stopLossATR !== undefined
        ? boundedChange(base.stopLossATR, suggested.stopLossATR)
        : base.stopLossATR,
  };

  return sanitizeParameters(next);
};

export const commitStrategyParameters = (
  parameters: StrategyParameters,
  notes: string[],
  timestamp: number = Date.now(),
): StrategyState => {
  const current = loadStrategyState();
  const newVersion = nextVersion(current.version);
  const record: StrategyVersionRecord = {
    version: newVersion,
    timestamp,
    parameters: { ...parameters },
    notes,
  };

  const updated: StrategyState = {
    version: newVersion,
    parameters: sanitizeParameters(parameters),
    lastRefinementTime: timestamp,
    history: [record, ...current.history].slice(0, MAX_HISTORY),
    warnings: current.warnings.slice(0, 20),
  };

  return saveStrategyState(updated);
};

export const updateStrategyWarnings = (warnings: string[]): StrategyState => {
  const current = loadStrategyState();
  return saveStrategyState({
    ...current,
    warnings: warnings.slice(0, 20),
  });
};
