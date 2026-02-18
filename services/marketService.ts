import { Candle, MarketData, ConnectivityStatus } from '../types';
import { SYMBOLS } from '../constants';

let currentConnectivity: ConnectivityStatus = 'CONNECTING';

export const getConnectivityStatus = () => currentConnectivity;

const lastKnownPrices: Record<string, number> = {};
const lastKnownVolumes: Record<string, number> = {};
const lastKnownChanges: Record<string, number> = {};

const BINANCE_API = 'https://api.binance.com';
const MIN_CANDLES_FOR_INDICATORS = 50;
const SUPPORTED_SYMBOLS_CACHE_TTL_MS = 10 * 60 * 1000;

type NormalizedKline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type KlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];

let supportedSymbolsCache: { fetchedAt: number; symbols: Set<string> } | null = null;

const asNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

const toBinanceSymbol = (symbol: string): string => symbol.replace('-', '').toUpperCase();
const fromBinanceSymbol = (symbol: string): string => (symbol.endsWith('USDC') ? `${symbol.slice(0, -4)}-USDC` : symbol);

const isHotTradableUsdcSpot = (binanceSymbol: string): boolean => {
  if (!binanceSymbol.endsWith('USDC')) return false;
  const base = binanceSymbol.slice(0, -4);
  const blockedSuffixes = ['UP', 'DOWN', 'BULL', 'BEAR', '1000'];
  return base.length > 1 && !blockedSuffixes.some(sfx => base.endsWith(sfx));
};

const fetchWithTimeout = async (url: string, timeoutMs: number = 12000): Promise<Response> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

