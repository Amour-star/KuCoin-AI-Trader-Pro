import { ConditionBucket, LossCluster, PerformanceMetrics, StrategyParameters } from '../../types';

export interface GeminiAnalysisInput {
  metrics: PerformanceMetrics;
  lossClusters: LossCluster[];
  conditionBuckets: ConditionBucket[];
  currentParameters: StrategyParameters;
}

export interface GeminiSuggestedChanges {
  minScore?: number;
  atrMultiplier?: number;
  stopLossATR?: number;
}

export interface GeminiAnalysisOutput {
  suggestedChanges: GeminiSuggestedChanges;
  warnings: string[];
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const GEMINI_PROMPT_TEMPLATE = `
You are a quant risk reviewer. You must NOT generate live trade signals.
You receive historical paper-trading statistics for the last 24h.
Your task: suggest safer parameter adjustments only when justified by statistics.

Allowed output JSON schema:
{
  "suggestedChanges": {
    "minScore"?: number,
    "atrMultiplier"?: number,
    "stopLossATR"?: number
  },
  "warnings": string[]
}

Rules:
1) Prefer loss reduction over higher trade frequency.
2) Mention overtrading, bad regimes, and unstable conditions in warnings.
3) Keep changes conservative.
4) Return valid JSON only.
`;

const buildFallbackHeuristics = (input: GeminiAnalysisInput): GeminiAnalysisOutput => {
  const { metrics, currentParameters } = input;
  const suggestedChanges: GeminiSuggestedChanges = {};
  const warnings: string[] = ['Gemini API unavailable. Using deterministic fallback refinement heuristics.'];

  if (metrics.winRate < 45 || metrics.profitFactor < 1) {
    suggestedChanges.minScore = clamp(currentParameters.minScore + 0.02, 0.5, 0.95);
    warnings.push('Win rate/profit factor below target. Raising minimum setup quality threshold.');
  }
  if (metrics.maxDrawdownPct > 6) {
    suggestedChanges.atrMultiplier = clamp(currentParameters.atrMultiplier - 0.08, 0.6, 2.5);
    warnings.push('Drawdown elevated. Tightening ATR multiplier for smaller position exposure.');
  }
  if (metrics.avgR < 0.2) {
    suggestedChanges.stopLossATR = clamp(currentParameters.stopLossATR - 0.05, 0.8, 3.5);
    warnings.push('Average R is weak. Tightening stop-loss distance incrementally.');
  }

  return { suggestedChanges, warnings };
};

const extractJson = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;

  const fenceStart = trimmed.indexOf('{');
  const fenceEnd = trimmed.lastIndexOf('}');
  if (fenceStart >= 0 && fenceEnd > fenceStart) {
    return trimmed.slice(fenceStart, fenceEnd + 1);
  }
  return '{}';
};

const sanitizeOutput = (candidate: unknown, base: StrategyParameters): GeminiAnalysisOutput => {
  if (!isObject(candidate)) return { suggestedChanges: {}, warnings: ['Invalid Gemini response payload.'] };

  const warnings: string[] = Array.isArray(candidate.warnings)
    ? candidate.warnings.filter((item): item is string => typeof item === 'string').slice(0, 12)
    : [];

  const suggestedRaw = isObject(candidate.suggestedChanges) ? candidate.suggestedChanges : {};
  const suggestedChanges: GeminiSuggestedChanges = {};

  if (typeof suggestedRaw.minScore === 'number' && Number.isFinite(suggestedRaw.minScore)) {
    suggestedChanges.minScore = clamp(suggestedRaw.minScore, 0.5, 0.95);
  }
  if (typeof suggestedRaw.atrMultiplier === 'number' && Number.isFinite(suggestedRaw.atrMultiplier)) {
    suggestedChanges.atrMultiplier = clamp(suggestedRaw.atrMultiplier, 0.6, 2.5);
  }
  if (typeof suggestedRaw.stopLossATR === 'number' && Number.isFinite(suggestedRaw.stopLossATR)) {
    suggestedChanges.stopLossATR = clamp(suggestedRaw.stopLossATR, 0.8, 3.5);
  }

  if (Object.keys(suggestedChanges).length === 0 && warnings.length === 0) {
    warnings.push('Gemini returned no actionable parameter updates.');
  }

  if (suggestedChanges.minScore !== undefined && Math.abs(suggestedChanges.minScore - base.minScore) < 1e-6) {
    delete suggestedChanges.minScore;
  }
  if (
    suggestedChanges.atrMultiplier !== undefined &&
    Math.abs(suggestedChanges.atrMultiplier - base.atrMultiplier) < 1e-6
  ) {
    delete suggestedChanges.atrMultiplier;
  }
  if (suggestedChanges.stopLossATR !== undefined && Math.abs(suggestedChanges.stopLossATR - base.stopLossATR) < 1e-6) {
    delete suggestedChanges.stopLossATR;
  }

  return { suggestedChanges, warnings };
};

export const buildGeminiPrompt = (input: GeminiAnalysisInput): string => {
  const payload = {
    metrics: input.metrics,
    lossClusters: input.lossClusters.slice(0, 10),
    conditionBuckets: input.conditionBuckets.slice(0, 12),
    currentParameters: input.currentParameters,
  };

  return `${GEMINI_PROMPT_TEMPLATE}\n\nINPUT_JSON:\n${JSON.stringify(payload, null, 2)}`;
};

export const analyzeWithGemini = async (input: GeminiAnalysisInput): Promise<GeminiAnalysisOutput> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
  if (!apiKey) return buildFallbackHeuristics(input);

  try {
    const prompt = buildGeminiPrompt(input);
    const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      return {
        ...buildFallbackHeuristics(input),
        warnings: [`Gemini HTTP ${response.status}. Fallback refinement applied.`],
      };
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const firstCandidate = candidates[0];
    if (!isObject(firstCandidate)) return buildFallbackHeuristics(input);

    const content = isObject(firstCandidate.content) ? firstCandidate.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const firstPart = parts[0];
    const rawText = isObject(firstPart) && typeof firstPart.text === 'string' ? firstPart.text : '{}';

    const parsed = JSON.parse(extractJson(rawText)) as unknown;
    return sanitizeOutput(parsed, input.currentParameters);
  } catch {
    return {
      ...buildFallbackHeuristics(input),
      warnings: ['Gemini call failed. Fallback refinement heuristics used for safety.'],
    };
  }
};
