/**
 * Live PAPER bot. Runs continuously, acts once per closed candle, survives restarts.
 * Trades several coins in parallel; each coin has its own pretend $1000 account.
 *
 * Env:
 *   SYMBOLS        comma list (default: the 8 coins that were backtested)
 *   INTERVAL       candle size (default 4h, the timeframe the strategy was validated on)
 *   STRATEGY       name from strategies.js (default "Breakout 50/20")
 *   POLL_SECONDS   how often to check Binance (default 60)
 *   START_BALANCE  pretend balance per coin (default 1000)
 *   ONE_SHOT=1     single pass then exit
 *   RESET_HALT=1   clear a tripped kill switch after you've reviewed why it fired
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   optional alerts
 */

const {
  getFuturesCandles,
  getFuturesTickerPrice,
  getFuturesSymbolFilters,
} = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { DEFAULT_STRATEGY } = require("./strategies");
const { FuturesEngine } = require("./futuresEngine");
const { computeMetrics } = require("./metrics");
const store = require("./store");
const { notify } = require("./notify");
const { AIEntryFilter } = require("./aiFilter");
const { directedStrategy, normalizeDirection } = require("./direction");
const { PortfolioRiskManager } = require("./portfolioRiskManager");

const DEFAULT_SYMBOLS =
  "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,LINKUSDT";
const SYMBOLS = (
  process.env.BOT_SYMBOL ||
  process.env.SYMBOLS ||
  process.env.SYMBOL ||
  DEFAULT_SYMBOLS
)
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const INTERVAL = process.env.INTERVAL || "4h";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const START_BALANCE = Number(process.env.START_BALANCE || 1000);
const LEVERAGE = Number(process.env.LEVERAGE || 5);
const RUNNER_BALANCE = START_BALANCE / SYMBOLS.length;
const ONE_SHOT = process.env.ONE_SHOT === "1";

const DIRECTION = normalizeDirection(process.env.DIRECTION || "LONG");
if (
  process.env.BOT_SYMBOL &&
  (SYMBOLS.length !== 1 || !/^[A-Z0-9]{3,30}$/.test(SYMBOLS[0]))
)
  throw new Error("BOT_SYMBOL must contain exactly one valid symbol");
