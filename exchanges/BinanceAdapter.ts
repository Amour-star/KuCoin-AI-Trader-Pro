import { BaseExchangeAdapter, ExchangeFees, ExchangeOrderResult, NormalizedOrderBook, NormalizedQuote } from './BaseExchangeAdapter.ts';

const toPair = (symbol: string): string => symbol.replace('-', '').toUpperCase();

export class BinanceAdapter implements BaseExchangeAdapter {
  readonly name = 'BINANCE';

  async connect(): Promise<void> {
    await fetch('https://api.binance.com/api/v3/ping');
  }

  async getOrderBook(symbol: string, limit: number = 20): Promise<NormalizedOrderBook> {
    const start = performance.now();
    const res = await fetch(`https://api.binance.com/api/v3/depth?symbol=${toPair(symbol)}&limit=${limit}`);
    const json = await res.json() as { bids: string[][]; asks: string[][]; lastUpdateId: number };
    const parse = (rows: string[][]) => rows.map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    const _lat = performance.now() - start;
    return { bids: parse(json.bids), asks: parse(json.asks), timestamp: Date.now() };
  }

  async getBestBidAsk(symbol: string): Promise<NormalizedQuote> {
    const ob = await this.getOrderBook(symbol, 5);
    const bid = ob.bids[0]?.[0] || 0;
    const ask = ob.asks[0]?.[0] || 0;
    return { bid, ask, spread: Math.max(0, ask - bid), timestamp: ob.timestamp };
  }

  async placeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price?: number): Promise<ExchangeOrderResult> {
    const t0 = performance.now();
    const quote = await this.getBestBidAsk(symbol);
    const fill = side === 'BUY' ? quote.ask : quote.bid;
    const latencyMs = performance.now() - t0;
    return {
      orderId: `paper-binance-${Date.now()}`,
      exchange: this.name,
      symbol,
      side,
      qty,
      price: price ?? fill,
      status: 'FILLED',
      latencyMs,
    };
  }

  async getFees(_symbol: string): Promise<ExchangeFees> {
    return { maker: 0.001, taker: 0.001 };
  }

  async getLatency(): Promise<number> {
    const t0 = performance.now();
    await fetch('https://api.binance.com/api/v3/time');
    return performance.now() - t0;
  }
}
