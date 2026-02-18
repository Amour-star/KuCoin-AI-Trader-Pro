import { Request, Response } from 'express';
import { prisma } from '../services/Db';
import { EngineMetrics } from '../engine/EngineRunner';

export const statusRoute = (metrics: EngineMetrics, symbol: string) => async (_req: Request, res: Response) => {
  const state = await prisma.engineState.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  });

  res.json({
    running: true,
    lastHeartbeatTs: metrics.lastHeartbeatTs,
    selectedSymbol: symbol,
    evaluationsCount: metrics.evaluations,
    signalsCount: metrics.signals,
    tradesExecutedCount: metrics.tradesExecuted,
    autoPaper: state.autoPaper,
    confidenceThreshold: state.confidenceThreshold,
  });
};
