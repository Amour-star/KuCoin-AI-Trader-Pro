import { Candle } from '../types.ts';
import { coreEventBus } from './EventBus.ts';
import { getKlines } from '../services/marketService.ts';

interface StreamConfig {
  symbols: string[];
  interval: string;
  maxBuffer: number;
}

type Handler = (symbol: string, candle: Candle) => Promise<void> | void;

const toWsSymbol = (s: string): string => s.replace('-', '').toLowerCase();
const wsUrl = (symbol: string, interval: string): string => `wss://stream.binance.com:9443/ws/${toWsSymbol(symbol)}@kline_${interval}`;

export class MarketStreamService {
  private readonly buffers = new Map<string, Candle[]>();
  private readonly sockets = new Map<string, WebSocket>();
  private readonly reconnectAttempt = new Map<string, number>();
  private readonly heartbeat = new Map<string, number>();
  private readonly unstableSymbols = new Set<string>();

  constructor(private readonly cfg: StreamConfig, private readonly onClosedKline: Handler) {}

  getBuffer(symbol: string): Candle[] {
    return this.buffers.get(symbol) || [];
  }

  isUnstable(symbol: string): boolean {
    return this.unstableSymbols.has(symbol);
  }

  async bootstrap(): Promise<void> {
    await Promise.all(this.cfg.symbols.map(async symbol => {
      try {
        const init = await getKlines(symbol, this.cfg.interval, Math.min(this.cfg.maxBuffer, 500));
        this.buffers.set(symbol, init.map(k => ({
          time: new Date(k.time).toISOString(),
          timestamp: k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        })));
      } catch (error) {
        console.error(`[market-stream] bootstrap failed for ${symbol}`, error);
        this.buffers.set(symbol, []);
      }
      this.connect(symbol);
    }));
  }

  shutdown(): void {
    for (const [, ws] of this.sockets) ws.close();
    this.sockets.clear();
    for (const [, timer] of this.heartbeat) clearInterval(timer);
    this.heartbeat.clear();
  }

  private connect(symbol: string): void {
    const ws = new WebSocket(wsUrl(symbol, this.cfg.interval));
    this.sockets.set(symbol, ws);
    let lastMessage = Date.now();

    ws.onmessage = event => {
      lastMessage = Date.now();
      const payload = JSON.parse(event.data as string) as { E: number; k: any };
      if (!payload.k?.x) return;
      const k = payload.k;
      const closedTs = Number(k.T);
      const candle: Candle = {
        time: new Date(Number(k.t)).toISOString(),
        timestamp: Number(k.t),
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v),
      };
      this.push(symbol, candle);
      const lagMs = Date.now() - closedTs;
      coreEventBus.emit('market:update', { symbol, lagMs, candleCloseTs: closedTs, close: candle.close });
      void this.onClosedKline(symbol, candle);
    };

    ws.onclose = () => {
      this.unstableSymbols.add(symbol);
      this.scheduleReconnect(symbol);
      void this.fallbackRefresh(symbol);
    };

    ws.onerror = () => {
      this.unstableSymbols.add(symbol);
      ws.close();
    };

    const hb = setInterval(() => {
      if (Date.now() - lastMessage > 20_000) {
        this.unstableSymbols.add(symbol);
        ws.close();
      }
    }, 5000);
    this.heartbeat.set(symbol, hb as unknown as number);
  }

  private async fallbackRefresh(symbol: string): Promise<void> {
    try {
      const rest = await getKlines(symbol, this.cfg.interval, 20);
      for (const k of rest) {
        this.push(symbol, {
          time: new Date(k.time).toISOString(),
          timestamp: k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        });
      }
    } catch (error) {
      console.error(`[market-stream] fallback refresh failed for ${symbol}`, error);
    }
  }

  private scheduleReconnect(symbol: string): void {
    const attempt = (this.reconnectAttempt.get(symbol) || 0) + 1;
    this.reconnectAttempt.set(symbol, attempt);
    const backoff = Math.min(30_000, 500 * 2 ** attempt);
    setTimeout(() => this.connect(symbol), backoff);
  }

  private push(symbol: string, candle: Candle): void {
    const current = this.buffers.get(symbol) || [];
    if (current.length > 0 && current[current.length - 1].timestamp === candle.timestamp) {
      current[current.length - 1] = candle;
    } else {
      current.push(candle);
    }
    if (current.length > this.cfg.maxBuffer) {
      current.splice(0, current.length - this.cfg.maxBuffer);
    }
    this.buffers.set(symbol, current);
  }
}
