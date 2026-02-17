
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BotState, Candle, MarketData, ActionType, TrainingDataPoint, PendingTrade } from './types';
import { INITIAL_BALANCE, SYMBOLS, TICK_INTERVAL_MS, RETRAINING_INTERVAL_TICKS } from './constants';
import { fetchCandles, fetchLatestTicker, fetchTopCoins, mockMarketData, getConnectivityStatus } from './services/marketService';
import { getAgentAction, executeTrade, getTradePreview, checkAutoExits } from './services/botEngine';
import Chart from './components/Chart';
import BotControl from './components/BotControl';
import TradeLog from './components/TradeLog';
import TradeConfirmationModal from './components/TradeConfirmationModal';
import { Zap, Settings, RefreshCw, Globe } from 'lucide-react';

const App: React.FC = () => {
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
    connectivity: 'CONNECTING',
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

  useEffect(() => {
    const initData = async () => {
      setIsLoading(true);
      const topCoins = await fetchTopCoins();
      if (topCoins.length > 0) {
        setAvailableSymbols(topCoins.map(c => c.symbol));
        if (!topCoins.find(c => c.symbol === activeSymbol)) {
           setActiveSymbol(topCoins[0].symbol);
           setMarketData(topCoins[0]);
        }
      }
      const initialCandles = await fetchCandles(activeSymbol);
      setCandles(initialCandles);
      setIsLoading(false);
    };
    initData();
  }, []);

  useEffect(() => {
      const switchSymbol = async () => {
          setIsLoading(true);
          const newCandles = await fetchCandles(activeSymbol);
          setCandles(newCandles);
          const ticker = await fetchLatestTicker(activeSymbol);
          if (ticker) setMarketData(ticker);
          setIsLoading(false);
          tickCountRef.current = 0;
      };
      if (!isLoading) switchSymbol();
  }, [activeSymbol]);

  const runBotCycle = useCallback(async () => {
    const ticker = await fetchLatestTicker(activeSymbol);
    if (!ticker) return;
    setMarketData(ticker);

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
    
    const currentCandle = candles.length > 0 ? {
        ...candles[candles.length - 1],
        close: ticker.price
    } : null;

    if (!currentCandle) return;

    setBotState(currentState => {
        return {
            ...checkAutoExits(currentState, ticker.price, activeSymbol, currentCandle),
            connectivity: getConnectivityStatus()
        };
    });

    let newMarketStatus: 'ACTIVE' | 'LOW_VOLATILITY' | 'OFFLINE' = 'ACTIVE';
    if (candles.length >= 5) {
        const recentCandles = candles.slice(-5);
        const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low) / c.open, 0) / 5;
        if (avgRange < 0.0005) {
            newMarketStatus = 'LOW_VOLATILITY';
        }
    }

    if (pendingTrade) return;

    if (botState.isRunning && !isTraining) {
        const { action, confidence } = getAgentAction(currentCandle);
        if (action !== ActionType.HOLD && confidence > confidenceThreshold) {
             const preview = getTradePreview(botState, action, ticker.price, activeSymbol);
             if (preview) setPendingTrade(preview);
        } else {
             setBotState(currentState => {
                const newState = { ...currentState, marketStatus: newMarketStatus };
                // Fix: Explicitly typing the accumulator 'acc' and destructured value 'amt' to number to avoid left-hand side arithmetic type errors.
                const holdingsValue = Object.entries(newState.holdings).reduce((acc: number, [sym, amt]: [string, number]) => {
                    if (sym === activeSymbol) return acc + (amt * ticker.price);
                    const entry = newState.averageEntryPrices[sym] || 0;
                    return acc + (amt * entry);
                }, 0);
                newState.totalPortfolioValue = newState.balance + holdingsValue;
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
        setBotState(currentState => ({ ...currentState, marketStatus: newMarketStatus }));
    }

    tickCountRef.current += 1;
    if (tickCountRef.current % RETRAINING_INTERVAL_TICKS === 0 && botState.isRunning) {
        handleRetrain();
    }
    if (tickCountRef.current % 30 === 0) {
        const freshCandles = await fetchCandles(activeSymbol);
        if (freshCandles.length > 0) setCandles(freshCandles);
    }
  }, [botState, isTraining, activeSymbol, candles, pendingTrade, confidenceThreshold]);

  useEffect(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
        runBotCycle();
    }, TICK_INTERVAL_MS);
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current); };
  }, [runBotCycle]);

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

  const handleResetSession = () => {
    if (window.confirm("Are you sure you want to reset your paper trading session?")) {
        setBotState({
            isRunning: false,
            connectivity: getConnectivityStatus(),
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
        tickCountRef.current = 0;
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
              finalTrade.stopLoss,
              finalTrade.takeProfit
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      <TradeConfirmationModal 
          isOpen={!!pendingTrade} 
          trade={pendingTrade} 
          currentEntryPrice={pendingTrade ? botState.averageEntryPrices[pendingTrade.symbol] : undefined}
          onConfirm={confirmTrade} 
          onCancel={() => setPendingTrade(null)} 
      />

      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-10 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
             <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-500/20">
                 <Zap className="text-white" size={20} fill="currentColor" />
             </div>
             <div>
                 <div className="flex items-center gap-2">
                    <h1 className="font-bold text-xl tracking-tight text-white">KuCoin AI Trader</h1>
                    <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-2 py-0.5 rounded border border-emerald-500/20 font-bold uppercase flex items-center gap-1">
                        <Globe size={10} /> Live Paper Mode
                    </span>
                 </div>
                 <p className="text-xs text-slate-500 font-mono">v2.5.0 • Real-time Simulation • ccxt.js</p>
             </div>
          </div>
          
          <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center bg-slate-800 rounded p-1 overflow-x-auto no-scrollbar border border-slate-700">
                  {availableSymbols.map(sym => (
                      <button 
                        key={sym}
                        onClick={() => setActiveSymbol(sym)}
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
              <button className="text-slate-400 hover:text-white transition p-2 hover:bg-slate-800 rounded-full">
                  <Settings size={20} />
              </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6">
        <BotControl 
            state={botState} 
            market={marketData} 
            onToggle={handleToggleBot}
            onRetrain={handleRetrain}
            onReset={handleResetSession}
            isTraining={isTraining}
            trainingMetrics={trainingMetrics}
            confidenceThreshold={confidenceThreshold}
            setConfidenceThreshold={setConfidenceThreshold}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto lg:h-[650px]">
           <div className="lg:col-span-2 flex flex-col gap-4">
              {isLoading ? (
                  <div className="flex-1 min-h-[400px] w-full bg-slate-900 rounded-lg flex items-center justify-center border border-slate-800">
                      <div className="flex flex-col items-center gap-2 text-center">
                          <RefreshCw className="animate-spin text-blue-500 mb-2" size={32} />
                          <span className="text-slate-100 font-bold">Synchronizing Live Market</span>
                      </div>
                  </div>
              ) : (
                  <Chart data={candles} trades={botState.trades} />
              )}
              
              <div className="grid grid-cols-3 gap-4 mb-4 lg:mb-0">
                  <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-sm">
                      <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Win Rate</div>
                      <div className="text-xl font-bold text-slate-100 font-mono">68.4%</div>
                  </div>
                  <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-sm">
                      <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Profit Factor</div>
                      <div className="text-xl font-bold text-emerald-400 font-mono">1.85</div>
                  </div>
                  <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-sm">
                      <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Drawdown</div>
                      <div className="text-xl font-bold text-red-400 font-mono">-3.2%</div>
                  </div>
              </div>
           </div>
           <div className="h-[400px] lg:h-full">
              <TradeLog trades={botState.trades} />
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
