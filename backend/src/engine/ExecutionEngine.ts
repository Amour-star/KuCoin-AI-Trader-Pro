import { DecisionType } from '@prisma/client';
import { TradeStore } from '../services/TradeStore';
import { PositionStore } from '../services/PositionStore';

export class ExecutionEngine {
  constructor(private tradeStore: TradeStore, private positionStore: PositionStore) {}

  async openPaperTrade(input: {
    symbol: string;
    side: DecisionType.BUY | DecisionType.SELL;
    qty: number;
    entryPrice: number;
    tpPrice?: number;
    slPrice?: number;
    decisionId?: string;
  }) {
    const trade = await this.tradeStore.openTrade(input);
    await this.positionStore.upsertPosition(input.symbol, input.side, input.qty, input.entryPrice);
    return trade;
  }

  async monitorAndClose(symbol: string, currentPrice: number) {
    const openTrades = await this.tradeStore.getOpenTrades();
    const relevant = openTrades.filter(t => t.symbol === symbol);
    for (const trade of relevant) {
      if (trade.tpPrice != null) {
        const hitTp = trade.side === DecisionType.BUY ? currentPrice >= trade.tpPrice : currentPrice <= trade.tpPrice;
        if (hitTp) {
          await this.tradeStore.closeTrade(trade.id, currentPrice, 'TP');
          await this.positionStore.closePosition(symbol);
          continue;
        }
      }
      if (trade.slPrice != null) {
        const hitSl = trade.side === DecisionType.BUY ? currentPrice <= trade.slPrice : currentPrice >= trade.slPrice;
        if (hitSl) {
          await this.tradeStore.closeTrade(trade.id, currentPrice, 'SL');
          await this.positionStore.closePosition(symbol);
        }
      }
    }
  }
}
