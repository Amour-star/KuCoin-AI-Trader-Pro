const calcPnl = (entry, exit, qty, fees) => (exit - entry) * qty - fees;
let equity = 1000;
let manual = 1000;
for (let i = 0; i < 1000; i += 1) {
  const entry = 100 + (i % 7);
  const exit = entry * (1 + (i % 2 === 0 ? 0.003 : -0.003));
  const qty = 0.13;
  const fees = (entry + exit) * qty * 0.001;
  const pnl = calcPnl(entry, exit, qty, fees);
  equity += pnl;
  manual += ((exit - entry) * qty) - fees;
}
console.log('equity_match', Math.abs(equity - manual) < 1e-9);
console.log('final_equity', equity.toFixed(8));