const fetchBinanceJson = async <T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> => {
  const query = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
  }

  const url = `${BINANCE_API}${path}${query.toString() ? `?${query.toString()}` : ''}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  return (await res.json()) as T;
};

const calculateEmaSeries = (values: number[], period: number): Array<number | undefined> => {
  const multiplier = 2 / (period + 1);
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length < period) return out;

  let ema = values.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i += 1) {
    ema = (values[i] - ema) * multiplier + ema;
    out[i] = ema;
  }
  return out;
};

const calculateRsiSeries = (values: number[], period: number): Array<number | undefined> => {
  const out: Array<number | undefined> = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    const rs = avgGain / (avgLoss || 1e-8);
    out[i] = 100 - (100 / (1 + rs));
  }

  return out;
};

const calculateAtrSeries = (candles: Candle[], period: number): Array<number | undefined> => {
  const out: Array<number | undefined> = new Array(candles.length).fill(undefined);
  if (candles.length < period + 1) return out;
  const trs: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
    trs.push(tr);
  }

  for (let i = period; i < trs.length; i += 1) {
    const window = trs.slice(i - period, i);
    out[i + 1] = window.reduce((sum, v) => sum + v, 0) / period;
  }

  return out;
};

const calculateIndicators = (candles: Candle[]): Candle[] => {
  if (candles.length < MIN_CANDLES_FOR_INDICATORS) {
    console.warn(`[market-data] ${candles[0]?.time ?? 'n/a'} insufficient candles (${candles.length}) for indicators; need ${MIN_CANDLES_FOR_INDICATORS}.`);
    return candles;
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const emaShort = calculateEmaSeries(closes, 9);
  const emaLong = calculateEmaSeries(closes, 21);
  const ema12 = calculateEmaSeries(closes, 12);
  const ema26 = calculateEmaSeries(closes, 26);
  const rsi = calculateRsiSeries(closes, 14);
  const atr = calculateAtrSeries(candles, 14);

  const macdLine = closes.map((_, idx) => {
    const fast = ema12[idx];
    const slow = ema26[idx];
    return typeof fast === 'number' && typeof slow === 'number' ? fast - slow : undefined;
  });
  const macdSignal = calculateEmaSeries(macdLine.map(v => v ?? 0), 9);

  return candles.map((candle, idx) => {
    const volumeSma20 = idx >= 19 ? volumes.slice(idx - 19, idx + 1).reduce((sum, v) => sum + v, 0) / 20 : undefined;
    return {
      ...candle,
      emaShort: emaShort[idx],
      emaLong: emaLong[idx],
      rsi: rsi[idx],
      atr: atr[idx],
      macd: macdLine[idx],
      macdSignal: macdSignal[idx],
      macdHistogram: typeof macdLine[idx] === 'number' && typeof macdSignal[idx] === 'number' ? macdLine[idx]! - macdSignal[idx]! : undefined,
      volumeSma20,
      volumeRatio: typeof volumeSma20 === 'number' && volumeSma20 > 0 ? candle.volume / volumeSma20 : undefined,
    };
  });
};

const getSupportedSymbols = async (): Promise<Set<string>> => {
  const now = Date.now();
  if (supportedSymbolsCache && (now - supportedSymbolsCache.fetchedAt < SUPPORTED_SYMBOLS_CACHE_TTL_MS)) {
    return supportedSymbolsCache.symbols;
  }

  interface ExchangeInfoResponse { symbols: Array<{ symbol: string; status: string; isSpotTradingAllowed: boolean }>; }
  const exchangeInfo = await fetchBinanceJson<ExchangeInfoResponse>('/api/v3/exchangeInfo');
  const symbols = new Set(
    exchangeInfo.symbols
      .filter(item => item.status === 'TRADING' && item.isSpotTradingAllowed)
      .map(item => item.symbol.toUpperCase()),
  );

  supportedSymbolsCache = { fetchedAt: now, symbols };
  return symbols;
};

const ensureSupportedUsdcPair = async (symbol: string): Promise<void> => {
  const binanceSymbol = toBinanceSymbol(symbol);
  const supported = await getSupportedSymbols();
  if (!supported.has(binanceSymbol)) {
    const message = `[market-data] Binance Spot does not support pair ${binanceSymbol}`;
    console.error(message);
    throw new Error(message);
  }
};

export const getKlines = async (symbol: string, interval: string = '1h', limit: number = 100): Promise<NormalizedKline[]> => {
  await ensureSupportedUsdcPair(symbol);
  const rows = await fetchBinanceJson<KlineRow[]>('/api/v3/klines', {
    symbol: toBinanceSymbol(symbol),
    interval,
    limit,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`[market-data] Empty kline payload for ${symbol}`);
  }

  const normalized = rows
    .map((row) => ({
      time: asNumber(row[0]),
      open: asNumber(row[1]),
      high: asNumber(row[2]),
      low: asNumber(row[3]),
      close: asNumber(row[4]),
      volume: asNumber(row[5]),
    }))
    .filter((row) => [row.time, row.open, row.high, row.low, row.close, row.volume].every(Number.isFinite));

  if (normalized.length === 0) {
    throw new Error(`[market-data] All kline rows invalid for ${symbol}`);
  }

  console.info(`[market-data] ${symbol} last close=${normalized[normalized.length - 1].close}`);
  return normalized;
};

export const fetchTopCoins = async (): Promise<MarketData[]> => {
  try {
    interface BinanceTicker24h {
      symbol: string;
      lastPrice: string;
      quoteVolume: string;
      priceChangePercent: string;
    }

    const tickers = await fetchBinanceJson<BinanceTicker24h[]>('/api/v3/ticker/24hr');
    const sorted = tickers
      .filter(ticker => isHotTradableUsdcSpot(ticker.symbol))
      .map(ticker => {
        const symbol = fromBinanceSymbol(ticker.symbol);
        const price = asNumber(ticker.lastPrice);
        const volume24h = asNumber(ticker.quoteVolume);
        const change24h = asNumber(ticker.priceChangePercent);
        return { symbol, price, volume24h, change24h };
      })
      .filter(t => Number.isFinite(t.price) && t.price > 0 && Number.isFinite(t.volume24h) && t.volume24h > 0)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 10);

    for (const t of sorted) {
      lastKnownPrices[t.symbol] = t.price;
      lastKnownVolumes[t.symbol] = t.volume24h;
      lastKnownChanges[t.symbol] = t.change24h;
    }

    currentConnectivity = sorted.length > 0 ? 'REALTIME' : 'SIMULATED';
    return sorted.length > 0 ? sorted : SYMBOLS.map(symbol => ({ symbol, price: lastKnownPrices[symbol] || 0, volume24h: 0, change24h: 0 }));
  } catch (error) {
    console.error('[market-data] Failed to fetch top USDC coins', error);
    currentConnectivity = 'SIMULATED';
    return SYMBOLS.map(symbol => ({ symbol, price: lastKnownPrices[symbol] || 0, volume24h: 0, change24h: 0 }));
  }
};

export const fetchCandles = async (symbol: string): Promise<Candle[]> => {
  try {
    const rows = await getKlines(symbol, '1h', 200);

    const candles: Candle[] = rows.map((row) => ({
      timestamp: row.time,
      time: new Date(row.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));

    if (candles.length === 0) throw new Error(`[market-data] No candles parsed for ${symbol}`);

    lastKnownPrices[symbol] = candles[candles.length - 1].close;
    currentConnectivity = 'REALTIME';
    return calculateIndicators(candles);
  } catch (error) {
    console.error(`[market-data] fetchCandles failed for ${symbol}`, error);
    currentConnectivity = 'SIMULATED';
    return [];
  }
};

export const fetchLatestTicker = async (symbol: string): Promise<MarketData | null> => {
  try {
    await ensureSupportedUsdcPair(symbol);

    interface BinanceTicker24hSingle {
      symbol: string;
      lastPrice: string;
      quoteVolume: string;
      priceChangePercent: string;
    }

    const ticker = await fetchBinanceJson<BinanceTicker24hSingle>('/api/v3/ticker/24hr', {
      symbol: toBinanceSymbol(symbol),
    });

    const price = asNumber(ticker.lastPrice);
    const volume24h = asNumber(ticker.quoteVolume);
    const change24h = asNumber(ticker.priceChangePercent);

    if (!(Number.isFinite(price) && price > 0)) throw new Error('Invalid latest price');

    lastKnownPrices[symbol] = price;
    lastKnownVolumes[symbol] = Number.isFinite(volume24h) ? volume24h : lastKnownVolumes[symbol] || 0;
    lastKnownChanges[symbol] = Number.isFinite(change24h) ? change24h : lastKnownChanges[symbol] || 0;
    currentConnectivity = 'REALTIME';

    return { symbol, price, volume24h: lastKnownVolumes[symbol] || 0, change24h: lastKnownChanges[symbol] || 0 };
  } catch (error) {
    console.error(`[market-data] fetchLatestTicker failed for ${symbol}`, error);
    currentConnectivity = 'SIMULATED';
    return null;
  }
};
