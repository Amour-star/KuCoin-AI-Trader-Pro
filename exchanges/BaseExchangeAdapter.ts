export interface NormalizedQuote {
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
}

export interface NormalizedOrderBook {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  timestamp: number;
}

export interface ExchangeOrderResult {
  orderId: string;
  exchange: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  status: 'FILLED' | 'REJECTED' | 'PARTIAL';
  latencyMs: number;
}

export interface ExchangeFees {
  maker: number;
  taker: number;
}

export interface BaseExchangeAdapter {
  readonly name: string;
  connect(): Promise<void>;
  getOrderBook(symbol: string, limit?: number): Promise<NormalizedOrderBook>;
  getBestBidAsk(symbol: string): Promise<NormalizedQuote>;
  placeOrder(symbol: string, side: 'BUY' | 'SELL', qty: number, price?: number): Promise<ExchangeOrderResult>;
  getFees(symbol: string): Promise<ExchangeFees>;
  getLatency(): Promise<number>;
}
