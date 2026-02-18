import { DecisionType, PositionStatus } from '@prisma/client';
import { prisma } from './Db';

export class PositionStore {
  async getOpenPosition(symbol: string) {
    return prisma.position.findFirst({ where: { symbol, status: PositionStatus.OPEN } });
  }

  async upsertPosition(symbol: string, side: DecisionType, qty: number, avgEntry: number) {
    const existing = await this.getOpenPosition(symbol);
    if (existing) {
      return prisma.position.update({ where: { id: existing.id }, data: { side, qty, avgEntry } });
    }
    return prisma.position.create({ data: { symbol, side, qty, avgEntry } });
  }

  async closePosition(symbol: string) {
    const existing = await this.getOpenPosition(symbol);
    if (!existing) return null;
    return prisma.position.update({ where: { id: existing.id }, data: { status: PositionStatus.CLOSED, closedAt: new Date() } });
  }
}
