import { Request, Response } from 'express';
import { TradeStore } from '../services/TradeStore';

export const tradesRoute = (tradeStore: TradeStore) => async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 100);
  const trades = await tradeStore.getTrades(limit);
  res.json(trades);
};

export const decisionsRoute = (tradeStore: TradeStore) => async (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 200);
  const decisions = await tradeStore.getDecisions(limit);
  res.json(decisions);
};
