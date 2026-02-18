import { tradeHistoryService } from '../services/storage/tradeHistoryService.ts';

const recent = tradeHistoryService.getRecentTrades(Number(process.argv[2] || 10));
const from = Date.now() - 24 * 60 * 60 * 1000;
const to = Date.now();
const pnl = tradeHistoryService.getPnLSummary(from, to);
console.log(JSON.stringify({ recent, pnl }, null, 2));
