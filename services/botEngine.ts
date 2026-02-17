import { ActionType, BotState, Candle, Trade, PendingTrade, Position, TrainingDataPoint } from '../types';
import { TRADING_FEE_RATE } from '../constants';

// Simulating a trained PPO agent policy
export const getAgentAction = (candle: Candle): { action: ActionType; confidence: number } => {
  const { rsi, emaShort, emaLong, close } = candle;
  
  // Default Hold
  let action = ActionType.HOLD;
  let confidence = 0.5;

  if (rsi && emaShort && emaLong) {
      // Overbought / Oversold logic mixed with Trend Following
      if (rsi < 30 && emaShort > emaLong) {
          action = ActionType.BUY;
          confidence = 0.8 + Math.random() * 0.1;
      } else if (rsi > 70 && emaShort < emaLong) {
          action = ActionType.SELL;
          confidence = 0.8 + Math.random() * 0.1;
      } else if (emaShort > emaLong && close > emaShort) {
          // Strong Trend
          action = Math.random() > 0.7 ? ActionType.BUY : ActionType.HOLD;
          confidence = 0.6;
      } else if (emaShort < emaLong && close < emaShort) {
          // Strong Downtrend
          action = Math.random() > 0.7 ? ActionType.SELL : ActionType.HOLD;
          confidence = 0.6;
      }
  }

  // Random noise to simulate "learning" or imperfect exploration
  if (Math.random() < 0.1) {
      const actions = [ActionType.BUY, ActionType.SELL, ActionType.HOLD];
      action = actions[Math.floor(Math.random() * actions.length)];
      confidence = 0.3; // Low confidence exploration
  }

  return { action, confidence };
};

export const getTradePreview = (
    state: BotState,
    action: ActionType,
    price: number,
    symbol: string
): PendingTrade | null => {
    if (action === ActionType.BUY) {
        // Buy with 20% of available balance
        const tradeValueUSDT = state.balance * 0.2;
        if (tradeValueUSDT <= 10) return null; // Minimum trade size

        const fee = tradeValueUSDT * TRADING_FEE_RATE;
        // Amount of crypto received is (Value - Fee) / Price
        const amountCrypto = (tradeValueUSDT - fee) / price;

        // Auto-calculate SL/TP for preview (Stop Loss -2%, Take Profit +4%)
        const stopLoss = price * 0.98;
        const takeProfit = price * 1.04;

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
    takeProfit?: number
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
                pnl: pnl 
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
        let triggeredAction: 'SL' | 'TP' | null = null;

        // Check Stop Loss
        if (pos.stopLoss && currentPrice <= pos.stopLoss) {
            triggeredAction = 'SL';
        }
        // Check Take Profit
        else if (pos.takeProfit && currentPrice >= pos.takeProfit) {
            triggeredAction = 'TP';
        }

        if (triggeredAction) {
            // Execute Sell for this specific position amount
            newState = executeTrade(
                newState,
                ActionType.SELL,
                currentPrice,
                symbol,
                pos.amount
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