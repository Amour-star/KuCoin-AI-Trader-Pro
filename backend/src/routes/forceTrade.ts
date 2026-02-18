import { Request, Response } from 'express';
import { DecisionType } from '@prisma/client';
import { BinanceMarketData } from '../services/BinanceMarketData';
import { TradeStore } from '../services/TradeStore';
import { ExecutionEngine } from '../engine/ExecutionEngine';

export const forceTradeRoute = (
  marketData: BinanceMarketData,
  tradeStore: TradeStore,
  execution: ExecutionEngine,
) => async (req: Request, res: Response) => {
  const {
    symbol,
    side,
    qty,
    notionalUsd,
    tpPct,
    slPct,
    tpPrice,
    slPrice,
  } = req.body as {
    symbol: string;
    side: 'BUY' | 'SELL';
    qty?: number;
    notionalUsd?: number;
    tpPct?: number;
    slPct?: number;
    tpPrice?: number;
    slPrice?: number;
  };

  const entryPrice = await marketData.getTickerPrice(symbol);
  const computedQty = qty ?? ((notionalUsd ?? 0) / entryPrice);
  if (!computedQty || computedQty <= 0) {
    res.status(400).json({ error: 'qty or notionalUsd must be provided' });
    return;
  }

  const sideEnum = side === 'BUY' ? DecisionType.BUY : DecisionType.SELL;
  const resolvedTp = tpPrice ?? (tpPct != null ? (side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100)) : undefined);
  const resolvedSl = slPrice ?? (slPct != null ? (side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100)) : undefined);

  const decision = await tradeStore.recordDecision({
    symbol,
    timeframe: '1m',
    decision: sideEnum,
    confidence: 1,
    reasons: ['FORCED_MANUAL'],
    featuresHash: 'manual-force-trade',
    modelVersion: 'manual-v1',
  });

  const trade = await execution.openPaperTrade({
    symbol,
    side: sideEnum,
    qty: Number(computedQty.toFixed(8)),
    entryPrice,
    tpPrice: resolvedTp,
    slPrice: resolvedSl,
    decisionId: decision.id,
  });

  res.json({ tradeId: trade.id, decisionId: decision.id });
};
