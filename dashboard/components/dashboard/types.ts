import { price, time } from "./format";

export type Runner = {
  symbol: string;
  price: number;
  equity: number;
  returnPct: number;
  lastProcessed: number | null;
  lastNote: string;
  position: any;
  metrics: any;
  risk: any;
};

export type RuntimeEvent = {
  id: number;
  timestamp: number;
  level: string;
  category: string;
  message: string;
  symbol?: string;
  source?: string;
};

export type Status = {
  telemetry?: {
    lastSuccessfulBinanceAt: number | null;
    lastCandleAt: number | null;
    lastBinanceError: { at: number; message: string } | null;
    mode: string;
  };
  mode: string;
  demo?: {environment:string; endpoint:string; allowEntries:boolean; notionalCap:number; budget:number; accountWallet:number|null; accountAvailable:number|null; allocatedEquity:number; protection:string; fault:string|null; pendingEntry:string|null; pendingClose:string|null; pendingAccounting:boolean; connected:boolean; lastSyncAt:number|null};
  direction?: string;
  running: boolean;
  strategy: string;
  interval: string;
  updatedAt: number;
  portfolio: {
    startingBalance: number;
    equity: number;
    returnPct: number;
  };
  metrics: any;
  runners: Runner[];
};

export type Market = {
  symbol: string;
  price: number;
  change: number;
  signal: string;
  score: number;
  maxScore: number;
  rsi: number | null;
  adx: number | null;
};

export type Trade = {
  symbol: string;
  side?: "LONG" | "SHORT";
  leverage?: number;
  margin?: number;
  funding?: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  reason: string;
  netPnL: number;
  fees: number;
  rMultiple: number;
};
export type BacktestResult = {
  config: {
    symbol: string;
    direction?: string;
    interval: string;
    candlesRequested: number;
    candlesUsed: number;
    feeRate: number;
    slippage: number;
    trailing: boolean;
    split: number;
    haltResumeDays: number;
    strategy?: string;
  };
  period: {
    candles: number;
    days: number;
  };
  full: {
    metrics: {
      startingBalance: number;
      finalEquity: number;
      returnPct: number;
      trades: number;
      winRate: number;
      profitFactor: number;
      expectancy: number;
      avgR: number;
      avgWin: number;
      avgLoss: number;
      payoff: number;
      fees: number;
      maxDrawdownPct: number;
      sharpe: number;
      sortino: number;
      maxLossStreak: number;
      byReason: Record<string, number>;
    };
    buyHold: number;
    trades: any[];
    equityCurve: {
      time: number;
      equity: number;
    }[];
  };
  inSample: {
    metrics: BacktestResult["full"]["metrics"];
    buyHold: number;
    trades: any[];
    equityCurve: {
      time: number;
      equity: number;
    }[];
  };
  outSample: {
    metrics: BacktestResult["full"]["metrics"];
    buyHold: number;
    trades: any[];
    equityCurve: {
      time: number;
      equity: number;
    }[];
  };
  risk: {
    haltExits: number;
  };
  csv: string;
};
