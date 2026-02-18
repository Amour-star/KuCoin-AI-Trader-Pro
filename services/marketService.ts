import { Candle, MarketData, ConnectivityStatus } from '../types';

let currentConnectivity: ConnectivityStatus = 'CONNECTING';

export const getConnectivityStatus = () => currentConnectivity;

const lastKnownPrices: Record<string, number> = {};
const lastKnownVolumes: Record<string, number> = {};
const lastKnownChanges: Record<string, number> = {};

export const mockMarketData: MarketData[] = [
  { symbol: 'BTC-USDT', price: 64230.5, volume24h: 1542000000, change24h: 2.4 },
  { symbol: 'ETH-USDT', price: 3450.12, volume24h: 840000000, change24h: -1.2 },
  { symbol: 'SOL-USDT', price: 145.6, volume24h: 320000000, change24h: 5.7 },
  { symbol: 'BNB-USDT', price: 602.34, volume24h: 710000000, change24h: 1.1 },
  { symbol: 'XRP-USDT', price: 0.62, volume24h: 210000000, change24h: 1.1 },
];

for (const m of mockMarketData) {
  lastKnownPrices[m.symbol] = m.price;
  lastKnownVolumes[m.symbol] = m.volume24h;
  lastKnownChanges[m.symbol] = m.change24h;
}

const BINANCE_API = 'https://api.binance.com';

const asNumber = (value: unknown, fallback: number = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toBinanceSymbol = (symbol: string): string => symbol.replace('-', '').toUpperCase();
const fromBinanceSymbol = (symbol: string): string => symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}-USDT` : symbol;

const isHotTradableUsdtSpot = (binanceSymbol: string): boolean => {
  if (!binanceSymbol.endsWith('USDT')) return false;
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

const calculateIndicators = (candles: Candle[]): Candle[] => {
  const emaShortPeriod = 9;
  const emaLongPeriod = 21;
  const rsiPeriod = 14;

  const result = candles.map(c => ({ ...c }));

  for (let i = 0; i < result.length; i++) {
    if (i >= emaShortPeriod - 1) {
      const slice = result.slice(i - emaShortPeriod + 1, i + 1);
      const sum = slice.reduce((acc, val) => acc + val.close, 0);
      result[i].emaShort = sum / emaShortPeriod;
    }
    if (i >= emaLongPeriod - 1) {
      const slice = result.slice(i - emaLongPeriod + 1, i + 1);
      const sum = slice.reduce((acc, val) => acc + val.close, 0);
      result[i].emaLong = sum / emaLongPeriod;
    }
  }

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= rsiPeriod; i++) {
    if (i < result.length) {
      const diff = result[i].close - result[i - 1].close;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
  }

  if (result.length > rsiPeriod) {
    let avgGain = gains / rsiPeriod;
    let avgLoss = losses / rsiPeriod;
    for (let i = rsiPeriod + 1; i < result.length; i++) {
      const diff = result[i].close - result[i - 1].close;
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (rsiPeriod - 1) + currentGain) / rsiPeriod;
      avgLoss = (avgLoss * (rsiPeriod - 1) + currentLoss) / rsiPeriod;
      const rs = avgGain / (avgLoss || 1);
      result[i].rsi = 100 - 100 / (1 + rs);
    }
  }

  return result;
};

const generateFallbackCandles = (symbol: string, count: number = 100): Candle[] => {
  const known = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 1000;
  const now = Date.now();
  const candles: Candle[] = [];

  let tempPrice = known;
  const history: number[] = [tempPrice];
  for (let i = 0; i < count - 1; i++) {
    tempPrice = tempPrice / (1 + (Math.random() - 0.5) * 0.01);
    history.unshift(tempPrice);
  }

  for (let i = 0; i < count; i++) {
    const time = now - (count - 1 - i) * 60 * 60 * 1000;
    const close = history[i];
    const open = i > 0 ? history[i - 1] : close;
    const high = Math.max(open, close) * (1 + Math.random() * 0.004);
    const low = Math.min(open, close) * (1 - Math.random() * 0.004);
    candles.push({
      timestamp: time,
      time: new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      open,
      high,
      low,
      close,
      volume: Math.random() * 5000 + 1000,
    });
  }

  return calculateIndicators(candles);
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
      .filter(ticker => isHotTradableUsdtSpot(ticker.symbol))
      .map(ticker => {
        const symbol = fromBinanceSymbol(ticker.symbol);
        const price = asNumber(ticker.lastPrice);
        const volume24h = asNumber(ticker.quoteVolume);
        const change24h = asNumber(ticker.priceChangePercent);
        return { symbol, price, volume24h, change24h };
      })
      .filter(t => t.price > 0 && t.volume24h > 0)
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 10);

    if (sorted.length === 0) throw new Error('No Binance top coins found');

    for (const t of sorted) {
      lastKnownPrices[t.symbol] = t.price;
      lastKnownVolumes[t.symbol] = t.volume24h;
      lastKnownChanges[t.symbol] = t.change24h;
    }

    currentConnectivity = 'REALTIME';
    return sorted;
  } catch {
    currentConnectivity = 'SIMULATED';
    return mockMarketData;
  }
};

export const fetchCandles = async (symbol: string): Promise<Candle[]> => {
  try {
    type KlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];

    const rows = await fetchBinanceJson<KlineRow[]>('/api/v3/klines', {
      symbol: toBinanceSymbol(symbol),
      interval: '1h',
      limit: 100,
    });

    if (!Array.isArray(rows) || rows.length === 0) throw new Error('Empty kline data');

    const candles: Candle[] = rows
      .map(row => {
        const ts = asNumber(row[0]);
        const open = asNumber(row[1]);
        const high = asNumber(row[2]);
        const low = asNumber(row[3]);
        const close = asNumber(row[4]);
        const volume = asNumber(row[5]);
        return {
          timestamp: ts,
          time: new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          open,
          high,
          low,
          close,
          volume,
        };
      })
      .filter(c => c.timestamp > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);

    if (candles.length === 0) throw new Error('Invalid kline payload');

    lastKnownPrices[symbol] = candles[candles.length - 1].close;
    currentConnectivity = 'REALTIME';
    return calculateIndicators(candles);
  } catch {
    currentConnectivity = 'SIMULATED';
    return generateFallbackCandles(symbol);
  }
};

export const fetchLatestTicker = async (symbol: string): Promise<MarketData | null> => {
  try {
    interface BinanceTicker24hSingle {
      symbol: string;
      lastPrice: string;
      quoteVolume: string;
      priceChangePercent: string;
    }

    const ticker = await fetchBinanceJson<BinanceTicker24hSingle>('/api/v3/ticker/24hr', {
      symbol: toBinanceSymbol(symbol),
    });

    const price = asNumber(ticker.lastPrice, lastKnownPrices[symbol] || 0);
    const volume24h = asNumber(ticker.quoteVolume, lastKnownVolumes[symbol] || 0);
    const change24h = asNumber(ticker.priceChangePercent, lastKnownChanges[symbol] || 0);

    if (!(price > 0)) throw new Error('Invalid latest price');

    lastKnownPrices[symbol] = price;
    lastKnownVolumes[symbol] = volume24h;
    lastKnownChanges[symbol] = change24h;
    currentConnectivity = 'REALTIME';

    return { symbol, price, volume24h, change24h };
  } catch {
    currentConnectivity = 'SIMULATED';
    const fallback = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 100;
    return {
      symbol,
      price: fallback,
      volume24h: lastKnownVolumes[symbol] || 1000000,
      change24h: lastKnownChanges[symbol] || 0,
    };
  }
};
