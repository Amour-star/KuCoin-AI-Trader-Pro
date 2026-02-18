import React, { useState } from 'react';
import { forceTrade, setTestSignalMode } from '../services/backendApi';

type Props = { symbol: string };

const ManualTradePanel: React.FC<Props> = ({ symbol }) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [notionalUsd, setNotionalUsd] = useState('100');
  const [qty, setQty] = useState('');
  const [tpPct, setTpPct] = useState('');
  const [slPct, setSlPct] = useState('');
  const [tpPrice, setTpPrice] = useState('');
  const [slPrice, setSlPrice] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [testSignalMode, setLocalTestSignalMode] = useState(false);

  const handleForceTrade = async () => {
    if (!window.confirm('Confirm manual paper trade?')) return;
    const response = await forceTrade({
      symbol,
      side,
      notionalUsd: notionalUsd ? Number(notionalUsd) : undefined,
      qty: qty ? Number(qty) : undefined,
      tpPct: tpPct ? Number(tpPct) : undefined,
      slPct: slPct ? Number(slPct) : undefined,
      tpPrice: tpPrice ? Number(tpPrice) : undefined,
      slPrice: slPrice ? Number(slPrice) : undefined,
    });
    setToast(`Manual trade created: ${response.tradeId}`);
    window.setTimeout(() => setToast(null), 3500);
  };

  const handleTestMode = async () => {
    const next = !testSignalMode;
    setLocalTestSignalMode(next);
    await setTestSignalMode(next);
  };

  return (
    <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-lg mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-slate-100">Manual Trade (Paper)</h3>
        <label className="text-xs text-slate-400 flex items-center gap-2">
          <input type="checkbox" checked={testSignalMode} onChange={() => void handleTestMode()} />
          Test Signal Mode
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <select value={side} onChange={(e) => setSide(e.target.value as 'BUY' | 'SELL')} className="bg-slate-800 border border-slate-700 rounded px-2 py-2">
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
        <input value={notionalUsd} onChange={(e) => setNotionalUsd(e.target.value)} placeholder="Notional ($)" className="bg-slate-800 border border-slate-700 rounded px-2 py-2" />
        <input value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty (optional)" className="bg-slate-800 border border-slate-700 rounded px-2 py-2" />
        <button onClick={() => void handleForceTrade()} className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-2 font-semibold">Confirm Force Trade</button>
        <input value={tpPct} onChange={(e) => setTpPct(e.target.value)} placeholder="TP %" className="bg-slate-800 border border-slate-700 rounded px-2 py-2" />
        <input value={slPct} onChange={(e) => setSlPct(e.target.value)} placeholder="SL %" className="bg-slate-800 border border-slate-700 rounded px-2 py-2" />
        <input value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} placeholder="TP Price" className="bg-slate-800 border border-slate-700 rounded px-2 py-2" />
        <input value={slPrice} onChange={(e) => setSlPrice(e.target.value)} placeholder="SL Price" className="bg-slate-800 border border-slate-700 rounded px-2 py-2" />
      </div>
      {toast ? <p className="text-emerald-400 text-xs mt-3">{toast}</p> : null}
    </div>
  );
};

export default ManualTradePanel;
