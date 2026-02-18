import { ActionType, BotState, Candle, Trade, PendingTrade, Position, TrainingDataPoint, TradeExitReason } from '../types';
import { TRADING_FEE_RATE } from '../constants';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const getAverageRangePct = (candles: Candle[], length: number = 20): number => {
  if (candles.length === 0) return 0;
  const window = candles.slice(-length);
  const ranges = window.map(c => (c.high - c.low) / (c.close || 1));
  return ranges.reduce((acc, v) => acc + v, 0) / Math.max(ranges.length, 1);
};

const getMomentum = (candles: Candle[], lookback: number): number => {
  if (candles.length <= lookback) return 0;
  const last = candles[candles.length - 1].close;
  const previous = candles[candles.length - 1 - lookback].close;
  return previous > 0 ? (last - previous) / previous : 0;
};

// Refined deterministic signal engine (trend + momentum + RSI + volatility + volume regime).
export const getAgentAction = (candles: Candle[]): { action: ActionType; confidence: number } => {
  if (candles.length < 25) {
    return { action: ActionType.HOLD, confidence: 0.35 };
  }

  const current = candles[candles.length - 1];
  const avgRangePct = getAverageRangePct(candles, 20);
  const fastMomentum = getMomentum(candles, 3);
  const slowMomentum = getMomentum(candles, 10);

  const trendComponent = (current.emaShort && current.emaLong)
    ? (current.emaShort - current.emaLong) / (current.close || 1)
    : 0;

  const rsiComponent = typeof current.rsi === 'number'
    ? (50 - current.rsi) / 50 // >0 buy bias, <0 sell bias
    : 0;

  const avgVolume = candles.slice(-20).reduce((acc, c) => acc + c.volume, 0) / 20;
  const volumeComponent = avgVolume > 0 ? ((current.volume - avgVolume) / avgVolume) : 0;

  // Refinement score (higher absolute score => stronger conviction).
  const rawScore =
    (trendComponent * 8.0) * 0.35 +
    (fastMomentum * 6.0) * 0.25 +
    (slowMomentum * 4.0) * 0.20 +
    (rsiComponent) * 0.15 +
    (volumeComponent) * 0.05;

  // Penalize very low or very high volatility regimes.
  const volatilityPenalty =
    avgRangePct < 0.0012 ? 0.80 :
    avgRangePct > 0.03 ? 0.85 :
    1.0;

  const score = rawScore * volatilityPenalty;
  const absScore = Math.abs(score);

  if (absScore < 0.18) {
    return { action: ActionType.HOLD, confidence: clamp(0.45 - absScore, 0.2, 0.45) };
  }

  return {
    action: score > 0 ? ActionType.BUY : ActionType.SELL,
    confidence: clamp(0.55 + absScore, 0.55, 0.95),
  };
};

export const getTradePreview = (
    state: BotState,
    action: ActionType,
    price: number,
    symbol: string,
    candles: Candle[]
): PendingTrade | null => {
    const avgRangePct = getAverageRangePct(candles, 20);

    if (action === ActionType.BUY) {
        // Volatility-aware sizing for paper mode.
        const normalizedVol = clamp(avgRangePct / 0.02, 0, 1.5);
        const allocationPct = clamp(0.22 - normalizedVol * 0.08, 0.08, 0.22);
        const tradeValueUSDT = state.balance * allocationPct;
        if (tradeValueUSDT <= 10) return null; // Minimum trade size

        const fee = tradeValueUSDT * TRADING_FEE_RATE;
        const amountCrypto = (tradeValueUSDT - fee) / price;

        // Dynamic SL/TP based on current volatility regime.
        const stopLossPct = clamp(avgRangePct * 1.8, 0.008, 0.03);
        const takeProfitPct = clamp(stopLossPct * 1.9, 0.016, 0.07);
        const stopLoss = price * (1 - stopLossPct);
        const takeProfit = price * (1 + takeProfitPct);

        return {
            symbol,
            action,
            price,
            amount: amountCrypto,
            totalValue: tradeValueUSDT,
            fee,
            stopLoss,
            takeProfit
        };
    } else if (action === ActionType.SELL) {
        const currentHolding = state.holdings[symbol] || 0;
        if (currentHolding <= 0) return null;

        // Default to selling 100% of holdings
        const sellPercentage = 1.0; 
        const amountToSell = currentHolding * sellPercentage;

        if (amountToSell <= 0) return null;

        const grossValue = amountToSell * price;
        const fee = grossValue * TRADING_FEE_RATE;

        return {
            symbol,
            action,
            price,
            amount: amountToSell,
            totalValue: grossValue,
            fee
        };
    }
    return null;
};

