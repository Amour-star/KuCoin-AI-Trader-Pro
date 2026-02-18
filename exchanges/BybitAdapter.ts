import { BaseExchangeAdapter, ExchangeFees, ExchangeOrderResult, NormalizedOrderBook, NormalizedQuote } from './BaseExchangeAdapter.ts';

const toPair = (symbol: string): string => symbol.replace('-', '').toUpperCase();

export class BybitAdapter implements BaseExchangeAdapter {
  readonly name = 'BYBIT';

  async connect(): Promise<void> {
    await fetch('https://api.bybit.com/v5/market/time');
  }

  async getOrderBook(symbol: string): Promise<NormalizedOrderBook> {
    const res = await fetch(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${toPair(symbol)}&limit=25`);
    const json = await res.json() as { result?: { b?: string[][]; a?: string[][]; ts?: number } };
    const bids = (json.result?.b || []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    const asks = (json.result?.a || []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    return { bids, asks, timestamp: Number(json.result?.ts || Date.now()) };
  }

  async getBestBidAsk(symbol: string): Promise<NormalizedQuote> {
    const ob = await this.getOrderBook(symbol);
    const bid = ob.bids[0]?.[0] || 0;
    const ask = ob.asks[0]?.[0] || 0;
    return { bid, ask, spread: Math.max(0, ask - bid), timestamp: ob.timestamp };
  }

  async placeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price?: number): Promise<ExchangeOrderResult> {
    const quote = await this.getBestBidAsk(symbol);
    return {
      orderId: `paper-bybit-${Date.now()}`,
      exchange: this.name,
      symbol,
      side,
      qty,
      price: price ?? (side === 'BUY' ? quote.ask : quote.bid),
      status: 'FILLED',
      latencyMs: Math.random() * 40 + 20,
    };
  }

  async getFees(_symbol: string): Promise<ExchangeFees> {
    return { maker: 0.001, taker: 0.001 };
  }

  async getLatency(): Promise<number> {
    const t0 = performance.now();
    await fetch('https://api.bybit.com/v5/market/time');
    return performance.now() - t0;
  }
}
