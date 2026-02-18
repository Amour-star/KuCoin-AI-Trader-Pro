import { ActionType, Position, Trade } from '../types.ts';

export interface PortfolioRiskConfig {
  maxExposurePerSymbolPct: number;
  maxPortfolioExposurePct: number;
  maxDailyLossPct: number;
  maxOpenTrades: number;
}

export interface RiskGateInput {
  symbol: string;
  side: ActionType;
  qty: number;
  price: number;
  equity: number;
  positions: Position[];
  trades: Trade[];
}

export interface RiskGateResult {
  allowed: boolean;
  reason?: string;
  exposureBySymbol: Record<string, number>;
  totalExposurePct: number;
}

export class PortfolioRiskManager {
  constructor(private readonly cfg: PortfolioRiskConfig) {}

  evaluate(input: RiskGateInput): RiskGateResult {
    const exposureBySymbol: Record<string, number> = {};
    for (const pos of input.positions) {
      exposureBySymbol[pos.symbol] = (exposureBySymbol[pos.symbol] || 0) + pos.amount * pos.entryPrice;
    }
    const totalExposure = Object.values(exposureBySymbol).reduce((a, b) => a + b, 0);
    const totalExposurePct = input.equity > 0 ? totalExposure / input.equity : 0;
    const perSymbolPct = input.equity > 0 ? (exposureBySymbol[input.symbol] || 0) / input.equity : 0;

    if (input.positions.length >= this.cfg.maxOpenTrades) {
      return { allowed: false, reason: `max open trades ${this.cfg.maxOpenTrades} reached`, exposureBySymbol, totalExposurePct };
    }
    if (perSymbolPct > this.cfg.maxExposurePerSymbolPct) {
      return { allowed: false, reason: 'symbol exposure limit breached', exposureBySymbol, totalExposurePct };
    }
    if (totalExposurePct > this.cfg.maxPortfolioExposurePct) {
      return { allowed: false, reason: 'portfolio exposure limit breached', exposureBySymbol, totalExposurePct };
    }

    const dailyStart = new Date();
    dailyStart.setHours(0, 0, 0, 0);
    const dailyPnl = input.trades
      .filter(t => t.type === ActionType.SELL && t.timestamp >= dailyStart.getTime())
      .reduce((acc, t) => acc + (t.pnl || 0), 0);
    if (dailyPnl <= -input.equity * this.cfg.maxDailyLossPct) {
      return { allowed: false, reason: 'daily loss protection triggered', exposureBySymbol, totalExposurePct };
    }

    return { allowed: true, exposureBySymbol, totalExposurePct };
  }
}
