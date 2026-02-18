import { DecisionType, TradeStatus } from '@prisma/client';
import { prisma } from './Db';

export class TradeStore {
  async recordDecision(input: {
    symbol: string;
    timeframe: string;
    decision: DecisionType;
    confidence: number;
    reasons: unknown;
    featuresHash: string;
    modelVersion: string;
  }) {
    return prisma.decision.create({ data: input });
  }

  async openTrade(input: {
    symbol: string;
    side: DecisionType;
    qty: number;
    entryPrice: number;
    tpPrice?: number;
    slPrice?: number;
    fee?: number;
    slippage?: number;
    decisionId?: string;
  }) {
    return prisma.trade.create({ data: { ...input, fee: input.fee ?? 0, slippage: input.slippage ?? 0 } });
  }

  async closeTrade(tradeId: string, exitPrice: number, reason: 'TP' | 'SL' | 'MANUAL' | 'SIGNAL') {
    const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
    if (!trade) throw new Error(`Trade ${tradeId} not found`);

    const fees = trade.fee;
    const slippageCost = trade.slippage;
    const pnlAbs = trade.side === DecisionType.BUY
      ? (exitPrice - trade.entryPrice) * trade.qty - fees - slippageCost
      : (trade.entryPrice - exitPrice) * trade.qty - fees - slippageCost;

    const pnlPct = trade.entryPrice > 0 ? (pnlAbs / (trade.entryPrice * trade.qty)) * 100 : 0;

    return prisma.trade.update({
      where: { id: tradeId },
      data: {
        tsClose: new Date(),
        exitPrice,
        pnlAbs,
        pnlPct,
        status: TradeStatus.CLOSED,
      },
    });
  }

  async getTrades(limit: number) {
    return prisma.trade.findMany({ orderBy: { tsOpen: 'desc' }, take: limit });
  }

  async getDecisions(limit: number) {
    return prisma.decision.findMany({ orderBy: { ts: 'desc' }, take: limit });
  }

  async getOpenTrades() {
    return prisma.trade.findMany({ where: { status: TradeStatus.OPEN } });
  }
}
