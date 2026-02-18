import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BotState, Candle, MarketData, ActionType, PendingTrade, TradeExitReason } from './types';
import { INITIAL_BALANCE, SYMBOLS, TICK_INTERVAL_MS } from './constants';
import { fetchCandles, fetchLatestTicker, fetchTopCoins, getConnectivityStatus } from './services/marketService';
import {
  confirmPendingTrade,
  runBotEngineCycle,
  syncBotStateWithStrategy,
  triggerStrategyRefinement,
} from './services/botEngine';
import { getStrategySummary } from './services/engine/strategyState';
import { clearTrades, loadTrades, saveTrades } from './services/storage/tradeStorage';
import Chart from './components/Chart';
import BotControl from './components/BotControl';
import TradeLog from './components/TradeLog';
import TradeConfirmationModal from './components/TradeConfirmationModal';
import { Zap, Settings, RefreshCw, Globe } from 'lucide-react';
import { MultiSymbolEngine } from './core/MultiSymbolEngine';
import { coreEventBus } from './core/EventBus';
import PerformanceDashboard from './components/PerformanceDashboard';
import InstitutionalDashboard from './dashboard/InstitutionalDashboard';
import { LatencyArbitrageDetector } from './latency/LatencyArbitrageDetector';
import ManualTradePanel from './components/ManualTradePanel';
import { getBackendStatus, getBackendTrades } from './services/backendApi';

const BOT_STATE_STORAGE_KEY = 'kucoin-paper-bot-state-v2';
const createInitialBotState = (): BotState => {
  const strategy = getStrategySummary();
  return {
    isRunning: false,
    autoPaperTrading: true,
    connectivity: 'CONNECTING',
    balance: INITIAL_BALANCE,
    holdings: {},
    averageEntryPrices: {},
    activePositions: [],
    totalPortfolioValue: INITIAL_BALANCE,
    activeSymbol: SYMBOLS[0],
    marketStatus: 'ACTIVE',
    lastTrainingTime: Date.now(),
    trades: loadTrades(),
    trainingDataLog: [],
    strategyVersion: strategy.version,
    lastRefinementTime: strategy.lastRefinementTime,
    refinementStatus: 'IDLE',
    aiWarnings: strategy.warnings,
  };
};

