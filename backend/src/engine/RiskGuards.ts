import { PositionStore } from '../services/PositionStore';

export class RiskGuards {
  constructor(private positionStore: PositionStore) {}

  async canOpen(symbol: string) {
    const open = await this.positionStore.getOpenPosition(symbol);
    return !open;
  }
}
