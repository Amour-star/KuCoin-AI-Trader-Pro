export interface LatencyUpdate {
  exchange: string;
  symbol: string;
  bid: number;
  ask: number;
  serverTs: number;
  localReceiveTs: number;
}

export interface LatencyOpportunity {
  symbol: string;
  fastExchange: string;
  slowExchange: string;
  latencyMs: number;
  desyncWindowMs: number;
  spreadMagnitude: number;
  opportunityDurationMs: number;
  estimatedUnrealizedPnl: number;
}

export class LatencyArbitrageDetector {
  private last = new Map<string, LatencyUpdate>();
  private heatmap = new Map<string, number[]>();

  onUpdate(update: LatencyUpdate): LatencyOpportunity | null {
    const key = `${update.exchange}:${update.symbol}`;
    this.last.set(key, update);

    let best: LatencyOpportunity | null = null;
    for (const [otherKey, other] of this.last.entries()) {
      if (other.exchange === update.exchange || other.symbol !== update.symbol) continue;
      const latencyA = update.localReceiveTs - update.serverTs;
      const latencyB = other.localReceiveTs - other.serverTs;
      const faster = latencyA < latencyB ? update : other;
      const slower = latencyA < latencyB ? other : update;
      const desync = Math.abs(latencyA - latencyB);
      const spread = (faster.bid - slower.ask) / Math.max(slower.ask, 1);
      const heatKey = `${faster.exchange}->${slower.exchange}`;
      const values = this.heatmap.get(heatKey) || [];
      values.push(desync);
      if (values.length > 200) values.shift();
      this.heatmap.set(heatKey, values);

      if (desync > 10 && spread > 0) {
        best = {
          symbol: update.symbol,
          fastExchange: faster.exchange,
          slowExchange: slower.exchange,
          latencyMs: Math.min(latencyA, latencyB),
          desyncWindowMs: desync,
          spreadMagnitude: spread,
          opportunityDurationMs: desync,
          estimatedUnrealizedPnl: spread * 1000,
        };
      }
    }

    return best;
  }

  getLatencyHeatmap(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, values] of this.heatmap.entries()) {
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      out[key] = avg;
    }
    return out;
  }
}
