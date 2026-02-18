export interface Level2Snapshot {
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  timestamp: number;
}

export interface ImbalanceSignal {
  bidVolumeTopN: number;
  askVolumeTopN: number;
  imbalanceRatio: number;
  aggressiveImbalance: boolean;
  liquidityWallDetected: boolean;
  spoofingPatternDetected: boolean;
  directionalPressureScore: number;
}

const sumQty = (levels: Array<[number, number]>, topN: number): number => levels.slice(0, topN).reduce((acc, [, q]) => acc + q, 0);

export class OrderBookImbalanceModel {
  private prevSnapshots = new Map<string, Level2Snapshot>();

  evaluate(symbol: string, snapshot: Level2Snapshot, topN: number = 10): ImbalanceSignal {
    const bidVolumeTopN = sumQty(snapshot.bids, topN);
    const askVolumeTopN = sumQty(snapshot.asks, topN);
    const imbalanceRatio = (bidVolumeTopN - askVolumeTopN) / Math.max(bidVolumeTopN + askVolumeTopN, 1e-8);
    const aggressiveImbalance = Math.abs(imbalanceRatio) > 0.2;

    const maxBidWall = Math.max(...snapshot.bids.slice(0, topN).map(([, q]) => q), 0);
    const maxAskWall = Math.max(...snapshot.asks.slice(0, topN).map(([, q]) => q), 0);
    const liquidityWallDetected = maxBidWall > bidVolumeTopN * 0.25 || maxAskWall > askVolumeTopN * 0.25;

    const prev = this.prevSnapshots.get(symbol);
    let spoofingPatternDetected = false;
    if (prev) {
      const prevTopBid = prev.bids[0]?.[1] || 0;
      const currTopBid = snapshot.bids[0]?.[1] || 0;
      const prevTopAsk = prev.asks[0]?.[1] || 0;
      const currTopAsk = snapshot.asks[0]?.[1] || 0;
      spoofingPatternDetected = (prevTopBid > currTopBid * 2 || prevTopAsk > currTopAsk * 2) && (snapshot.timestamp - prev.timestamp < 1500);
    }

    this.prevSnapshots.set(symbol, snapshot);
    const directionalPressureScore = Math.max(-1, Math.min(1, imbalanceRatio * 1.8 + (aggressiveImbalance ? 0.15 : 0) - (spoofingPatternDetected ? 0.1 : 0)));

    return {
      bidVolumeTopN,
      askVolumeTopN,
      imbalanceRatio,
      aggressiveImbalance,
      liquidityWallDetected,
      spoofingPatternDetected,
      directionalPressureScore,
    };
  }
}
