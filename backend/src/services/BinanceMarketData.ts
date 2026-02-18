const BINANCE_BASE = 'https://api.binance.com';

export class BinanceMarketData {
  async getTickerPrice(symbol: string): Promise<number> {
    const response = await fetch(`${BINANCE_BASE}/api/v3/ticker/price?symbol=${symbol}`);
    if (!response.ok) throw new Error(`Ticker request failed: ${response.status}`);
    const payload = await response.json() as { price: string };
    return Number(payload.price);
  }
}
