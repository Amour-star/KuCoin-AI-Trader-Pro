import React, { useState, useEffect } from 'react';
import { PendingTrade, ActionType } from '../types';
import { AlertTriangle, CheckCircle, X, Sliders, Target, ShieldAlert } from 'lucide-react';

interface TradeConfirmationModalProps {
  isOpen: boolean;
  trade: PendingTrade | null;
  currentEntryPrice?: number;
  onConfirm: (trade: PendingTrade) => void;
  onCancel: () => void;
}

const TradeConfirmationModal: React.FC<TradeConfirmationModalProps> = ({ isOpen, trade, currentEntryPrice, onConfirm, onCancel }) => {
  const [percentage, setPercentage] = useState(100);
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');

  // Reset state when trade opens
  useEffect(() => {
    if (trade) {
      setPercentage(100);
      setStopLoss(trade.stopLoss ? trade.stopLoss.toFixed(2) : '');
      setTakeProfit(trade.takeProfit ? trade.takeProfit.toFixed(2) : '');
    }
  }, [trade]);

  // Dynamic SL/TP Suggestions for Partial Sell
  useEffect(() => {
      if (trade && trade.action === ActionType.SELL) {
          if (percentage < 100) {
              const currentPrice = trade.price;
              let suggestedSL = currentPrice * 0.95; // Default 5% risk
              let suggestedTP = currentPrice * 1.05; // Default 5% gain

              // Smart logic using Average Entry Price if available
              if (currentEntryPrice && currentEntryPrice > 0) {
                  if (currentPrice > currentEntryPrice * 1.02) {
                      // If comfortably in profit (>2%), suggest Break Even SL
                      suggestedSL = currentEntryPrice;
                  }
                  // TP relative to Entry? Or Market? Market is usually better for momentum.
                  // Let's stick to Market for TP.
              }

              setStopLoss(suggestedSL.toFixed(2));
              setTakeProfit(suggestedTP.toFixed(2));
          } else {
              // Reset if full sell (inputs will be hidden anyway, but clean state)
              setStopLoss('');
              setTakeProfit('');
          }
      }
  }, [percentage, trade, currentEntryPrice]);

  if (!isOpen || !trade) return null;

  const isBuy = trade.action === ActionType.BUY;
  
  const currentAmount = trade.amount * (percentage / 100);
  const currentValue = currentAmount * trade.price;
  const feeRatio = trade.totalValue > 0 ? trade.fee / trade.totalValue : 0.001;
  const currentFee = currentValue * feeRatio;

  const handleConfirm = () => {
    onConfirm({
      ...trade,
      amount: currentAmount,
      totalValue: currentValue,
      fee: currentFee,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className={`p-4 border-b border-slate-800 flex justify-between items-center ${isBuy ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-full ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {isBuy ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Confirm Trade</h3>
              <p className="text-xs text-slate-400">AI Signal Detected</p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-white transition">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="flex justify-between items-end">
             <div className="text-sm text-slate-400">Symbol</div>
             <div className="text-xl font-bold text-slate-100">{trade.symbol}</div>
          </div>

          <div className="flex justify-between items-end border-b border-slate-800 pb-4">
             <div className="text-sm text-slate-400">Action</div>
             <div className={`text-xl font-bold px-3 py-1 rounded ${isBuy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                 {trade.action}
             </div>
          </div>

          {/* Dynamic Slider for SELL */}
          {!isBuy && (
              <div className="bg-slate-950 p-3 rounded border border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                          <Sliders size={12} /> SELL PERCENTAGE
                      </span>
                      <span className="text-xs font-mono text-blue-400">{percentage}%</span>
                  </div>
                  <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      value={percentage} 
                      onChange={(e) => setPercentage(parseInt(e.target.value))}
                      className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                      <span>1%</span>
                      <span>50%</span>
                      <span>100%</span>
                  </div>
              </div>
          )}

          <div className="space-y-2">
              <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Market Price</span>
                  <span className="font-mono text-slate-200">${trade.price.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Amount</span>
                  <span className="font-mono text-slate-200">{currentAmount.toFixed(6)}</span>
              </div>
              <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Fee (0.1%)</span>
                  <span className="font-mono text-red-400">-${currentFee.toFixed(4)} USDT</span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-slate-800 font-bold">
                  <span className="text-slate-300">Total Value</span>
                  <span className="font-mono text-emerald-400">${currentValue.toFixed(2)} USDT</span>
              </div>
          </div>

          {/* SL/TP Inputs (Visible for BUY OR Partial SELL) */}
          {(isBuy || percentage < 100) && (
              <div className="pt-2 animate-in fade-in duration-300">
                  {!isBuy && (
                      <div className="text-[10px] text-slate-500 mb-2 italic">
                          Update settings for remaining position (Avg Entry: ${currentEntryPrice?.toFixed(2) || 'N/A'})
                      </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                      <div>
                          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1">
                              <ShieldAlert size={10} /> Stop Loss ($)
                          </label>
                          <input 
                              type="number" 
                              step="0.01"
                              value={stopLoss}
                              onChange={(e) => setStopLoss(e.target.value)}
                              placeholder="None"
                              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-red-400 font-mono focus:border-red-500 focus:outline-none"
                          />
                      </div>
                      <div>
                          <label className="text-[10px] text-slate-500 uppercase font-bold mb-1 flex items-center gap-1">
                              <Target size={10} /> Take Profit ($)
                          </label>
                          <input 
                              type="number" 
                              step="0.01"
                              value={takeProfit}
                              onChange={(e) => setTakeProfit(e.target.value)}
                              placeholder="None"
                              className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-sm text-emerald-400 font-mono focus:border-emerald-500 focus:outline-none"
                          />
                      </div>
                  </div>
              </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 py-3 px-4 rounded-lg bg-slate-800 text-slate-300 font-medium hover:bg-slate-700 transition"
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm}
            className={`flex-1 py-3 px-4 rounded-lg font-bold text-slate-900 transition ${isBuy ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-red-500 hover:bg-red-400'}`}
          >
            Confirm {isBuy ? 'Buy' : 'Sell'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default TradeConfirmationModal;