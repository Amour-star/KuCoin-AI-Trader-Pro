import React from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Bar,
  Cell,
  ReferenceLine
} from 'recharts';
import { Candle, ActionType, Trade } from '../types';

interface ChartProps {
  data: Candle[];
  trades: Trade[];
}

const Chart: React.FC<ChartProps> = ({ data, trades }) => {
  const chartData = data.map(candle => {
    const bodyBottom = Math.min(candle.open, candle.close);
    const bodyHeight = Math.max(Math.abs(candle.close - candle.open), candle.close * 0.0002);
    const wickBottom = candle.low;
    const wickHeight = Math.max(candle.high - candle.low, candle.close * 0.0002);

    return {
      ...candle,
      color: candle.close >= candle.open ? '#10b981' : '#ef4444',
      bodyBase: bodyBottom,
      bodyHeight,
      wickBase: wickBottom,
      wickHeight,
    };
  });


  const CustomTooltip: React.FC<{
    active?: boolean;
    payload?: Array<{ payload: Candle }>;
    label?: string;
  }> = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="bg-slate-800 border border-slate-700 p-3 rounded shadow-lg text-xs">
          <p className="font-bold text-slate-200">{d.time}</p>
          <p className="text-slate-400">O: <span className="text-slate-100">{d.open.toFixed(2)}</span></p>
          <p className="text-slate-400">H: <span className="text-slate-100">{d.high.toFixed(2)}</span></p>
          <p className="text-slate-400">L: <span className="text-slate-100">{d.low.toFixed(2)}</span></p>
          <p className="text-slate-400">C: <span className="text-slate-100">{d.close.toFixed(2)}</span></p>
          <p className="text-slate-400 mt-1">V: <span className="text-slate-100">{d.volume.toFixed(4)}</span></p>
          <p className="text-blue-400">EMA9: {typeof d.emaShort === 'number' ? d.emaShort.toFixed(4) : 'n/a'}</p>
          <p className="text-purple-400">EMA21: {typeof d.emaLong === 'number' ? d.emaLong.toFixed(4) : 'n/a'}</p>
          <p className="text-amber-400">RSI: {typeof d.rsi === 'number' ? d.rsi.toFixed(1) : 'n/a'}</p>
        </div>
      );
    }
    return null;
  };

  // Find recent trades to plot annotations (simplified for this view)
  // In a real advanced chart, we'd use XAxis reference lines or custom dots
  
  return (
    <div className="h-full w-full bg-slate-900 rounded-lg p-4 border border-slate-800 flex flex-col">
       <div className="flex justify-between items-center mb-2">
           <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Market / Indicators</h3>
           <div className="flex gap-4 text-xs">
               <span className="text-blue-400 flex items-center gap-1"><div className="w-2 h-2 bg-blue-400 rounded-full"></div> EMA (9)</span>
               <span className="text-purple-400 flex items-center gap-1"><div className="w-2 h-2 bg-purple-400 rounded-full"></div> EMA (21)</span>
           </div>
       </div>
      <div className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
            <XAxis 
                dataKey="time" 
                stroke="#94a3b8" 
                tick={{ fontSize: 10 }} 
                tickLine={false} 
                axisLine={false}
                minTickGap={30}
            />
            <YAxis 
                domain={['auto', 'auto']}
                orientation="right" 
                stroke="#94a3b8" 
                tick={{ fontSize: 10 }} 
                tickLine={false} 
                axisLine={false}
                tickFormatter={(val: number) => val.toFixed(4)}
            />
            <Tooltip content={<CustomTooltip />} />
            
            {/* Wick */}
            <Bar stackId="wick" dataKey="wickBase" fill="transparent" isAnimationActive={false} />
            <Bar stackId="wick" dataKey="wickHeight" barSize={1} isAnimationActive={false}>
              {chartData.map((entry, index) => (
                <Cell key={`wick-${index}`} fill={entry.color} />
              ))}
            </Bar>

            {/* Body */}
            <Bar stackId="body" dataKey="bodyBase" fill="transparent" isAnimationActive={false} />
            <Bar stackId="body" dataKey="bodyHeight" barSize={6} isAnimationActive={false}>
              {chartData.map((entry, index) => (
                <Cell key={`body-${index}`} fill={entry.color} />
              ))}
            </Bar>

            {/* Indicators */}
            <Line type="monotone" dataKey="emaShort" stroke="#60a5fa" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="emaLong" stroke="#c084fc" strokeWidth={1} dot={false} />
            
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* RSI Subchart */}
      <div className="h-24 mt-2 border-t border-slate-800 pt-2">
         <ResponsiveContainer width="100%" height="100%">
             <ComposedChart data={chartData}>
                 <YAxis domain={[0, 100]} orientation="right" hide />
                 <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" />
                 <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" />
                 <Line type="monotone" dataKey="rsi" stroke="#fbbf24" strokeWidth={1} dot={false} />
             </ComposedChart>
         </ResponsiveContainer>
      </div>
    </div>
  );
};

export default Chart;
