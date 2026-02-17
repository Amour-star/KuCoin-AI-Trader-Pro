import { Candle, MarketData } from '../types';
import ccxt from 'ccxt';

// --- CCXT Setup ---
let exchange: any = null;

const getExchange = () => {
  if (!exchange) {
    exchange = new ccxt.kucoin({
      // Using corsproxy.io. If this fails, the service falls back to simulation.
      proxy: 'https://corsproxy.io/?', 
      enableRateLimit: true,
      timeout: 5000, // Fail fast (5s) to switch to simulation
    });
  }
  return exchange;
};

// --- State for Fallbacks ---
// Keep track of last prices to provide smooth simulation if API fails
const lastKnownPrices: Record<string, number> = {};

// Fallback data
export const mockMarketData: MarketData[] = [
    { symbol: 'BTC-USDT', price: 64230.50, volume24h: 1542000000, change24h: 2.4 },
    { symbol: 'ETH-USDT', price: 3450.12, volume24h: 840000000, change24h: -1.2 },
    { symbol: 'SOL-USDT', price: 145.60, volume24h: 320000000, change24h: 5.7 },
    { symbol: 'KCS-USDT', price: 10.45, volume24h: 4500000, change24h: 0.5 },
    { symbol: 'XRP-USDT', price: 0.62, volume24h: 210000000, change24h: 1.1 },
];

// Initialize lastKnownPrices from mock data
mockMarketData.forEach(m => {
    lastKnownPrices[m.symbol] = m.price;
});

// --- Helper: Indicators ---
const calculateIndicators = (candles: Candle[]): Candle[] => {
  const emaShortPeriod = 9;
  const emaLongPeriod = 21;
  const rsiPeriod = 14;

  const result = candles.map(c => ({ ...c }));

  // EMAs
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

  // RSI
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

// --- Fallback Generators ---

const generateFallbackCandles = (symbol: string, count: number = 100): Candle[] => {
    // Determine a start price
    const known = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 1000;
    
    const now = Date.now();
    const candles: Candle[] = [];
    let currentPrice = known;
    
    // Generate backwards to build history ending at current price
    // We actually want the END of the array to be currentPrice.
    // So we need to work backwards from now.
    
    // Create an array of random changes
    const changes: number[] = [];
    for(let i=0; i<count; i++) {
        changes.push((Math.random() - 0.5) * 0.01);
    }
    
    // Reconstruct backwards from current price
    let tempPrice = currentPrice;
    const history: number[] = [tempPrice];
    
    for(let i=0; i<count-1; i++) {
        tempPrice = tempPrice / (1 + changes[i]); // Inverse operation roughly
        history.unshift(tempPrice);
    }
    
    // Build candles forward
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

// --- API Functions ---

export const fetchTopCoins = async (): Promise<MarketData[]> => {
  try {
    const ex = getExchange();
    // Fetch all tickers
    const tickers = await ex.fetchTickers();
    
    // Filter for USDT pairs, sort by quote volume (USDT volume)
    const sorted = Object.values(tickers)
      .filter((t: any) => t.symbol.endsWith('/USDT'))
      .sort((a: any, b: any) => (b.quoteVolume || 0) - (a.quoteVolume || 0))
      .slice(0, 5)
      .map((t: any) => {
        const symbol = t.symbol.replace('/', '-');
        lastKnownPrices[symbol] = t.last; // Cache price
        return {
          symbol,
          price: t.last,
          volume24h: t.quoteVolume,
          change24h: t.percentage
        };
      });
      
    return sorted;
  } catch (error) {
    console.info("Info: KuCoin API unreachable (timeout or proxy issue). Switching to Simulation Mode.");
    // Ensure mock data is in cache
    mockMarketData.forEach(m => lastKnownPrices[m.symbol] = m.price);
    return mockMarketData;
  }
};

export const fetchCandles = async (symbol: string): Promise<Candle[]> => {
  try {
    const ex = getExchange();
    const formattedSymbol = symbol.replace('-', '/');
    
    // Fetch 1h candles, last 100
    // ohlcv structure: [timestamp, open, high, low, close, volume]
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
    
    // Update cache with latest close
    if (candles.length > 0) {
        lastKnownPrices[symbol] = candles[candles.length - 1].close;
    }
    
    return calculateIndicators(candles);
  } catch (error) {
    console.debug(`Info: Fetch candles failed for ${symbol}. Generating simulation data.`);
    return generateFallbackCandles(symbol);
  }
};

export const fetchLatestTicker = async (symbol: string): Promise<MarketData | null> => {
  try {
    const ex = getExchange();
    const formattedSymbol = symbol.replace('-', '/');
    const ticker = await ex.fetchTicker(formattedSymbol);
    
    lastKnownPrices[symbol] = ticker.last;

    return {
      symbol: symbol,
      price: ticker.last,
      volume24h: ticker.quoteVolume,
      change24h: ticker.percentage
    };
  } catch (error) {
    // console.debug(`Info: Fetch ticker failed for ${symbol}. Using simulation.`);
    
    // Fallback Simulation logic
    const prevPrice = lastKnownPrices[symbol] || mockMarketData.find(m => m.symbol === symbol)?.price || 100;
    const volatility = 0.002; // 0.2% movement per tick
    const change = (Math.random() - 0.5) * volatility * prevPrice;
    const newPrice = prevPrice + change;
    
    lastKnownPrices[symbol] = newPrice;
    
    return {
      symbol: symbol,
      price: newPrice,
      volume24h: 1000000, // Placeholder
      change24h: 0 // Placeholder
    };
  }
};