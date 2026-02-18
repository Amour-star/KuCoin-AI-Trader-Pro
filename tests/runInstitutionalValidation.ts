import { ActionType, Candle, Trade } from '../types.ts';
import { RefinementEngine } from '../core/RefinementEngine.ts';
import { WalkForwardEngine } from '../core/WalkForwardEngine.ts';
import { ExecutionEngine } from '../core/ExecutionEngine.ts';

const candles: Candle[] = Array.from({ length: 120 }).map((_, i) => ({
  time: new Date(Date.now() - (120 - i) * 60_000).toISOString(),
  timestamp: Date.now() - (120 - i) * 60_000,
  open: 100 + i * 0.1,
  high: 100 + i * 0.1 + 0.3,
  low: 100 + i * 0.1 - 0.3,
  close: 100 + i * 0.1 + Math.sin(i / 4) * 0.2,
  volume: 1000 + i,
}));

const refinement = new RefinementEngine();
const audit = refinement.auditStability(candles);
console.log('stabilityScore', audit.stabilityScore, 'fragility', audit.fragility.join('|') || 'none');

let equity = 1000;
const trades: Trade[] = [];
for (let i = 0; i < 1000; i += 1) {
  const entry = 100 + (i % 20) * 0.2;
  const exit = entry * (1 + ((i % 2 === 0 ? 1 : -1) * 0.004));
  const qty = 0.1;
  const fee = (entry + exit) * qty * 0.001;
  const pnl = ExecutionEngine.calcRealizedPnl(entry, exit, qty, ActionType.BUY, fee);
  equity += pnl;
  trades.push({ id: `t-${i}`, symbol: 'BTC-USDC', type: ActionType.SELL, price: exit, amount: qty, timestamp: Date.now() - (1000 - i) * 60_000, fee: fee / 2, pnl, modelVersion: 'rf-test' });
}
const manual = 1000 + trades.reduce((a, t) => a + (t.pnl || 0), 0);
console.log('equityMatch', Math.abs(equity - manual) < 1e-8, equity.toFixed(8), manual.toFixed(8));

const wf = new WalkForwardEngine().run(trades);
console.log('walkForwardWindows', wf.length, 'accepted', wf.filter(w => w.accepted).length);
