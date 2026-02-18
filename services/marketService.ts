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
  { symbol: 'KCS-USDT', price: 10.45, volume24h: 4500000, change24h: 0.5 },
  { symbol: 'XRP-USDT', price: 0.62, volume24h: 210000000, change24h: 1.1 },
];

for (const m of mockMarketData) {
  lastKnownPrices[m.symbol] = m.price;
  lastKnownVolumes[m.symbol] = m.volume24h;
  lastKnownChanges[m.symbol] = m.change24h;
}

type KucoinBase = 'dev-proxy' | 'direct' | 'cors-proxy';

const KUCOIN_ORIGIN = 'https://api.kucoin.com';
const KUCOIN_BASES: KucoinBase[] = ['dev-proxy', 'direct', 'cors-proxy'];

const buildKucoinUrl = (
  base: KucoinBase,
  path: string,
  params?: Record<string, string | number | undefined>
): string => {
  const query = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) query.set(key, String(value));
    }
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';

  if (base === 'dev-proxy') return `/kucoin-api${path}${suffix}`;
  if (base === 'direct') return `${KUCOIN_ORIGIN}${path}${suffix}`;
  return `https://corsproxy.io/?${encodeURIComponent(`${KUCOIN_ORIGIN}${path}${suffix}`)}`;
};

const fetchWithTimeout = async (url: string, timeoutMs: number = 12000): Promise<Response> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
};

const fetchKucoinData = async <T>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> => {
  let lastError: unknown = null;

  for (const base of KUCOIN_BASES) {
    const url = buildKucoinUrl(base, path, params);
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${base}`);

      const payload = await res.json();
      if (payload?.code && payload.code !== '200000') {
        throw new Error(`KuCoin error ${payload.code} from ${base}`);
      }
      if (payload?.data === undefined) {
        throw new Error(`Invalid KuCoin payload from ${base}`);
      }
      return payload.data as T;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to fetch KuCoin data from all sources');
};

const asNumber = (value: unknown, fallback: number = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const isHotTradableUsdtSpot = (symbol: string): boolean => {
  if (!symbol.endsWith('-USDT')) return false;
  const base = symbol.split('-')[0];
  const blockedSuffixes = ['3L', '3S', '5L', '5S', 'UP', 'DOWN', 'BULL', 'BEAR'];
  return !blockedSuffixes.some(sfx => base.endsWith(sfx));
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
  const changes: number[] = [];

  for (let i = 0; i < count; i++) {
    changes.push((Math.random() - 0.5) * 0.01);
  }

  let tempPrice = known;
  const history: number[] = [tempPrice];
  for (let i = 0; i < count - 1; i++) {
    tempPrice = tempPrice / (1 + changes[i]);
    history.unshift(tempPrice);
  }

  for (let i = 0; i < count; i++) {
    const time = now - (count - 1 - i) * 60 * 60 * 1000;
    const close = history[i];
    const open = i > 0 ? history[i - 1] : close * (1 + (Math.random() - 0.5) * 0.01);
    const high = Math.max(open, close) * (1 + Math.random() * 0.005);
    const low = Math.min(open, close) * (1 - Math.random() * 0.005);

    candles.push({
      time: new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: time,
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
    type AllTickersData = { ticker: any[] };
    const data = await fetchKucoinData<AllTickersData>('/api/v1/market/allTickers');
    const tickers = Array.isArray(data?.ticker) ? data.ticker : [];

    const sorted = tickers
      .filter((t: any) => isHotTradableUsdtSpot(t.symbol))
      .map((t: any) => {
        const symbol = String(t.symbol);
        const price = asNumber(t.last);
        const volume24h = asNumber(t.volValue);
        const change24h = asNumber(t.changeRate) * 100;

        return { symbol, price, volume24h, change24h };
      })
      .filter((t: MarketData) => t.price > 0 && t.volume24h > 0)
      .sort((a: MarketData, b: MarketData) => b.volume24h - a.volume24h)
      .slice(0, 10);

    if (sorted.length === 0) throw new Error('No KuCoin top coins found');

    for (const t of sorted) {
      lastKnownPrices[t.symbol] = t.price;
      lastKnownVolumes[t.symbol] = t.volume24h;
      lastKnownChanges[t.symbol] = t.change24h;
    }

    currentConnectivity = 'REALTIME';
    return sorted;
  } catch {
    currentConnectivity = 'SIMULATED';
    for (const m of mockMarketData) {
      lastKnownPrices[m.symbol] = m.price;
      lastKnownVolumes[m.symbol] = m.volume24h;
      lastKnownChanges[m.symbol] = m.change24h;
    }
    return mockMarketData;
  }
};

export const fetchCandles = async (symbol: string): Promise<Candle[]> => {
  try {
    type CandleRow = [string, string, string, string, string, string, string];
    const rows = await fetchKucoinData<CandleRow[]>('/api/v1/market/candles', {
      type: '1hour',
      symbol,
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Empty candle data');
    }

    const parsed = rows
      .map(row => {
        const ts = asNumber(row[0]) * 1000;
        const open = asNumber(row[1]);
        const close = asNumber(row[2]);
        const high = asNumber(row[3]);
        const low = asNumber(row[4]);
        const volume = asNumber(row[5]);
        return { ts, open, close, high, low, volume };
      })
      .filter(c => c.ts > 0 && c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0)
      .sort((a, b) => a.ts - b.ts)
      .slice(-100);

    if (parsed.length === 0) throw new Error('Invalid candle payload');

    const candles: Candle[] = parsed.map(c => ({
      timestamp: c.ts,
      time: new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

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
    type StatsData = {
      last: string;
      volValue: string;
      changeRate: string;
    };

    const stats = await fetchKucoinData<StatsData>('/api/v1/market/stats', { symbol });
    const price = asNumber(stats?.last, lastKnownPrices[symbol] || 0);
    const volume24h = asNumber(stats?.volValue, lastKnownVolumes[symbol] || 0);
    const change24h = asNumber(stats?.changeRate, (lastKnownChanges[symbol] || 0) / 100) * 100;

    if (!(price > 0)) throw new Error('Invalid latest price');

    lastKnownPrices[symbol] = price;
    lastKnownVolumes[symbol] = volume24h;
    lastKnownChanges[symbol] = change24h;
    currentConnectivity = 'REALTIME';

    return {
      symbol,
      price,
      volume24h,
      change24h,
    };
  } catch {
    currentConnectivity = 'SIMULATED';
    const prevPrice = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 100;
    const volatility = 0.002;
    const change = (Math.random() - 0.5) * volatility * prevPrice;
    const newPrice = prevPrice + change;
    lastKnownPrices[symbol] = newPrice;

    return {
      symbol,
      price: newPrice,
      volume24h: lastKnownVolumes[symbol] || 1000000,
      change24h: lastKnownChanges[symbol] || 0,
    };
  }
};