const loadPersistedBotState = (): BotState => {
  const fallback = createInitialBotState();
  if (typeof window === 'undefined') return fallback;

  try {
    const raw = window.localStorage.getItem(BOT_STATE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BotState>;
    const strategy = getStrategySummary();

    return {
      ...fallback,
      ...parsed,
      holdings: parsed.holdings || {},
      averageEntryPrices: parsed.averageEntryPrices || {},
      activePositions: parsed.activePositions || [],
      trades: loadTrades(),
      trainingDataLog: parsed.trainingDataLog || [],
      autoPaperTrading: parsed.autoPaperTrading ?? true,
      strategyVersion: strategy.version,
      lastRefinementTime: strategy.lastRefinementTime,
      aiWarnings: strategy.warnings,
      refinementStatus: parsed.refinementStatus || 'IDLE',
    };
  } catch {
    return fallback;
  }
};

const App: React.FC = () => {
  const [activeSymbol, setActiveSymbol] = useState(() => loadPersistedBotState().activeSymbol || SYMBOLS[0]);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>(SYMBOLS);
  const [marketData, setMarketData] = useState<MarketData>({
    symbol: SYMBOLS[0],
    price: 0,
    volume24h: 0,
    change24h: 0,
  });
  const [candles, setCandles] = useState<Candle[]>([]);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingMetrics, setTrainingMetrics] = useState<{ epoch: number; loss: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.6);
  const [streamLagMs, setStreamLagMs] = useState<number>(0);
  const [exposureBySymbol, setExposureBySymbol] = useState<Record<string, number>>({});
  const [latencyHeatmap, setLatencyHeatmap] = useState<Record<string, number>>({});
  const [strategyCounters, setStrategyCounters] = useState({ totalEvaluations: 0, totalSignals: 0, totalTradesExecuted: 0 });
  const [backendHeartbeat, setBackendHeartbeat] = useState<string>('N/A');
  const [backendConnected, setBackendConnected] = useState(false);

  const [botState, setBotState] = useState<BotState>(() => loadPersistedBotState());

  const tickCountRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const botStateRef = useRef<BotState>(botState);
  const latencyDetectorRef = useRef(new LatencyArbitrageDetector());

  useEffect(() => {
    botStateRef.current = botState;
  }, [botState]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BOT_STATE_STORAGE_KEY, JSON.stringify(botState));
    } catch {
      // ignore localStorage failures
    }
  }, [botState]);

  useEffect(() => {
    saveTrades(botState.trades);
  }, [botState.trades]);

  useEffect(() => {
    const exposures: Record<string, number> = {};
    for (const pos of botState.activePositions) exposures[pos.symbol] = (exposures[pos.symbol] || 0) + pos.amount * pos.entryPrice;
    setExposureBySymbol(exposures);
  }, [botState.activePositions]);

  useEffect(() => {
    const initData = async () => {
      setIsLoading(true);
      let symbolToLoad = activeSymbol;
      const topCoins = await fetchTopCoins();
      if (topCoins.length > 0) {
        setAvailableSymbols(topCoins.map(coin => coin.symbol));
        if (!topCoins.find(coin => coin.symbol === activeSymbol)) {
          symbolToLoad = topCoins[0].symbol;
          setActiveSymbol(symbolToLoad);
          setMarketData(topCoins[0]);
        }
      }
      const initialCandles = await fetchCandles(symbolToLoad);
      setCandles(initialCandles);
      candlesRef.current = initialCandles;
      setIsLoading(false);
    };
    void initData();
  }, []);

  useEffect(() => {
    const refreshBackend = async () => {
      try {
        const [status, trades] = await Promise.all([getBackendStatus(), getBackendTrades(100)]);
        setBackendConnected(true);
        setBackendHeartbeat(status.lastHeartbeatTs ?? 'N/A');
        setStrategyCounters({
          totalEvaluations: status.evaluationsCount,
          totalSignals: status.signalsCount,
          totalTradesExecuted: status.tradesExecutedCount,
        });
        setBotState(prev => ({ ...prev, autoPaperTrading: status.autoPaper, trades }));
      } catch {
        setBackendConnected(false);
        // backend may be offline during frontend-only development.
      }
    };
    void refreshBackend();
    const id = window.setInterval(() => {
      void refreshBackend();
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const switchSymbol = async () => {
      setIsLoading(true);
      const newCandles = await fetchCandles(activeSymbol);
      setCandles(newCandles);
      candlesRef.current = newCandles;
      const ticker = await fetchLatestTicker(activeSymbol);
      if (ticker) setMarketData(ticker);
      setIsLoading(false);
      tickCountRef.current = 0;
    };
    if (!isLoading) {
      void switchSymbol();
    }
  }, [activeSymbol]);

  useEffect(() => {
    setBotState(prev => ({ ...prev, activeSymbol }));
  }, [activeSymbol]);

  useEffect(() => {
    const off = coreEventBus.on('market:update', payload => {
      setStreamLagMs(payload.lagMs);
      const detector = latencyDetectorRef.current;
      detector.onUpdate({
        exchange: 'BINANCE',
        symbol: payload.symbol,
        bid: payload.close * 0.9999,
        ask: payload.close * 1.0001,
        serverTs: payload.candleCloseTs,
        localReceiveTs: Date.now(),
      });
      setLatencyHeatmap(detector.getLatencyHeatmap());
    });
    const offStats = coreEventBus.on('strategy:stats', payload => {
      setStrategyCounters(payload);
    });
    return () => {
      off();
      offStats();
    };
  }, []);

  useEffect(() => {
    if (backendConnected) return;
    const engine = new MultiSymbolEngine({
      symbols: availableSymbols.length > 0 ? availableSymbols : [activeSymbol],
      interval: '1m',
      maxConcurrentSymbols: 4,
      maxBuffer: 500,
    }, () => botStateRef.current, trade => {
      setBotState(prev => {
        const nextTrades = [...prev.trades, trade];
        const holdings = { ...prev.holdings };
        const avg = { ...prev.averageEntryPrices };
        let balance = prev.balance;
        if (trade.type === ActionType.BUY) {
          balance -= trade.price * trade.amount + trade.fee;
          holdings[trade.symbol] = (holdings[trade.symbol] || 0) + trade.amount;
          avg[trade.symbol] = trade.price;
        } else {
          balance += trade.price * trade.amount - trade.fee;
          holdings[trade.symbol] = Math.max(0, (holdings[trade.symbol] || 0) - trade.amount);
        }
        return { ...prev, trades: nextTrades, holdings, averageEntryPrices: avg, balance, totalPortfolioValue: balance };
      });
    });
    void engine.start();
    return () => engine.stop();
  }, [availableSymbols, activeSymbol, backendConnected]);

  const runBotCycle = useCallback(async () => {
    const ticker = await fetchLatestTicker(activeSymbol);
    if (!ticker) return;
    setMarketData(ticker);

    const existingCandles = candlesRef.current;
    if (existingCandles.length === 0) return;

    const lastBase = existingCandles[existingCandles.length - 1];
    const normalizedCurrent: Candle = {
      ...lastBase,
      close: ticker.price,
      high: Math.max(lastBase.high, ticker.price),
      low: Math.min(lastBase.low, ticker.price),
    };
    const candlesForDecision = [...existingCandles.slice(0, -1), normalizedCurrent];
    candlesRef.current = candlesForDecision;
    setCandles(candlesForDecision);

    const cycle = runBotEngineCycle({
      state: botStateRef.current,
      symbol: activeSymbol,
      candles: candlesForDecision,
      currentPrice: ticker.price,
      confidenceThreshold,
    });

    const syncedState = syncBotStateWithStrategy({
      ...cycle.state,
      connectivity: getConnectivityStatus(),
    });
    botStateRef.current = syncedState;
    setBotState(syncedState);

    if (!syncedState.autoPaperTrading) {
      setPendingTrade(cycle.pendingTrade);
    } else {
      setPendingTrade(null);
    }

    tickCountRef.current += 1;
    if (tickCountRef.current % 30 === 0) {
      const freshCandles = await fetchCandles(activeSymbol);
      if (freshCandles.length > 0) {
        setCandles(freshCandles);
        candlesRef.current = freshCandles;
      }
    }
  }, [activeSymbol, confidenceThreshold]);

  useEffect(() => {
    if (backendConnected) return;
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      void runBotCycle();
    }, TICK_INTERVAL_MS);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [runBotCycle, backendConnected]);

  const handleToggleBot = () => {
    setBotState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  };

  const handleToggleAutoPaperTrading = () => {
    setBotState(prev => ({ ...prev, autoPaperTrading: !prev.autoPaperTrading }));
    setPendingTrade(null);
  };

  const handleRetrain = async () => {
    if (isTraining) return;
    setIsTraining(true);
    setTrainingMetrics([]);
    setBotState(prev => ({ ...prev, refinementStatus: 'RUNNING' }));

    let epoch = 0;
    const maxEpochs = 20;
    const progressInterval = window.setInterval(() => {
      epoch += 1;
      const baseLoss = 0.55 * Math.exp(-epoch / 7);
      const wave = Math.sin(epoch * 0.8) * 0.02;
      const loss = Math.max(0, baseLoss + wave);
      setTrainingMetrics(prev => [...prev, { epoch, loss }]);
      if (epoch >= maxEpochs) {
        window.clearInterval(progressInterval);
      }
    }, 100);

    const status = await triggerStrategyRefinement();
    window.clearInterval(progressInterval);
    setIsTraining(false);
    setBotState(prev =>
      syncBotStateWithStrategy({
        ...prev,
        lastTrainingTime: Date.now(),
        refinementStatus: status,
      }),
    );
  };

  const handleResetSession = () => {
    if (window.confirm('Are you sure you want to reset your paper trading session?')) {
      clearTrades();
      const strategy = getStrategySummary();
      const resetState: BotState = {
        isRunning: false,
        autoPaperTrading: botState.autoPaperTrading,
        connectivity: getConnectivityStatus(),
        balance: INITIAL_BALANCE,
        holdings: {},
        averageEntryPrices: {},
        activePositions: [],
        totalPortfolioValue: INITIAL_BALANCE,
        activeSymbol,
        marketStatus: 'ACTIVE',
        lastTrainingTime: Date.now(),
        trades: [],
        trainingDataLog: [],
        strategyVersion: strategy.version,
        lastRefinementTime: strategy.lastRefinementTime,
        refinementStatus: 'IDLE',
        aiWarnings: strategy.warnings,
      };
      botStateRef.current = resetState;
      setBotState(resetState);
      setPendingTrade(null);
      tickCountRef.current = 0;
    }
  };

  const confirmTrade = (finalTrade: PendingTrade, exitReason: TradeExitReason = 'MANUAL') => {
    setBotState(prev => syncBotStateWithStrategy(confirmPendingTrade(prev, finalTrade, exitReason)));
    setPendingTrade(null);
  };

  const backtestMetrics = useMemo(() => {
    const closedTrades = botState.trades
      .filter(trade => trade.type === ActionType.SELL && typeof trade.pnl === 'number')
      .sort((a, b) => a.timestamp - b.timestamp);

    const closedCount = closedTrades.length;
    const winningTrades = closedTrades.filter(trade => (trade.pnl || 0) > 0).length;
    const winRate = closedCount > 0 ? (winningTrades / closedCount) * 100 : 0;

    const grossProfit = closedTrades.reduce((acc, trade) => acc + Math.max(trade.pnl || 0, 0), 0);
    const grossLossAbs = closedTrades.reduce((acc, trade) => acc + Math.abs(Math.min(trade.pnl || 0, 0)), 0);
    const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;

    let equity = INITIAL_BALANCE;
    let peak = INITIAL_BALANCE;
    let maxDrawdownPct = 0;

    for (const trade of closedTrades) {
      equity += trade.pnl || 0;
      if (equity > peak) peak = equity;
      const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    }

    return {
      closedCount,
      winRate,
      profitFactor,
      maxDrawdownPct,
    };
  }, [botState.trades]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col">
      <TradeConfirmationModal
        isOpen={!botState.autoPaperTrading && !!pendingTrade}
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
              <p className="text-xs text-slate-500 font-mono">v3.0.1 | Paper Simulation | Quant Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center bg-slate-800 rounded p-1 overflow-x-auto no-scrollbar border border-slate-700">
              {availableSymbols.map(symbol => (
                <button
                  key={symbol}
                  onClick={() => setActiveSymbol(symbol)}
                  className={`text-xs px-3 py-1.5 rounded font-medium transition whitespace-nowrap ${
                    activeSymbol === symbol ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {symbol.replace('-USDC', '')}
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
          onRetrain={() => {
            void handleRetrain();
          }}
          onReset={handleResetSession}
          isTraining={isTraining}
          trainingMetrics={trainingMetrics}
          confidenceThreshold={confidenceThreshold}
          setConfidenceThreshold={setConfidenceThreshold}
          autoPaperTrading={botState.autoPaperTrading}
          onToggleAutoPaperTrading={handleToggleAutoPaperTrading}
        />

        <div className="mb-3 text-xs text-slate-400 font-mono">[STREAM LAG ms] <span className="text-slate-200">{streamLagMs}</span></div>
        <div className="mb-3 text-xs text-slate-400 font-mono">[ENGINE HEARTBEAT] <span className="text-slate-200">{backendHeartbeat}</span></div>
        <ManualTradePanel symbol={activeSymbol.replace('-', '')} />
        <div className="mb-4"><PerformanceDashboard trades={botState.trades} initialEquity={INITIAL_BALANCE} exposureBySymbol={exposureBySymbol} strategyCounters={strategyCounters} /></div>
        <div className="mb-4"><InstitutionalDashboard trades={botState.trades} latencyHeatmap={latencyHeatmap} /></div>

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
                <div className={`text-xl font-bold font-mono ${backtestMetrics.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {backtestMetrics.winRate.toFixed(1)}%
                </div>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-sm">
                <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Profit Factor</div>
                <div className={`text-xl font-bold font-mono ${backtestMetrics.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {Number.isFinite(backtestMetrics.profitFactor) ? backtestMetrics.profitFactor.toFixed(2) : 'INF'}
                </div>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 shadow-sm">
                <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Drawdown</div>
                <div className={`text-xl font-bold font-mono ${backtestMetrics.maxDrawdownPct > 0 ? 'text-red-400' : 'text-slate-100'}`}>
                  -{backtestMetrics.maxDrawdownPct.toFixed(2)}%
                </div>
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
