import { INITIAL_BALANCE } from '../../constants';
import { ActionType, PerformanceMetrics, StrategyParameters, StrategySummary, Trade } from '../../types';
import { loadTrades } from '../storage/tradeStorage';
import { analyzeWithGemini, GeminiAnalysisOutput } from './geminiAnalyzer';
import {
  buildCandidateParameters,
  commitStrategyParameters,
  getStrategySummary,
  loadStrategyState,
  updateStrategyWarnings,
} from '../engine/strategyState';
import {
  buildConditionBuckets,
  buildLossClusters,
  calculatePerformanceMetrics,
  walkForwardFilterTrades,
} from '../engine/performanceAnalyzer';

const REFINE_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_TRADES_FOR_REFINEMENT = 20;

export interface RefinementCycleResult {
  status: 'skipped' | 'applied' | 'rejected' | 'failed';
  reason: string;
  summary: StrategySummary;
  suggestedChanges: GeminiAnalysisOutput['suggestedChanges'];
  warnings: string[];
  metricsBefore?: PerformanceMetrics;
  metricsAfter?: PerformanceMetrics;
}

const splitWalkForward = (trades: Trade[]): { training: Trade[]; forward: Trade[] } => {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const cut = Math.max(1, Math.floor(sorted.length * 0.7));
  return { training: sorted.slice(0, cut), forward: sorted.slice(cut) };
};

const evaluateCandidate = (
  trades: Trade[],
  baselineParams: StrategyParameters,
  candidateParams: StrategyParameters,
): { baseline: PerformanceMetrics; candidate: PerformanceMetrics } => {
  const { forward } = splitWalkForward(trades);
  const baselineForward = walkForwardFilterTrades(forward, baselineParams);
  const candidateForward = walkForwardFilterTrades(forward, candidateParams);
  return {
    baseline: calculatePerformanceMetrics(baselineForward, INITIAL_BALANCE),
    candidate: calculatePerformanceMetrics(candidateForward, INITIAL_BALANCE),
  };
};

export const runStrategyRefinementCycle = async (): Promise<RefinementCycleResult> => {
  try {
    const now = Date.now();
    const strategy = loadStrategyState();
    const allTrades = loadTrades();
    const trades24h = allTrades.filter(trade => trade.timestamp >= now - REFINE_WINDOW_MS);
    const closed24h = trades24h.filter(trade => trade.type === ActionType.SELL && typeof trade.pnl === 'number');

    if (closed24h.length < MIN_TRADES_FOR_REFINEMENT) {
      const summary = getStrategySummary();
      const reason = `Skipped refinement: ${closed24h.length}/${MIN_TRADES_FOR_REFINEMENT} minimum closed trades in 24h.`;
      updateStrategyWarnings([reason, ...summary.warnings].slice(0, 20));
      return {
        status: 'skipped',
        reason,
        summary: getStrategySummary(),
        suggestedChanges: {},
        warnings: [reason],
      };
    }

    const metricsBefore = calculatePerformanceMetrics(closed24h, INITIAL_BALANCE);
    const conditionBuckets = buildConditionBuckets(closed24h);
    const lossClusters = buildLossClusters(closed24h);

    const analysis = await analyzeWithGemini({
      metrics: metricsBefore,
      lossClusters,
      conditionBuckets,
      currentParameters: strategy.parameters,
    });

    const hasSuggestions = Object.keys(analysis.suggestedChanges).length > 0;
    if (!hasSuggestions) {
      updateStrategyWarnings(analysis.warnings);
      return {
        status: 'skipped',
        reason: 'No validated strategy suggestions returned.',
        summary: getStrategySummary(),
        suggestedChanges: {},
        warnings: analysis.warnings,
        metricsBefore,
      };
    }

    const candidate = buildCandidateParameters(strategy.parameters, analysis.suggestedChanges);
    const walkForward = evaluateCandidate(closed24h, strategy.parameters, candidate);
    const candidateTradeCount = walkForward.candidate.closedTrades;
    const baselineTradeCount = walkForward.baseline.closedTrades;
    const minimumForwardTrades = Math.max(6, Math.floor(baselineTradeCount * 0.5));

    const drawdownNotWorse = walkForward.candidate.maxDrawdownPct <= walkForward.baseline.maxDrawdownPct + 1e-6;
    const profitFactorImproved = walkForward.candidate.profitFactor >= walkForward.baseline.profitFactor;
    const tradeCountOk = candidateTradeCount >= minimumForwardTrades;

    if (drawdownNotWorse && profitFactorImproved && tradeCountOk) {
      const notes = [
        `Refinement cycle ${new Date(now).toISOString()}`,
        `PF ${walkForward.baseline.profitFactor.toFixed(2)} -> ${walkForward.candidate.profitFactor.toFixed(2)}`,
        `DD ${walkForward.baseline.maxDrawdownPct.toFixed(2)} -> ${walkForward.candidate.maxDrawdownPct.toFixed(2)}`,
        ...analysis.warnings,
      ];
      commitStrategyParameters(candidate, notes, now);
      updateStrategyWarnings(analysis.warnings);
      return {
        status: 'applied',
        reason: 'Candidate passed walk-forward safety checks.',
        summary: getStrategySummary(),
        suggestedChanges: analysis.suggestedChanges,
        warnings: analysis.warnings,
        metricsBefore: walkForward.baseline,
        metricsAfter: walkForward.candidate,
      };
    }

    const rejectionWarnings = [
      'Refinement rejected. Previous strategy snapshot retained.',
      `Drawdown check: ${drawdownNotWorse ? 'pass' : 'fail'}`,
      `Profit factor check: ${profitFactorImproved ? 'pass' : 'fail'}`,
      `Forward trade count check: ${tradeCountOk ? 'pass' : 'fail'}`,
      ...analysis.warnings,
    ];
    updateStrategyWarnings(rejectionWarnings.slice(0, 20));

    return {
      status: 'rejected',
      reason: 'Candidate failed anti-overfitting validation. Rolled back to previous strategy.',
      summary: getStrategySummary(),
      suggestedChanges: analysis.suggestedChanges,
      warnings: rejectionWarnings,
      metricsBefore: walkForward.baseline,
      metricsAfter: walkForward.candidate,
    };
  } catch {
    const summary = getStrategySummary();
    const warnings = ['Refinement failed unexpectedly. Previous strategy state preserved.'];
    updateStrategyWarnings([warnings[0], ...summary.warnings].slice(0, 20));
    return {
      status: 'failed',
      reason: warnings[0],
      summary: getStrategySummary(),
      suggestedChanges: {},
      warnings,
    };
  }
};
