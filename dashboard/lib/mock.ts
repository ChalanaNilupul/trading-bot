export const equity = [
  { t: "Sep 25", v: 1000 }, { t: "Sep 27", v: 1008 }, { t: "Sep 29", v: 1004 },
  { t: "Oct 1", v: 1022 }, { t: "Oct 3", v: 1017 }, { t: "Oct 5", v: 1041 },
  { t: "Oct 6", v: 1058 }, { t: "Oct 7", v: 1067 }, { t: "Oct 8", v: 1084 }
];

export const markets = [
  { symbol: "BTCUSDT", price: 123842.2, change: 2.14, signal: "BUY", score: 8, rsi: 58, adx: 31, trend: "Bullish" },
  { symbol: "ETHUSDT", price: 4521.74, change: 1.72, signal: "BUY", score: 7, rsi: 55, adx: 28, trend: "Bullish" },
  { symbol: "SOLUSDT", price: 238.61, change: -0.42, signal: "HOLD", score: 5, rsi: 48, adx: 18, trend: "Neutral" },
  { symbol: "BNBUSDT", price: 1124.18, change: 0.91, signal: "BUY", score: 7, rsi: 57, adx: 26, trend: "Bullish" },
  { symbol: "XRPUSDT", price: 2.91, change: -1.16, signal: "HOLD", score: 4, rsi: 44, adx: 16, trend: "Neutral" },
  { symbol: "ADAUSDT", price: 0.91, change: 1.31, signal: "BUY", score: 6, rsi: 53, adx: 24, trend: "Bullish" }
];

export const trades = [
  { time: "Today 18:42", symbol: "ETHUSDT", side: "LONG", entry: 4481.2, exit: 4520.7, pnl: 8.64, r: 1.12, reason: "Breakout + ADX confirmation" },
  { time: "Today 14:16", symbol: "BTCUSDT", side: "LONG", entry: 122740, exit: 123410, pnl: 5.42, r: 0.74, reason: "Trend continuation" },
  { time: "Yesterday 22:04", symbol: "SOLUSDT", side: "LONG", entry: 241.2, exit: 238.8, pnl: -3.11, r: -1, reason: "Stop loss" },
  { time: "Yesterday 11:30", symbol: "BNBUSDT", side: "LONG", entry: 1108.1, exit: 1120.2, pnl: 6.21, r: 1.34, reason: "Target hit" }
];

export const positions = [
  { symbol: "ETHUSDT", side: "LONG", entry: 4481.2, current: 4521.74, qty: 0.18, stop: 4412.5, target: 4624.0, pnl: 7.3, risk: 0.91 },
  { symbol: "BTCUSDT", side: "LONG", entry: 122740, current: 123842.2, qty: 0.004, stop: 120900, target: 126500, pnl: 4.41, risk: 0.76 }
];