export const executeTrade = (
    state: BotState, 
    action: ActionType, 
    price: number, 
    symbol: string,
    amount?: number, // Explicit amount to trade (crypto units)
    stopLoss?: number,
    takeProfit?: number,
    metadata?: { exitReason?: TradeExitReason }
): BotState => {
    let newState = { ...state };
    
    // Ensure data structures exist
    if (!newState.averageEntryPrices) newState.averageEntryPrices = {};
    if (!newState.activePositions) newState.activePositions = [];

    if (action === ActionType.BUY) {
        let tradeAmountUSDT = 0;
        let amountCrypto = 0;
        let fee = 0;

        if (amount) {
            amountCrypto = amount;
            tradeAmountUSDT = (amountCrypto * price) / (1 - TRADING_FEE_RATE);
            fee = tradeAmountUSDT * TRADING_FEE_RATE;
        } else {
            tradeAmountUSDT = newState.balance * 0.2; 
            if (tradeAmountUSDT <= 10) return newState; // Too small
            fee = tradeAmountUSDT * TRADING_FEE_RATE;
            amountCrypto = (tradeAmountUSDT - fee) / price;
        }

        if (newState.balance >= tradeAmountUSDT) {
            // Update Average Entry Price
            const currentHolding = newState.holdings[symbol] || 0;
            const currentAvgPrice = newState.averageEntryPrices[symbol] || 0;
            
            const currentTotalCost = currentHolding * currentAvgPrice;
            const newTotalCost = currentTotalCost + tradeAmountUSDT; 
            const newTotalHolding = currentHolding + amountCrypto;
            
            newState.averageEntryPrices[symbol] = newTotalHolding > 0 ? newTotalCost / newTotalHolding : 0;
            newState.balance -= tradeAmountUSDT;
            newState.holdings[symbol] = newTotalHolding;
            
            const tradeId = Math.random().toString(36).substr(2, 9);
            const trade: Trade = {
                id: tradeId,
                symbol,
                type: ActionType.BUY,
                price,
                amount: amountCrypto,
                timestamp: Date.now(),
                fee: fee,
                stopLoss: stopLoss,
                takeProfit: takeProfit
            };
            newState.trades = [trade, ...newState.trades];

            // Create new Open Position for tracking SL/TP
            const newPosition: Position = {
                id: tradeId,
                symbol,
                entryPrice: price,
                amount: amountCrypto,
                stopLoss,
                takeProfit,
                timestamp: Date.now()
            };
            newState.activePositions = [...newState.activePositions, newPosition];
        }

    } else if (action === ActionType.SELL) {
        const currentHolding = newState.holdings[symbol] || 0;
        const sellAmount = amount !== undefined ? amount : currentHolding;
        const finalSellAmount = Math.min(sellAmount, currentHolding);

        if (finalSellAmount > 0) {
            const revenue = finalSellAmount * price;
            const feeCost = revenue * TRADING_FEE_RATE;
            const netRevenue = revenue - feeCost;

            // Calculate PnL
            const avgEntryPrice = newState.averageEntryPrices[symbol] || 0;
            const costBasis = finalSellAmount * avgEntryPrice;
            const pnl = netRevenue - costBasis;

            newState.balance += netRevenue;
            newState.holdings[symbol] = currentHolding - finalSellAmount;
            
            if (newState.holdings[symbol] <= 0.000001) {
                 newState.holdings[symbol] = 0;
                 newState.averageEntryPrices[symbol] = 0;
            }

            const trade: Trade = {
                id: Math.random().toString(36).substr(2, 9),
                symbol,
                type: ActionType.SELL,
                price,
                amount: finalSellAmount,
                timestamp: Date.now(),
                fee: feeCost,
                pnl: pnl,
                stopLoss,
                takeProfit,
                exitReason: metadata?.exitReason || 'SIGNAL',
            };
            newState.trades = [trade, ...newState.trades];

            // Reconcile activePositions
            // FIFO: Reduce amount from oldest positions of this symbol until requirement met
            let remainingToSell = finalSellAmount;
            
            newState.activePositions = newState.activePositions.map(pos => {
                if (pos.symbol !== symbol || remainingToSell <= 0) return pos;

                if (pos.amount <= remainingToSell) {
                    remainingToSell -= pos.amount;
                    return null; // Mark for deletion
                } else {
                    const updatedPos = { 
                        ...pos, 
                        amount: pos.amount - remainingToSell
                    };
                    
                    // Update SL/TP if new values provided
                    if (stopLoss !== undefined) updatedPos.stopLoss = stopLoss;
                    if (takeProfit !== undefined) updatedPos.takeProfit = takeProfit;

                    remainingToSell = 0;
                    return updatedPos;
                }
            }).filter((pos): pos is Position => pos !== null);
        }
    }

    // Recalculate Portfolio Value
    const holdingsValue = Object.entries(newState.holdings).reduce((acc, [sym, amt]) => {
        if (sym === symbol) return acc + amt * price;
        return acc; 
    }, 0);
    
    const otherHoldingsValue = Object.entries(newState.holdings).reduce((acc, [sym, amt]) => {
        if (sym !== symbol) {
             const entry = newState.averageEntryPrices[sym] || 0;
             return acc + amt * entry;
        }
        return acc;
    }, 0);

    newState.totalPortfolioValue = newState.balance + holdingsValue + otherHoldingsValue;

    return newState;
};