const strategy = directedStrategy(
  process.env.STRATEGY || DEFAULT_STRATEGY,
  DIRECTION,
);
if (strategy.requiredInterval && INTERVAL !== strategy.requiredInterval) throw new Error(`${strategy.name} requires INTERVAL=${strategy.requiredInterval}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const fmtPF = (pf) => (pf === Infinity ? "inf" : pf.toFixed(2));

const portfolioRisk = new PortfolioRiskManager({
  maxDailyLossPct: Number(process.env.PORTFOLIO_MAX_DAILY_LOSS_PCT || 0.01),
  maxDrawdownPct: Number(process.env.PORTFOLIO_MAX_DRAWDOWN_PCT || 0.05),
  maxOpenPositions: Number(process.env.PORTFOLIO_MAX_OPEN_POSITIONS || 1),
  maxSameDirectionPositions: Number(
    process.env.PORTFOLIO_MAX_SAME_DIRECTION || 1,
  ),
  maxAggregateStopRiskPct: Number(
    process.env.PORTFOLIO_MAX_STOP_RISK_PCT || 0.01,
  ),
});

const PORTFOLIO_STATE_FILE = "data/portfolio-risk-state.json";

function persistPortfolioRisk() {
  store.save(PORTFOLIO_STATE_FILE, portfolioRisk.snapshot());
}

function buildPortfolioSnapshot(runners) {
  const positions = [];
  let equity = 0;

  for (const runner of runners) {
    const engine = runner.engine;
    const markPrice = Number(
      runner.lastPrice || engine.position?.entryPrice || 0,
    );

    // Fail closed if any runner lacks a trustworthy mark price.
    if (!Number.isFinite(markPrice) || markPrice <= 0) {
      return {
        valid: false,
        reason: `Missing mark price for ${runner.symbol}`,
      };
    }

    equity += engine.equity(markPrice);

    if (engine.position) {
      positions.push({
        symbol: runner.symbol,
        side: engine.position.side,
        quantity: engine.position.quantity,
        entryPrice: engine.position.entryPrice,
        stopPrice: engine.position.stopPrice,
      });
    }
  }

  return { valid: Number.isFinite(equity) && equity > 0, equity, positions };
}

class Runner {
  constructor(symbol, options = {}) {
    this.symbol = symbol;
    this.aiFilter = options.aiFilter || new AIEntryFilter();
    this.strategy = options.strategy || strategy;
    this.direction = options.direction || DIRECTION;
    const runnerSlug = this.strategy.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    const suffix =
      process.env.BOT_SYMBOL || process.env.DIRECTION || options.direction
        ? `_${this.direction.toLowerCase()}`
        : "";
    this.lastProcessed = null;
    this.resetToken = null;
    this.errors = 0;
    this.stateFile =
      options.stateFile ||
      `data/state_futures_${symbol}_${INTERVAL}_${runnerSlug}${suffix}.json`;

    this.tradeLog =
      options.tradeLog ||
      `data/trades_futures_${symbol}_${INTERVAL}_${runnerSlug}${suffix}.jsonl`;
    this.engine =
      options.engine ||
      new FuturesEngine({
        startingBalance: RUNNER_BALANCE,
        leverage: LEVERAGE,
        feeRate: Number(process.env.FEE_RATE || 0.0005),
        slippage: Number(process.env.SLIPPAGE || 0.0005),
        fundingRatePer8h: Number(process.env.FUNDING_RATE_8H || 0.0001),
        riskPercent: Number(process.env.RISK_PERCENT || 0.01),
        maxPositionPercent: Number(process.env.MAX_MARGIN_PERCENT || 0.25),
        allowShort: this.direction !== "LONG",
        direction: this.direction,
        keepEquityCurve: false,
        ...this.strategy.engine,
        onEvent: (e) => this.onEvent(e),
      });
    this.lastPrice = null;
    this.lastNote = "";
  }

  onEvent(e) {
    log(`${e.type.padEnd(5)} ${this.symbol} ${e.message}`);
    if (e.type === "EXIT")
      store.appendLine(this.tradeLog, {
        symbol: this.symbol,
        strategy: this.strategy.name,
        ...e.trade,
      });
    if (["ENTRY", "EXIT", "GUARD"].includes(e.type))
      notify(`${this.symbol} [${this.strategy.name}]: ${e.message}`);
  }

  persist() {
    store.save(this.stateFile, {
      lastProcessed: this.lastProcessed,
      resetToken: this.resetToken,
      engine: this.engine.toJSON(),
    });
  }

  async init(loadFilters = true) {
    const saved = store.load(this.stateFile);
    if (
      saved?.engine?.position &&
      this.direction !== "BOTH" &&
      saved.engine.position.side !== this.direction
    )
      throw new Error("Saved position direction differs from this bot profile");
    if (saved) {
      this.engine.restore(saved.engine);
      this.lastProcessed = saved.lastProcessed ?? null;
      this.resetToken = saved.resetToken ?? null;
      log(
        `${this.symbol}: rest…3878 tokens truncated…<= criteria.maximumDrawdownPct;
  }
  const profile = chosen
    ? {
        symbol,
        direction,
        interval,
        strategy: chosen.strategy,
        startingBalance: 1000,
        leverage: 1,
        riskPercent: 0.0025,
        maxMarginPercent: 0.1,
      }
    : null;
  return {
    mode: "PRESET_SELECTION",
    aiIncluded: false,
    liveOrdersEnabled: false,
    symbol,
    direction,
    interval,
    candlesUsed: candles.length,
    criteria,
    periods: {
      start: candles[0].openTime,
      trainingEnd: candles[Math.floor(developmentEnd * 0.75) - 1].closeTime,
      validationEnd: candles[developmentEnd - 1].closeTime,
      finalStart: candles[developmentEnd].openTime,
      end: candles.at(-1).closeTime,
    },
    candidates,
    selected: profile,
    finalTest,
    passed,
    message: !chosen
      ? "No preset passed training and validation. Keep this setup stopped."
      : !passed
        ? "The selected preset failed the final holdout. Do not activate it based on this test."
        : "Passed these historical screens only. Validate on new forward paper data before relying on it.",
    env: passed
      ? `BOT_SYMBOL=${symbol}\nDIRECTION=${direction}\nSTRATEGY=${chosen.strategy}\nINTERVAL=${interval}\nSTART_BALANCE=1000\nLEVERAGE=1\nRISK_PERCENT=0.0025\nMAX_MARGIN_PERCENT=0.10`
      : null,
    assumptions: {
      feeRate: common.feeRate,
      slippage: common.slippage,
      fundingRatePer8h: common.fundingRatePer8h,
      split:
        "60% training / 20% validation / 20% final holdout (indicator warmup reduces usable training)",
      note: "No Gemini calls. No parameter fitting. Repeatedly selecting after seeing the final period invalidates its holdout status. This single-bot historical screen does not simulate the shared portfolio risk manager.",
    },
  };
}
module.exports = { trainSingleCoin };
