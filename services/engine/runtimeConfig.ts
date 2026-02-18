export type TradingMode = 'PAPER' | 'LIVE';

export interface RuntimeConfig {
  mode: TradingMode;
  timeframe: string;
  staleDataMs: number;
  minExpectedEdge: number;
  maxPositionSizePct: number;
  maxExposurePct: number;
  paperSlippageBps: number;
  paperFeeBps: number;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  mode: 'PAPER',
  timeframe: '1h',
  staleDataMs: 2 * 60 * 60 * 1000,
  minExpectedEdge: 0.0005,
  maxPositionSizePct: 0.25,
  maxExposurePct: 0.7,
  paperSlippageBps: 4,
  paperFeeBps: 10,
};

const env = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>;

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseMode = (value: string | undefined): TradingMode => {
  if (!value) return 'PAPER';
  return value.toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER';
};

export const getRuntimeConfig = (): RuntimeConfig => ({
  mode: parseMode(env.BOT_MODE),
  timeframe: env.BOT_TIMEFRAME || DEFAULT_CONFIG.timeframe,
  staleDataMs: parseNumber(env.BOT_STALE_DATA_MS, DEFAULT_CONFIG.staleDataMs),
  minExpectedEdge: parseNumber(env.BOT_MIN_EXPECTED_EDGE, DEFAULT_CONFIG.minExpectedEdge),
  maxPositionSizePct: parseNumber(env.BOT_MAX_POSITION_SIZE_PCT, DEFAULT_CONFIG.maxPositionSizePct),
  maxExposurePct: parseNumber(env.BOT_MAX_EXPOSURE_PCT, DEFAULT_CONFIG.maxExposurePct),
  paperSlippageBps: parseNumber(env.BOT_PAPER_SLIPPAGE_BPS, DEFAULT_CONFIG.paperSlippageBps),
  paperFeeBps: parseNumber(env.BOT_PAPER_FEE_BPS, DEFAULT_CONFIG.paperFeeBps),
});

export const validateRuntimeConfig = (config: RuntimeConfig = getRuntimeConfig()): string[] => {
  const errors: string[] = [];
  if (config.mode === 'LIVE') {
    const required = ['KUCOIN_API_KEY', 'KUCOIN_API_SECRET', 'KUCOIN_API_PASSPHRASE'];
    for (const key of required) {
      if (!env[key]) errors.push(`Missing required env var for LIVE mode: ${key}`);
    }
  }

  if (!(config.maxPositionSizePct > 0 && config.maxPositionSizePct <= 1)) {
    errors.push('BOT_MAX_POSITION_SIZE_PCT must be in range (0, 1].');
  }
  if (!(config.maxExposurePct > 0 && config.maxExposurePct <= 1)) {
    errors.push('BOT_MAX_EXPOSURE_PCT must be in range (0, 1].');
  }
  if (!(config.staleDataMs > 0)) {
    errors.push('BOT_STALE_DATA_MS must be > 0.');
  }

  return errors;
};
