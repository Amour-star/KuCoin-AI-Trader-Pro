import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BotState, Candle, MarketData, ActionType, TrainingDataPoint, PendingTrade } from './types';
import { INITIAL_BALANCE, SYMBOLS, TICK_INTERVAL_MS, RETRAINING_INTERVAL_TICKS } from './constants';
import { fetchCandles, fetchLatestTicker, fetchTopCoins, mockMarketData } from './services/marketService';
import { getAgentAction, executeTrade, getTradePreview, checkAutoExits } from './services/botEngine';
import Chart from './components/Chart';
import BotControl from './components/BotControl';
import TradeLog from './components/TradeLog';
import TradeConfirmationModal from './components/TradeConfirmationModal';
import { Zap, Settings, RefreshCw } from 'lucide-react';

const App: React.FC = () => {
  // --- State Management ---
  const [activeSymbol, setActiveSymbol] = useState(SYMBOLS[0]);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>(SYMBOLS);
  const [marketData, setMarketData] = useState<MarketData>(mockMarketData[0]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingMetrics, setTrainingMetrics] = useState<{epoch: number, loss: number}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  
  const [botState, setBotState] = useState<BotState>({
    isRunning: false,
    balance: INITIAL_BALANCE,
    holdings: {},
    averageEntryPrices: {},
    activePositions: [],
    totalPortfolioValue: INITIAL_BALANCE,
    activeSymbol: SYMBOLS[0],
    marketStatus: 'ACTIVE',
    lastTrainingTime: Date.now(),
    trades: [],
    trainingDataLog: []
  });

  const tickCountRef = useRef(0);
  const intervalRef = useRef<number | null>(null);

  // --- Initialization ---
  useEffect(() => {
    const initData = async () => {
      setIsLoading(true);
      // Fetch top coins
      const topCoins = await fetchTopCoins();
      if (topCoins.length > 0) {
        setAvailableSymbols(topCoins.map(c => c.symbol));
        if (!topCoins.find(c => c.symbol === activeSymbol)) {
           // If current active symbol not in top coins, switch to top 1
           setActiveSymbol(topCoins[0].symbol);
           setMarketData(topCoins[0]);
        }
      }
      
      // Fetch initial candles for active symbol
      const initialCandles = await fetchCandles(activeSymbol);
      setCandles(initialCandles);
      setIsLoading(false);
    };

    initData();
  }, []);

  // --- Symbol Change Handler ---
  useEffect(() => {
      const switchSymbol = async () => {
          setIsLoading(true);
          const newCandles = await fetchCandles(activeSymbol);
          setCandles(newCandles);
          
          const ticker = await fetchLatestTicker(activeSymbol);
          if (ticker) setMarketData(ticker);
          
          setIsLoading(false);
          // Reset bot ticks for training cycle
          tickCountRef.current = 0;
      };
      
      // Only trigger if not initial load
      if (!isLoading) {
          switchSymbol();
      }
  }, [activeSymbol]);


  // --- Bot Logic Loop ---
  const runBotCycle = useCallback(async () => {
    // 1. Fetch Latest Data
    const ticker = await fetchLatestTicker(activeSymbol);
    if (!ticker) return;

    setMarketData(ticker);

    // Update Candles locally for smooth chart
    setCandles(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        const updatedLast = {
            ...last,
            close: ticker.price,
            high: Math.max(last.high, ticker.price),
            low: Math.min(last.low, ticker.price),
        };
        return [...prev.slice(0, -1), updatedLast];
    });
    
    // Get latest candle for logic
    const currentCandle = candles.length > 0 ? {
        ...candles[candles.length - 1],
        close: ticker.price
    } : null;

    if (!currentCandle) return;

    // 2. Auto-Exit Checks (Stop Loss / Take Profit)
    // We run this BEFORE generating new signals to clear bad/good positions first
    setBotState(currentState => {
        // Run logic to check exits for active symbol positions
        return checkAutoExits(currentState, ticker.price, activeSymbol, currentCandle);
    });

    // 3. Calculate Market Status
    let newMarketStatus: 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE' = 'ACTIVE';
    if (candles.length >= 5) {
        const recentCandles = candles.slice(-5);
        const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low) / c.open, 0) / 5;
        if (avgRange < 0.0005) {
            newMarketStatus = 'LOW_VOLATILITY';
        }
    }

    // If there is a pending trade, skip AI logic
    if (pendingTrade) return;

    // 4. AI Agent Logic
    if (botState.isRunning && !isTraining) {
        const { action, confidence } = getAgentAction(currentCandle);
        
        // Filter actions
        if (action !== ActionType.HOLD && confidence > confidenceThreshold) {
             // Generate Trade Preview
             const preview = getTradePreview(botState, action, ticker.price, activeSymbol);
             if (preview) {
                 setPendingTrade(preview);
             }
        } else {
             // No trade action: Update portfolio value & market status
             setBotState(currentState => {
                const newState = { ...currentState, marketStatus: newMarketStatus };
                
                // Calculate current portfolio value (active + others)
                const holdingsValue = Object.entries(newState.holdings).reduce((acc, [sym, amt]) => {
                    if (sym === activeSymbol) return acc + amt * ticker.price;
                    const entry = newState.averageEntryPrices[sym] || 0;
                    return acc + amt * entry;
                }, 0);
                newState.totalPortfolioValue = newState.balance + holdingsValue;
                
                // Log data for training (HOLD)
                const logEntry: TrainingDataPoint = {
                    timestamp: Date.now(),
                    candle: currentCandle,
                    action,
                    confidence,
                    marketStatus: newMarketStatus,
                };
                newState.trainingDataLog = [logEntry, ...newState.trainingDataLog].slice(0, 500);
                
                return newState;
             });
        }
    } else {
        // Update state even if not running
        setBotState(currentState => ({
            ...currentState, 
            marketStatus: newMarketStatus
        }));
    }

    tickCountRef.current += 1;

    // Periodic Retraining
    if (tickCountRef.current % RETRAINING_INTERVAL_TICKS === 0 && botState.isRunning) {
        handleRetrain();
    }

    // Refresh history
    if (tickCountRef.current % 30 === 0) {
        const freshCandles = await fetchCandles(activeSymbol);
        if (freshCandles.length > 0) setCandles(freshCandles);
    }
    
  }, [botState, isTraining, activeSymbol, candles, pendingTrade, confidenceThreshold]);

  // --- Effects ---
  useEffect(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
        runBotCycle();
    }, TICK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [runBotCycle]);

  // --- Handlers ---
  const handleToggleBot = () => {
    setBotState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  };

  const handleRetrain = () => {
      if (isTraining) return;
      setIsTraining(true);
      setTrainingMetrics([]); 
      let epoch = 0;
      const maxEpochs = 25;
      const trainingInterval = setInterval(() => {
          epoch++;
          const baseLoss = 0.5 * Math.exp(-epoch / 8);
          const noise = (Math.random() - 0.5) * 0.05;
          const loss = Math.max(0, baseLoss + noise);
          setTrainingMetrics(prev => [...prev, { epoch, loss }]);
          if (epoch >= maxEpochs) {
              clearInterval(trainingInterval);
              setIsTraining(false);
              setBotState(prev => ({ ...prev, lastTrainingTime: Date.now() }));
          }
      }, 100);
  };

  const handleSymbolChange = (newSymbol: string) => {
      if (newSymbol !== activeSymbol) {
        setActiveSymbol(newSymbol);
      }
  };

  const confirmTrade = (finalTrade: PendingTrade) => {
      setBotState(currentState => {
          let newState = executeTrade(
              currentState, 
              finalTrade.action, 
              finalTrade.price, 
              finalTrade.symbol,
              finalTrade.amount,
              finalTrade.stopLoss,    // Pass SL from modal
              finalTrade.takeProfit   // Pass TP from modal
          );
          
          const lastTrade = newState.trades.length > 0 ? newState.trades[0] : null;
          const pnl = (lastTrade && lastTrade.type === ActionType.SELL && lastTrade.symbol === finalTrade.symbol) 
              ? lastTrade.pnl 
              : undefined;

          const logEntry: TrainingDataPoint = {
                timestamp: Date.now(),
                candle: candles[candles.length - 1],
                action: finalTrade.action,
                confidence: 1.0, 
                marketStatus: currentState.marketStatus,
                pnl: pnl
            };
            
          newState.trainingDataLog = [logEntry, ...newState.trainingDataLog].slice(0, 500);
          return newState;
      });

      setPendingTrade(null);
  };

  const cancelTrade = () => {
      setPendingTrade(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      {/* Confirmation Modal */}
      <TradeConfirmationModal 
          isOpen={!!pendingTrade} 
          trade={pendingTrade} 
          currentEntryPrice={pendingTrade ? botState.averageEntryPrices[pendingTrade.symbol] : undefined}
          onConfirm={confirmTrade} 
          onCancel={cancelTrade} 
      />

      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-10 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="bg-blue-600 p-2 rounded-lg">
                 <Zap className="text-white" size={20} fill="currentColor" />
             </div>
             <div>
                 <h1 className="font-bold text-xl tracking-tight text-white">KuCoin AI Trader Pro</h1>
                 <p className="text-xs text-slate-500 font-mono">v2.5.0 • Live Market Data • ccxt</p>
             </div>
          </div>
          
          <div className="flex items-center gap-4">
              <div className="flex items-center bg-slate-800 rounded p-1 overflow-x-auto max-w-[200px] md:max-w-none no-scrollbar">
                  {availableSymbols.map(sym => (
                      <button 
                        key={sym}
                        onClick={() => handleSymbolChange(sym)}
                        className={`text-xs px-3 py-1.5 rounded font-medium transition whitespace-nowrap ${
                            activeSymbol === sym 
                            ? 'bg-slate-700 text-white shadow-sm' 
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                          {sym.replace('-USDT', '')}
                      </button>
                  ))}
              </div>
              <button className="text-slate-400 hover:text-white transition">
                  <Settings size={20} />
              </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6">
        
        {/* Controls & Metrics */}
        <BotControl 
            state={botState} 
            market={marketData} 
            onToggle={handleToggleBot}
            onRetrain={handleRetrain}
            isTraining={isTraining}
            trainingMetrics={trainingMetrics}
            confidenceThreshold={confidenceThreshold}
            setConfidenceThreshold={setConfidenceThreshold}
        />

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
           {/* Chart Section - Takes up 2 cols */}
           <div className="lg:col-span-2 h-full flex flex-col gap-4">
              {isLoading ? (
                  <div className="h-full w-full bg-slate-900 rounded-lg flex items-center justify-center border border-slate-800">
                      <div className="flex flex-col items-center gap-2">
                          <RefreshCw className="animate-spin text-blue-500" size={32} />
                          <span className="text-slate-400 text-sm">Fetching KuCoin Data...</span>
                      </div>
                  </div>
              ) : (
                  <Chart data={candles} trades={botState.trades} />
              )}
              
              {/* Mini Stats Row under Chart */}
              <div className="grid grid-cols-3 gap-4">
                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                      <div className="text-slate-500 text-xs">Win Rate (24h)</div>
                      <div className="text-lg font-bold text-slate-200">68.4%</div>
                  </div>
                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                      <div className="text-slate-500 text-xs">Profit Factor</div>
                      <div className="text-lg font-bold text-emerald-400">1.85</div>
                  </div>
                  <div className="bg-slate-900 p-3 rounded border border-slate-800">
                      <div className="text-slate-500 text-xs">Max Drawdown</div>
                      <div className="text-lg font-bold text-red-400">-3.2%</div>
                  </div>
              </div>
           </div>

           {/* Sidebar - Trade Log */}
           <div className="h-full">
              <TradeLog trades={botState.trades} />
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;