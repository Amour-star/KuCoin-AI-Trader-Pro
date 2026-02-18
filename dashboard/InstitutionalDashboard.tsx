import React, { useMemo } from 'react';
import { Trade } from '../types';
import { FeatureImportanceEngine, FeatureVectorRecord } from './FeatureImportanceEngine';

interface Props {
  trades: Trade[];
  latencyHeatmap: Record<string, number>;
}

const InstitutionalDashboard: React.FC<Props> = ({ trades, latencyHeatmap }) => {
  const featureReport = useMemo(() => {
    const records: FeatureVectorRecord[] = trades.slice(-200).map(t => ({
      ts: t.timestamp,
      regime: t.marketRegime || 'UNKNOWN',
      confidence: t.confidence ?? t.setupScore ?? 0,
      features: {
        confidence: t.confidence ?? t.setupScore ?? 0,
        slippage: t.slippage ?? 0,
        rMultiple: t.rMultiple ?? 0,
        holdTime: (t.holdTimeMs || 0) / 1000,
      },
      labelReturn: t.pnl || 0,
    }));
    return new FeatureImportanceEngine().permutationImportance(records);
  }, [trades]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3 space-y-3">
      <h3 className="text-sm font-semibold text-slate-100">Institutional Analytics</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-400 mb-1">Latency Heatmap (avg ms)</div>
          <div className="text-xs bg-slate-950 rounded p-2 max-h-32 overflow-auto">
            {Object.entries(latencyHeatmap).length === 0 ? 'No latency pairs yet.' : Object.entries(latencyHeatmap).map(([k, v]) => <div key={k}>{k}: {v.toFixed(2)}ms</div>)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400 mb-1">Top ML Feature Importance</div>
          <div className="text-xs bg-slate-950 rounded p-2 max-h-32 overflow-auto">
            {featureReport.topFeatures.length === 0 ? 'Insufficient features.' : featureReport.topFeatures.map(f => <div key={f.feature}>{f.feature}: {f.importance.toFixed(3)}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InstitutionalDashboard;
