import { BaseExchangeAdapter, ExchangeFees, ExchangeOrderResult, NormalizedOrderBook, NormalizedQuote } from './BaseExchangeAdapter.ts';

const toPair = (symbol: string): string => symbol.replace('-', '-').toUpperCase();

export class KuCoinAdapter implements BaseExchangeAdapter {
  readonly name = 'KUCOIN';

  async connect(): Promise<void> {
    await fetch('https://api.kucoin.com/api/v1/timestamp');
  }

  async getOrderBook(symbol: string): Promise<NormalizedOrderBook> {
    const res = await fetch(`https://api.kucoin.com/api/v1/market/orderbook/level2_20?symbol=${toPair(symbol)}`);
    const json = await res.json() as { data?: { bids: string[][]; asks: string[][]; time: number } };
    const bids = (json.data?.bids || []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    const asks = (json.data?.asks || []).map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    return { bids, asks, timestamp: Number(json.data?.time || Date.now()) };
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
      orderId: `paper-kucoin-${Date.now()}`,
      exchange: this.name,
      symbol,
      side,
      qty,
      price: price ?? (side === 'BUY' ? quote.ask : quote.bid),
      status: 'FILLED',
      latencyMs: Math.random() * 30 + 20,
    };
  }

  async getFees(_symbol: string): Promise<ExchangeFees> {
    return { maker: 0.001, taker: 0.001 };
  }

  async getLatency(): Promise<number> {
    const t0 = performance.now();
    await fetch('https://api.kucoin.com/api/v1/timestamp');
    return performance.now() - t0;
  }
}
