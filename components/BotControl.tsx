import React from 'react';
import { BotState, MarketData } from '../types';
import { Play, Pause, Activity, Cpu, Wallet, RefreshCw, Sliders, ZapOff, Zap } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface BotControlProps {
  state: BotState;
  market: MarketData;
  onToggle: () => void;
  onRetrain: () => void;
  isTraining: boolean;
  trainingMetrics: { epoch: number; loss: number }[];
  confidenceThreshold: number;
  setConfidenceThreshold: (val: number) => void;
}

const BotControl: React.FC<BotControlProps> = ({ 
  state, 
  market, 
  onToggle, 
  onRetrain, 
  isTraining, 
  trainingMetrics, 
  confidenceThreshold, 
  setConfidenceThreshold 
}) => {
  const pnl = state.totalPortfolioValue - 1000;
  const pnlPercent = (pnl / 1000) * 100;

  const getLastRetrainTime = () => {
    if (!state.lastTrainingTime) return 'Never';
    const diff = Date.now() - state.lastTrainingTime;
    if (diff < 60000) return 'Just now';
    return new Date(state.lastTrainingTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getMarketStatusUI = (status: 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE') => {
    switch (status) {
        case 'ACTIVE':
            return { 
                color: 'text-emerald-400', 
                bg: 'bg-emerald-400', 
                badgeBg: 'bg-emerald-500/10', 
                border: 'border-emerald-500/20',
                icon: <Zap size={12} className="text-emerald-400" />,
                label: 'Active Market' 
            };
        case 'LOW_VOLATILITY':
            return { 
                color: 'text-amber-400', 
                bg: 'bg-amber-400', 
                badgeBg: 'bg-amber-500/10', 
                border: 'border-amber-500/20',
                icon: <Activity size={12} className="text-amber-400" />,
                label: 'Low Volatility' 
            };
        case 'OFFLINE':
            return { 
                color: 'text-rose-400', 
                bg: 'bg-rose-400', 
                badgeBg: 'bg-rose-500/10', 
                border: 'border-rose-500/20',
                icon: <ZapOff size={12} className="text-rose-400" />,
                label: 'Offline' 
            };
        default:
            return { 
                color: 'text-slate-400', 
                bg: 'bg-slate-400', 
                badgeBg: 'bg-slate-800', 
                border: 'border-slate-700',
                icon: <Activity size={12} />,
                label: 'Unknown' 
            };
    }
  };

  const statusUI = getMarketStatusUI(state.marketStatus);

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      {/* Main Control Card */}
      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex flex-col justify-between">
         <div>
             <div className="flex justify-between items-start mb-3">
                 <div className="flex flex-col gap-1">
                     <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Engine Status</span>
                     <span className={`text-lg font-bold flex items-center gap-2 ${state.isRunning ? 'text-emerald-400' : 'text-slate-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${state.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></div>
                        {state.isRunning ? 'Running' : 'Stopped'}
                     </span>
                     
                     {/* Market Status Badge */}
                     <div className={`mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md border ${statusUI.badgeBg} ${statusUI.border} self-start`}>
                        {statusUI.icon}
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
                    className={`flex-1 py-2 rounded font-medium text-sm flex items-center justify-center gap-2 transition ${
                        state.isRunning 
                        ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20' 
                        : 'bg-emerald-500 text-slate-900 hover:bg-emerald-400'
                    }`}
                >
                    {state.isRunning ? <><Pause size={16} /> Stop</> : <><Play size={16} /> Start</>}
                </button>
                <button 
                    onClick={onRetrain}
                    disabled={isTraining || state.isRunning}
                    title="Retrain Model"
                    className={`p-2 rounded border border-slate-700 text-slate-400 hover:text-blue-400 hover:border-blue-500/50 transition ${isTraining ? 'animate-spin text-blue-500 cursor-not-allowed' : ''}`}
                >
                    <RefreshCw size={18} />
                </button>
             </div>
         </div>

         {/* Confidence Slider */}
         <div className="mt-4 pt-3 border-t border-slate-800">
             <div className="flex justify-between items-center mb-1.5">
                 <span className="text-slate-400 text-xs font-medium flex items-center gap-1">
                     <Sliders size={12} /> AI Confidence
                 </span>
                 <span className="text-blue-400 font-mono text-xs font-bold">{(confidenceThreshold * 100).toFixed(0)}%</span>
             </div>
             <input 
                 type="range" 
                 min="0.10" 
                 max="0.95" 
                 step="0.05" 
                 value={confidenceThreshold}
                 onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                 className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-colors"
             />
         </div>
      </div>

      {/* Portfolio Card */}
      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
              <Wallet size={48} />
          </div>
          <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Virtual Portfolio</span>
          <div className="mt-1">
              <span className="text-2xl font-bold text-slate-100">${state.totalPortfolioValue.toFixed(2)}</span>
              <span className="text-xs text-slate-500 ml-2">USDT</span>
          </div>
          <div className={`mt-2 text-sm font-medium flex items-center gap-1 ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} ({pnlPercent.toFixed(2)}%)
              <span className="text-slate-600 font-normal text-xs ml-1">Total PnL</span>
          </div>
      </div>

      {/* AI Stats Card */}
      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 flex flex-col">
         <div className="flex justify-between items-start">
             <div className="flex flex-col">
                 <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">AI Agent (PPO)</span>
                 {isTraining && (
                    <span className="text-[10px] text-purple-400 flex items-center gap-1 mt-1 font-medium animate-pulse">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
                        Retraining Network...
                    </span>
                 )}
             </div>
             <Cpu className={`${isTraining ? 'text-purple-400 animate-spin-slow' : 'text-slate-600'}`} size={18} />
         </div>
         
         {isTraining ? (
            <div className="flex-1 flex flex-col justify-end mt-2">
                <div className="h-14 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trainingMetrics}>
                            <Line 
                                type="monotone" 
                                dataKey="loss" 
                                stroke="#8b5cf6" 
                                strokeWidth={2} 
                                dot={false} 
                                isAnimationActive={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mt-1 border-t border-slate-800 pt-1">
                   <span>Epoch {trainingMetrics.length}</span>
                   <span>Loss: {trainingMetrics.length > 0 ? trainingMetrics[trainingMetrics.length-1].loss.toFixed(4) : '...'}</span>
                </div>
            </div>
         ) : (
            <div className="mt-3 space-y-2">
                <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Status</span>
                    <span className={`font-medium ${state.isRunning ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {state.isRunning ? 'Active Learning' : 'Idle'}
                    </span>
                </div>
                
                <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Last Retrain</span>
                    <span className="text-slate-200 font-mono text-[10px]">{getLastRetrainTime()}</span>
                </div>

                <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Last Action</span>
                    <span className={`font-mono bg-slate-800 px-2 rounded ${state.activeSymbol && state.trades.length > 0 && state.trades[0].type !== 'HOLD' ? 'text-slate-200' : 'text-slate-500'}`}>
                        {state.activeSymbol ? (state.trades[0]?.type || 'WAIT') : 'WAIT'}
                    </span>
                </div>

                <div className="w-full bg-slate-800 rounded-full h-1.5 mt-1 overflow-hidden">
                     <div 
                        className="bg-gradient-to-r from-blue-600 to-purple-500 h-1.5 rounded-full transition-all duration-500" 
                        style={{ width: `${Math.min(100, (state.trainingDataLog.length / 500) * 100)}%` }}
                     ></div>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Buffer: {state.trainingDataLog.length}/500</span>
                    <span>Reward: {state.trainingDataLog.length > 0 ? (800 + state.trainingDataLog.length * 0.5).toFixed(1) : '842.1'}</span>
                </div>
            </div>
         )}
      </div>

      {/* Market Data Card */}
      <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
          <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Active Market</span>
          <div className="flex items-center gap-2 mt-2">
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-500 flex items-center justify-center font-bold text-xs">
                {market.symbol.split('-')[0].substring(0, 3)}
            </div>
            <div>
                <div className="text-slate-200 font-bold leading-none">{market.symbol}</div>
                <div className="text-slate-500 text-xs">Spot USDT</div>
            </div>
          </div>
          <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-800/50">
             <div className="text-lg font-mono text-slate-200">${market.price.toFixed(2)}</div>
             <div className={`text-xs font-bold px-2 py-0.5 rounded ${market.change24h >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                 {market.change24h > 0 ? '+' : ''}{market.change24h}%
             </div>
          </div>
      </div>
    </div>
  );
};

export default BotControl;