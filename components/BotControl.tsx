import React from 'react';
import { BotState, MarketData } from '../types';
import { Play, Pause, Activity, Cpu, Wallet, RefreshCw, Sliders, ZapOff, Zap, RotateCcw, Cloud, CloudOff } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface BotControlProps {
  state: BotState;
  market: MarketData;
  onToggle: () => void;
  autoPaperTrading: boolean;
  onToggleAutoPaperTrading: () => void;
  onRetrain: () => void;
  onReset: () => void;
  isTraining: boolean;
  trainingMetrics: { epoch: number; loss: number }[];
  confidenceThreshold: number;
  setConfidenceThreshold: (val: number) => void;
}

const BotControl: React.FC<BotControlProps> = ({ 
  state, 
  market, 
  onToggle, 
  autoPaperTrading,
  onToggleAutoPaperTrading,
  onRetrain, 
  onReset,
  isTraining, 
  trainingMetrics, 
  confidenceThreshold, 
  setConfidenceThreshold 
}) => {
  const pnl = state.totalPortfolioValue - 1000;
  const pnlPercent = (pnl / 1000) * 100;

  const getMarketStatusUI = (status: 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE') => {
    switch (status) {
        case 'ACTIVE':
            return { color: 'text-emerald-400', bg: 'bg-emerald-400', label: 'Active Market', icon: <Zap size={12} /> };
        case 'LOW_VOLATILITY':
            return { color: 'text-amber-400', bg: 'bg-amber-400', label: 'Low Volatility', icon: <Activity size={12} /> };
        case 'OFFLINE':
            return { color: 'text-rose-400', bg: 'bg-rose-400', label: 'Offline', icon: <ZapOff size={12} /> };
        default:
            return { color: 'text-slate-400', bg: 'bg-slate-400', label: 'Unknown', icon: <Activity size={12} /> };
    }
  };

  const statusUI = getMarketStatusUI(state.marketStatus);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex flex-col justify-between shadow-lg">
         <div>
             <div className="flex justify-between items-start mb-3">
                 <div className="flex flex-col gap-1">
                     <span className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Engine Status</span>
                     <span className={`text-lg font-bold flex items-center gap-2 ${state.isRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${state.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></div>
                        {state.isRunning ? 'LIVE RUNNING' : 'STANDBY'}
                     </span>
                     <div className={`mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md border bg-slate-800 border-slate-700 self-start`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${statusUI.color}`}>
                            {statusUI.label}
                        </span>
                     </div>
                 </div>
                 <Activity className={state.isRunning ? 'text-emerald-500/20' : 'text-slate-700'} size={32} />
             </div>
             <div className="flex gap-2 mt-2">
                <button 
                    onClick={onToggle}
                    className={`flex-1 py-2 rounded font-bold text-xs flex items-center justify-center gap-2 transition uppercase tracking-wider ${
                        state.isRunning 
                        ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20' 
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}
                >
                    {state.isRunning ? <><Pause size={14} /> Stop</> : <><Play size={14} /> Start</>}
                </button>
                <button
                    onClick={onToggleAutoPaperTrading}
                    className={`px-3 py-2 rounded font-bold text-[10px] border uppercase tracking-wider transition ${
                        autoPaperTrading
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                    }`}
                >
                    Auto Paper
                </button>
             </div>
         </div>
         <div className="mt-4 pt-3 border-t border-slate-800">
             <div className="flex justify-between items-center mb-1.5 text-[10px] text-slate-500 font-bold uppercase">
                 <span>Confidence Threshold</span>
                 <span className="text-blue-400">{(confidenceThreshold * 100).toFixed(0)}%</span>
             </div>
             <input type="range" min="0.10" max="0.95" step="0.05" value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
         </div>
      </div>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 relative shadow-lg">
          <div className="flex justify-between items-center mb-1">
            <span className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Paper Portfolio</span>
            <button onClick={onReset} className="text-slate-600 hover:text-red-400 transition-colors"><RotateCcw size={14} /></button>
          </div>
          <div className="text-3xl font-bold text-slate-100 font-mono tracking-tighter">${state.totalPortfolioValue.toFixed(2)}</div>
          <div className={`mt-3 text-sm font-bold flex items-center gap-1 px-2 py-1 rounded-md w-fit ${pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPercent.toFixed(2)}%)
          </div>
          <div className="mt-4 flex gap-4 text-xs font-mono">
              <div className="flex-1">
                  <div className="text-[9px] text-slate-600 uppercase">Available</div>
                  <div className="text-slate-300">${state.balance.toFixed(2)}</div>
              </div>
              <div className="flex-1 text-right">
                  <div className="text-[9px] text-slate-600 uppercase">Invested</div>
                  <div className="text-slate-300">${(state.totalPortfolioValue - state.balance).toFixed(2)}</div>
              </div>
          </div>
      </div>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex flex-col shadow-lg">
         <div className="flex justify-between items-start mb-2">
             <span className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Neural Engine</span>
             <Cpu className={`${isTraining ? 'text-purple-400 animate-spin-slow' : 'text-slate-600'}`} size={18} />
         </div>
         {isTraining ? (
            <div className="flex-1 flex flex-col justify-end">
                <div className="h-16 w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={trainingMetrics}><Line type="monotone" dataKey="loss" stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div>
                <div className="text-[9px] text-slate-400 mt-1 font-mono">Epoch {trainingMetrics.length}</div>
            </div>
         ) : (
            <div className="space-y-2">
                <div className="flex justify-between text-[10px] uppercase font-bold text-slate-500">
                    <span>Replay Buffer</span>
                    <span className="text-slate-300">{state.trainingDataLog.length}/500</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5"><div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${(state.trainingDataLog.length / 500) * 100}%` }}></div></div>
                <button onClick={onRetrain} disabled={state.isRunning} className="w-full py-1 text-[10px] font-bold uppercase bg-slate-800 border border-slate-700 rounded text-slate-400 hover:text-white transition">Force Sync</button>
            </div>
         )}
      </div>

      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-lg">
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-500 text-[10px] uppercase tracking-widest font-bold">Data Connectivity</span>
            {state.connectivity === 'REALTIME' ? (
                <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    <Cloud size={10} /> REAL-TIME
                </div>
            ) : (
                <div className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                    <CloudOff size={10} /> SIMULATED
                </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 text-blue-400 flex items-center justify-center font-black text-xs">{market.symbol.split('-')[0]}</div>
            <div>
                <div className="text-slate-100 font-black leading-none text-base tracking-tight">{market.symbol}</div>
                <div className="text-slate-500 text-[10px] font-bold uppercase mt-1 tracking-widest">SPOT MARKET</div>
            </div>
          </div>
          <div className="flex justify-between items-end mt-4 pt-3 border-t border-slate-800/50">
             <div className="text-xl font-mono font-bold text-slate-100 tracking-tighter">${market.price.toFixed(2)}</div>
             <div className={`text-xs font-bold px-2 py-0.5 rounded-md ${market.change24h >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                 {market.change24h > 0 ? '+' : ''}{market.change24h}%
             </div>
          </div>
      </div>
    </div>
  );
};

export default BotControl;
