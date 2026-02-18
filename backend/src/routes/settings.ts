import { Request, Response } from 'express';
import { prisma } from '../services/Db';

export const settingsRoute = async (req: Request, res: Response) => {
  const { autoPaper, confidenceThreshold } = req.body as { autoPaper?: boolean; confidenceThreshold?: number };

  const state = await prisma.engineState.upsert({
    where: { id: 'singleton' },
    update: {
      autoPaper: autoPaper ?? undefined,
      confidenceThreshold: confidenceThreshold ?? undefined,
    },
    create: {
      id: 'singleton',
      autoPaper: autoPaper ?? true,
      confidenceThreshold: confidenceThreshold ?? 0.6,
    },
  });

  res.json(state);
};