// Check open positions and auto-sell if SL/TP hit
export const checkAutoExits = (
    state: BotState, 
    currentPrice: number, 
    symbol: string,
    currentCandle: Candle
): BotState => {
    let newState = { ...state };
    if (!newState.activePositions) return newState;

    // Filter for positions of the current active symbol
    const symbolPositions = newState.activePositions.filter(p => p.symbol === symbol);

    for (const pos of symbolPositions) {
        let triggeredAction: TradeExitReason | null = null;

        // Check Stop Loss
        if (pos.stopLoss && currentPrice <= pos.stopLoss) {
            triggeredAction = 'STOP_LOSS';
        }
        // Check Take Profit
        else if (pos.takeProfit && currentPrice >= pos.takeProfit) {
            triggeredAction = 'TAKE_PROFIT';
        }

        if (triggeredAction) {
            // Execute Sell for this specific position amount
            newState = executeTrade(
                newState,
                ActionType.SELL,
                currentPrice,
                symbol,
                pos.amount,
                pos.stopLoss,
                pos.takeProfit,
                { exitReason: triggeredAction }
            );

            // Log this specific auto-action to training log
            const lastTrade = newState.trades[0]; // The one just created
             const logEntry: TrainingDataPoint = {
                timestamp: Date.now(),
                candle: currentCandle,
                action: ActionType.SELL,
                confidence: 1.0, 
                marketStatus: newState.marketStatus,
                pnl: lastTrade.pnl
            };
            newState.trainingDataLog = [logEntry, ...newState.trainingDataLog].slice(0, 500);
            
            console.log(`Auto-Exit Triggered: ${triggeredAction} for ${symbol} at ${currentPrice}`);
        }
    }

    return newState;
};
