import { Candle, MarketData, ConnectivityStatus } from '../types';
import ccxt from 'ccxt';

// --- CCXT Setup ---
let exchange: any = null;
let currentConnectivity: ConnectivityStatus = 'CONNECTING';

export const getConnectivityStatus = () => currentConnectivity;

const getExchange = () => {
  if (!exchange) {
    exchange = new ccxt.kucoin({
      proxy: 'https://corsproxy.io/?', 
      enableRateLimit: true,
      timeout: 10000,
    });
  }
  return exchange;
};

const lastKnownPrices: Record<string, number> = {};

export const mockMarketData: MarketData[] = [
    { symbol: 'BTC-USDT', price: 64230.50, volume24h: 1542000000, change24h: 2.4 },
    { symbol: 'ETH-USDT', price: 3450.12, volume24h: 840000000, change24h: -1.2 },
    { symbol: 'SOL-USDT', price: 145.60, volume24h: 320000000, change24h: 5.7 },
    { symbol: 'KCS-USDT', price: 10.45, volume24h: 4500000, change24h: 0.5 },
    { symbol: 'XRP-USDT', price: 0.62, volume24h: 210000000, change24h: 1.1 },
];

mockMarketData.forEach(m => {
    lastKnownPrices[m.symbol] = m.price;
});

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
     if(i < result.length) {
         const diff = result[i].close - result[i-1].close;
         if (diff > 0) gains += diff;
         else losses -= diff;
     }
  }
  if (result.length > rsiPeriod) {
      let avgGain = gains / rsiPeriod;
      let avgLoss = losses / rsiPeriod;
      for (let i = rsiPeriod + 1; i < result.length; i++) {
          const diff = result[i].close - result[i-1].close;
          const currentGain = diff > 0 ? diff : 0;
          const currentLoss = diff < 0 ? -diff : 0;
          avgGain = (avgGain * (rsiPeriod - 1) + currentGain) / rsiPeriod;
          avgLoss = (avgLoss * (rsiPeriod - 1) + currentLoss) / rsiPeriod;
          const rs = avgGain / (avgLoss || 1);
          result[i].rsi = 100 - (100 / (1 + rs));
      }
  }
  return result;
};

const generateFallbackCandles = (symbol: string, count: number = 100): Candle[] => {
    const known = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 1000;
    const now = Date.now();
    const candles: Candle[] = [];
    let currentPrice = known;
    const changes: number[] = [];
    for(let i=0; i<count; i++) {
        changes.push((Math.random() - 0.5) * 0.01);
    }
    let tempPrice = currentPrice;
    const history: number[] = [tempPrice];
    for(let i=0; i<count-1; i++) {
        tempPrice = tempPrice / (1 + changes[i]);
        history.unshift(tempPrice);
    }
    for (let i = 0; i < count; i++) {
        const time = now - (count - 1 - i) * 60 * 60 * 1000;
        const close = history[i];
        const open = i > 0 ? history[i-1] : close * (1 + (Math.random() - 0.5) * 0.01);
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
    const ex = getExchange();
    const tickers = await ex.fetchTickers();
    const sorted = Object.values(tickers)
      .filter((t: any) => t.symbol.endsWith('/USDT'))
      .sort((a: any, b: any) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
      .slice(0, 5)
      .map((t: any) => {
        const symbol = t.symbol.replace('/', '-');
        lastKnownPrices[symbol] = t.last;
        return {
          symbol,
          price: t.last,
          volume24h: t.quoteVolume,
          change24h: t.percentage
        };
      });
    currentConnectivity = 'REALTIME';
    return sorted;
  } catch (error) {
    currentConnectivity = 'SIMULATED';
    mockMarketData.forEach(m => lastKnownPrices[m.symbol] = m.price);
    return mockMarketData;
  }
};

export const fetchCandles = async (symbol: string): Promise<Candle[]> => {
  try {
    const ex = getExchange();
    const formattedSymbol = symbol.replace('-', '/');
    const ohlcv = await ex.fetchOHLCV(formattedSymbol, '1h', undefined, 100);
    if (!ohlcv || ohlcv.length === 0) throw new Error("Empty OHLCV data");
    const candles: Candle[] = ohlcv.map((c: any) => ({
      timestamp: c[0],
      time: new Date(c[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5]
    }));
    if (candles.length > 0) lastKnownPrices[symbol] = candles[candles.length - 1].close;
    currentConnectivity = 'REALTIME';
    return calculateIndicators(candles);
  } catch (error) {
    currentConnectivity = 'SIMULATED';
    return generateFallbackCandles(symbol);
  }
};

export const fetchLatestTicker = async (symbol: string): Promise<MarketData | null> => {
  try {
    const ex = getExchange();
    const formattedSymbol = symbol.replace('-', '/');
    const ticker = await ex.fetchTicker(formattedSymbol);
    lastKnownPrices[symbol] = ticker.last;
    currentConnectivity = 'REALTIME';
    return {
      symbol: symbol,
      price: ticker.last,
      volume24h: ticker.quoteVolume,
      change24h: ticker.percentage
    };
  } catch (error) {
    currentConnectivity = 'SIMULATED';
    const prevPrice = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 100;
    const volatility = 0.002;
    const change = (Math.random() - 0.5) * volatility * prevPrice;
    const newPrice = prevPrice + change;
    lastKnownPrices[symbol] = newPrice;
    return {
      symbol: symbol,
      price: newPrice,
      volume24h: 1000000,
      change24h: 0
    };
  }
};