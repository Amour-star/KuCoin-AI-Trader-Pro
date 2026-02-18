export interface FeatureVectorRecord {
  ts: number;
  regime: string;
  confidence: number;
  features: Record<string, number>;
  labelReturn: number;
}

export interface FeatureImportanceReport {
  topFeatures: Array<{ feature: string; importance: number }>;
  rollingTrend: Record<string, number[]>;
  regimeImpact: Record<string, Array<{ feature: string; importance: number }>>;
  drift: Array<{ feature: string; driftScore: number }>;
}

export class FeatureImportanceEngine {
  permutationImportance(records: FeatureVectorRecord[]): FeatureImportanceReport {
    const features = new Set<string>();
    for (const r of records) Object.keys(r.features).forEach(f => features.add(f));

    const importanceMap: Record<string, number> = {};
    for (const f of features) {
      const aligned = records.map(r => r.features[f] ?? 0);
      const corr = this.absCorr(aligned, records.map(r => r.labelReturn));
      importanceMap[f] = corr;
    }

    const topFeatures = Object.entries(importanceMap)
      .map(([feature, importance]) => ({ feature, importance }))
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 15);

    const rollingTrend: Record<string, number[]> = {};
    for (const f of features) {
      rollingTrend[f] = [];
      for (let i = 20; i <= records.length; i += 10) {
        const window = records.slice(i - 20, i);
        rollingTrend[f].push(this.absCorr(window.map(r => r.features[f] ?? 0), window.map(r => r.labelReturn)));
      }
    }

    const regimeImpact: Record<string, Array<{ feature: string; importance: number }>> = {};
    const regimes = Array.from(new Set(records.map(r => r.regime)));
    for (const regime of regimes) {
      const regimeRecords = records.filter(r => r.regime === regime);
      regimeImpact[regime] = Object.keys(importanceMap).map(f => ({
        feature: f,
        importance: this.absCorr(regimeRecords.map(r => r.features[f] ?? 0), regimeRecords.map(r => r.labelReturn)),
      })).sort((a, b) => b.importance - a.importance).slice(0, 15);
    }

    const drift = Object.keys(rollingTrend).map(feature => {
      const vals = rollingTrend[feature];
      const driftScore = vals.length > 1 ? Math.abs(vals[vals.length - 1] - vals[0]) : 0;
      return { feature, driftScore };
    }).sort((a, b) => b.driftScore - a.driftScore).slice(0, 15);

    return { topFeatures, rollingTrend, regimeImpact, drift };
  }

  private absCorr(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    const mx = x.reduce((a, b) => a + b, 0) / x.length;
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    let num = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < x.length; i += 1) {
      const dx = x[i] - mx;
      const dy = y[i] - my;
      num += dx * dy;
      vx += dx * dx;
      vy += dy * dy;
    }
    const den = Math.sqrt(vx * vy);
    return den > 0 ? Math.abs(num / den) : 0;
  }
}
