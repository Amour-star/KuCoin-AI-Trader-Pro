import { Trade } from '../../types';

const TRADE_STORAGE_KEY = 'kucoin-paper-trades-v2';
const TRADE_STORAGE_EVENT = 'kucoin-paper-trades-updated';
const MAX_STORED_TRADES = 2000;

let inMemoryTrades: Trade[] = [];

const canUseLocalStorage = (): boolean =>
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const sortTrades = (trades: Trade[]): Trade[] =>
  [...trades].sort((a, b) => b.timestamp - a.timestamp);

const normalizeTrades = (trades: Trade[]): Trade[] => sortTrades(trades).slice(0, MAX_STORED_TRADES);

const dispatchTradesUpdated = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TRADE_STORAGE_EVENT));
};

const tryParse = (raw: string | null): Trade[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Trade => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as Partial<Trade>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.symbol === 'string' &&
        typeof candidate.timestamp === 'number' &&
        typeof candidate.amount === 'number' &&
        typeof candidate.price === 'number'
      );
    });
  } catch {
    return [];
  }
};

export const loadTrades = (): Trade[] => {
  if (!canUseLocalStorage()) {
    return normalizeTrades(inMemoryTrades);
  }

  const trades = tryParse(window.localStorage.getItem(TRADE_STORAGE_KEY));
  inMemoryTrades = normalizeTrades(trades);
  return inMemoryTrades;
};

export const saveTrades = (trades: Trade[]): Trade[] => {
  const normalized = normalizeTrades(trades);
  inMemoryTrades = normalized;

  if (canUseLocalStorage()) {
    window.localStorage.setItem(TRADE_STORAGE_KEY, JSON.stringify(normalized));
    dispatchTradesUpdated();
  }

  return normalized;
};

export const appendTrade = (trade: Trade): Trade[] => {
  const current = loadTrades();
  return saveTrades([trade, ...current]);
};

export const clearTrades = (): void => {
  inMemoryTrades = [];
  if (canUseLocalStorage()) {
    window.localStorage.removeItem(TRADE_STORAGE_KEY);
    dispatchTradesUpdated();
  }
};

export const subscribeToTradeStorage = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (): void => listener();
  window.addEventListener(TRADE_STORAGE_EVENT, handler);
  window.addEventListener('storage', handler);

  return () => {
    window.removeEventListener(TRADE_STORAGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
};
