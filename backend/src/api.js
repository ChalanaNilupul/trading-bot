const http = require("http");
const crypto = require("crypto");
const {
  getFuturesTickers24h,
  getFuturesCandles,
  getFuturesSymbolFilters,
} = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const store = require("./store");
const { computeMetrics } = require("./metrics");
const {
  Runner,
  SYMBOLS,
  INTERVAL,
  POLL_SECONDS,
  START_BALANCE,
  RUNNER_BALANCE,
  LEVERAGE,
  strategy,
  DIRECTION,
  portfolioRisk,
  buildPortfolioSnapshot,
  persistPortfolioRisk,
  restorePortfolioRisk,
} = require("./index");
const { runFuturesBacktest } = require("./futuresBacktester");
const { trainSingleCoin } = require("./singleCoinLab");

const { AIEntryFilter } = require("./aiFilter");
const { AIMonitor } = require("./aiMonitor");
const aiMonitor = new AIMonitor(new AIEntryFilter());

const PORT = Number(process.env.API_PORT || 4000);
const HOST = process.env.API_HOST || "127.0.0.1";
const API_KEY = process.env.API_KEY || "";
const { createSingleFlight } = require("./singleFlight");

if (API_KEY.length < 16) {
  console.error(
    "API_KEY env var is required (min 16 chars). Generate one with:\n  node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\"",
  );
  process.exit(1);
}
let backtestBusy = false;

function authorized(req) {
  const given = Buffer.from(String(req.headers["x-api-key"] || ""));
  const want = Buffer.from(API_KEY);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

let running = false;
let loopPromise = null;
let runners = [];
let lastPrices = new Map();
let tickerCache = { at: 0, data: new Map() };
let marketCache = { at: 0, data: [] };
let filtersLoaded = false;
const MAX_EVENTS = 500;
let eventSequence = 0;
const events = [];
let lastSuccessfulBinanceAt = null;
let lastCandleAt = null;
let lastBinanceError = null;

function recordEvent(level, category, message, details = {}) {
  const event = {
    id: ++eventSequence,
    timestamp: Date.now(),
    level,
    category,
    message: String(message).slice(0, 500),
    ...details,
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  return event;
}

function createRunners() {
  const group = SYMBOLS.map((symbol) => new Runner(symbol));
  for (const runner of group) runner.allRunners = group;
  return group;
}

async function initRunners(loadFilters = false) {
  if (runners.length) return;
  restorePortfolioRisk();
  runners = createRunners();
  for (const runner of runners) {
    const originalOnEvent = runner.onEvent.bind(runner);
    runner.onEvent = (event) => {
      originalOnEvent(event);
      const level =
        event.type === "SKIP" || event.type === "GUARD"
          ? "warn"
          : event.type === "EXIT" || event.type === "ENTRY"
            ? "trade"
            : "info";
      recordEvent(level, event.type, `${runner.symbol}: ${event.message}`, {
        symbol: runner.symbol,
        source: "paper-engine",
      });
    };
    await runner.init(loadFilters);
  }
  recordEvent(
    "info",
    "SYSTEM",
    `Initialized ${runners.length} paper runner(s)`,
    { source: "system" },
  );
}

async function refreshTickers() {
  const now = Date.now();
  if (now - tickerCache.at < 15000) return tickerCache.data;
  const rows = await getFuturesTickers24h();
  lastSuccessfulBinanceAt = Date.now();
  lastBinanceError = null;
  recordEvent(
    "info",
    "BINANCE",
    `Fetched 24h ticker data (${rows.length} symbols)`,
    { source: "binance" },
  );
  const map = new Map();
  for (const row of rows) {
    const symbol = String(row.symbol || "");
    if (symbol.endsWith("USDT"))
      map.set(symbol, {
        price: Number(row.lastPrice),
        change: Number(row.priceChangePercent),
        volume: Number(row.quoteVolume),
      });
  }
  tickerCache = { at: now, data: map };
  for (const [symbol, quote] of map) lastPrices.set(symbol, quote.price);
  return map;
}

function currentPrice(runner) {
  return lastPrices.get(runner.symbol) ?? runner.lastPrice ?? 0;
}

function runnerSnapshot(runner) {
  const e = runner.engine;
  const price = currentPrice(runner);
  const equity = e.equity(price || runner.lastPrice || 0);
  const m = computeMetrics({
    trades: e.trades,
    startingBalance: e.cfg.startingBalance,
  });
  const g = e.guard.state;
  const dailyStart = g.dayStartEquity || equity;
  const dailyPnlPct = dailyStart ? (equity / dailyStart - 1) * 100 : 0;
  const position = e.position
    ? {
        side: e.position.side,
        entryTime: e.position.entryTime,
        entryPrice: e.position.entryPrice,
        quantity: e.position.quantity,
        currentPrice: price,
        stopPrice: e.position.stopPrice,
        initialStop: e.position.initialStop,
        unrealizedPnl: e.unrealized(price),
        margin: e.position.margin,
        leverage: e.position.leverage,
        liquidationPrice: e.position.liquidationPrice,
        targetPrice: e.position.targetPrice,
        fundingPaid: e.position.fundingPaid,
      }
    : null;
  return {
    symbol: runner.symbol,
    direction: runner.direction,
    price,
    equity,
    cash: e.cash,
    startingBalance: e.cfg.startingBalance,
    usedMargin: e.usedMargin(),
    freeCollateral: e.freeCollateral(price),
    returnPct: (equity / e.cfg.startingBalance - 1) * 100,
    lastProcessed: runner.lastProcessed,
    lastNote: runner.lastNote,
    errors: runner.errors,
    position,
    pending: e.pending,
    metrics: m,
    risk: {
      ...g,
      dailyPnlPct,
      drawdownPct: e.peak ? ((e.peak - equity) / e.peak) * 100 : 0,
      limits: {
        maxDailyLossPct: e.guard.cfg.maxDailyLossPct * 100,
        maxDrawdownPct: e.guard.cfg.maxDrawdownPct * 100,
        maxConsecutiveLosses: e.guard.cfg.maxConsecutiveLosses,
        maxTradesPerDay: e.guard.cfg.maxTradesPerDay,
      },
    },
  };
}

async function scanMarkets() {
  const now = Date.now();
  if (now - marketCache.at < 30000) return marketCache.data;
  const tickers = await refreshTickers();
  const output = [];
  for (const symbol of SYMBOLS) {
    try {
      const candles = await getFuturesCandles(symbol, INTERVAL, 300);
      lastSuccessfulBinanceAt = Date.now();
      lastBinanceError = null;
      if (candles.length < WARMUP + 1) continue;
      const series = buildSeries(candles);
      const trendCandles = strategy.trendInterval ? await getFuturesCandles(symbol, strategy.trendInterval, strategy.trendLimit) : undefined;
      const ctx = strategy.prepare(candles, series, { trendCandles });
      const i = candles.length - 1;
      const analysis = strategy.analyze(ctx, candles, series, i);
      const ticker = tickers.get(symbol) || {};
      lastCandleAt = candles[i].closeTime;
      recordEvent(
        "info",
        "SCAN",
        `${symbol} ${analysis.signal} signal (${analysis.score}/${analysis.maxScore}) on ${INTERVAL} candle${strategy.trendInterval ? ` | ${analysis.reasons?.[0] || ""}` : ""}`,
        { symbol, source: "market-scanner", candleTime: candles[i].closeTime },
      );
      output.push({
        symbol,
        price: Number(ticker.price ?? analysis.price ?? candles[i].close),
        change: Number(ticker.change ?? 0),
        signal: analysis.signal,
        score: analysis.score,
        maxScore: analysis.maxScore,
        rsi: analysis.indicators?.rsi14 ?? null,
        adx: analysis.indicators?.adx14 ?? null,
        atr: analysis.indicators?.atr14 ?? null,
        reasons: analysis.reasons || [],
        blockers: analysis.blockers || [],
      });
    } catch (error) {
      lastBinanceError = { at: Date.now(), message: error.message };
      recordEvent(
        "error",
        "BINANCE_ERROR",
        `${symbol} market scan failed: ${error.message}`,
        { symbol, source: "market-scanner" },
      );
      output.push({ symbol, error: error.message });
    }
  }
  marketCache = { at: now, data: output };
  return output;
}

function allTrades() {
  return runners
    .flatMap((r) => r.engine.trades.map((t) => ({ ...t, symbol: r.symbol })))
    .sort((a, b) => (b.exitTime || 0) - (a.exitTime || 0));
}

function aggregate() {
  const snapshots = runners.map(runnerSnapshot);
  const starting = snapshots.reduce((s, x) => s + x.startingBalance, 0);
  const equity = snapshots.reduce((s, x) => s + x.equity, 0);
  const trades = allTrades();
  const metrics = computeMetrics({ trades, startingBalance: starting });
  return {
    mode: "FUTURES_PAPER",
    marketType: "USDⓈ-M FUTURES",
    marginMode: "ISOLATED",
    leverage: LEVERAGE,
    liveOrdersEnabled: false,
    accountingModel: "ISOLATED_MARGIN_PER_SYMBOL_ACCOUNT",
    running,
    strategy: strategy.name,
    direction: DIRECTION,
    singleCoin: SYMBOLS.length === 1,
    interval: INTERVAL,
    symbols: SYMBOLS,
    pollSeconds: POLL_SECONDS,
    updatedAt: Date.now(),
    portfolio: {
      startingBalance: starting,
      equity,
      returnPct: (equity / starting - 1) * 100,
    },
    metrics,
    runners: snapshots,
  };
}

const tickOnce = createSingleFlight(async () => {
  await refreshTickers();

  for (const runner of runners) {
    runner.lastPrice = lastPrices.get(runner.symbol) ?? runner.lastPrice;
  }

  let changed = false;

  for (const runner of runners) {
    try {
      const hadNewCandle = await runner.tick();

      if (hadNewCandle) changed = true;

      runner.errors = 0;
      lastSuccessfulBinanceAt = Date.now();
      lastBinanceError = null;

      recordEvent(
        "info",
        "BINANCE",
        `${runner.symbol}: candle data fetched; ${hadNewCandle ? "new closed candle processed" : "no new closed candle"}`,
        {
          symbol: runner.symbol,
          source: "paper-engine",
          candleTime: runner.lastProcessed,
        },
      );

      if (hadNewCandle) {
        recordEvent(
          "info",
          "STRATEGY",
          `${runner.symbol}: ${runner.lastNote}`,
          {
            symbol: runner.symbol,
            source: "paper-engine",
            candleTime: runner.lastProcessed,
          },
        );
      }
    } catch (error) {
      runner.errors += 1;
      lastBinanceError = {
        at: Date.now(),
        message: error.message,
      };

      recordEvent(
        "error",
        "FETCH_ERROR",
        `${runner.symbol}: ${error.message} (consecutive errors: ${runner.errors})`,
        { symbol: runner.symbol, source: "paper-engine" },
      );

      console.error(`${runner.symbol}: ${error.message}`);
    }
  }

  const snapshot = buildPortfolioSnapshot(runners);

  if (snapshot.valid) {
    portfolioRisk.update({
      equity: snapshot.equity,
      timestamp: Date.now(),
    });
    persistPortfolioRisk();
  }

  return changed;
});

async function botLoop() {
  if (loopPromise) return loopPromise;
  loopPromise = (async () => {
    while (running) {
      await tickOnce();
      if (!running) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    }
  })().finally(() => {
    loopPromise = null;
  });
  return loopPromise;
}

async function startBot() {
  await initRunners(false);
  if (!filtersLoaded) {
    for (const r of runners) {
      try {
        Object.assign(r.engine.cfg, await getFuturesSymbolFilters(r.symbol));
      } catch (e) {
        console.error(`${r.symbol}: filters failed: ${e.message}`);
      }
    }
    filtersLoaded = true;
  }
  if (!running) {
    running = true;
    recordEvent(
      "info",
      "BOT_START",
      `Futures paper engine started: ${strategy.name}, ${INTERVAL}, ${LEVERAGE}x isolated, ${SYMBOLS.length} symbols; live orders disabled`,
      { source: "system" },
    );
    botLoop();
  }
}

function stopBot() {
  running = false;
  recordEvent(
    "warn",
    "BOT_STOP",
    "Paper engine stop requested; saving runner state",
    { source: "system" },
  );
  runners.forEach((r) => r.persist());
  persistPortfolioRisk();
}

async function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204); // no CORS: browsers must go through the dashboard's server-side proxy
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/api/health" && !authorized(req))
    return json(res, 401, { error: "unauthorized" });
  try {
    if (req.method === "GET" && url.pathname === "/api/ai") {
      return json(res, 200, {
        ...aiMonitor.snapshot(SYMBOLS),
        running,
        interval: INTERVAL,
        strategy: strategy.name,
      });
    }
    if (req.method === "POST" && url.pathname === "/api/ai/test") {
      const result = await aiMonitor.testConnection();
      const { status, ...body } = result;
      return json(res, status, body);
    }
    await initRunners();
    if (req.method === "GET" && url.pathname === "/api/health")
      return json(res, 200, {
        ok: true,
        mode: "FUTURES_PAPER",
        marketType: "USDⓈ-M FUTURES",
        liveOrdersEnabled: false,
        running,
        time: Date.now(),
      });
    if (req.method === "GET" && url.pathname === "/api/events") {
      const limit = Math.max(
        1,
        Math.min(200, Number(url.searchParams.get("limit") || 80)),
      );
      const after = Number(url.searchParams.get("after") || 0);
      return json(res, 200, {
        events: events
          .filter((event) => event.id > after)
          .slice(-limit)
          .reverse(),
        latestId: eventSequence,
        telemetry: {
          lastSuccessfulBinanceAt,
          lastCandleAt,
          lastBinanceError,
          running,
          mode: "FUTURES_PAPER",
        },
      });
    }
    if (req.method === "GET" && url.pathname === "/api/status")
      return json(res, 200, {
        ...aggregate(),
        telemetry: {
          lastSuccessfulBinanceAt,
          lastCandleAt,
          lastBinanceError,
          mode: "FUTURES_PAPER",
        },
      });
    if (req.method === "GET" && url.pathname === "/api/positions")
      return json(
        res,
        200,
        runners.map(runnerSnapshot).filter((x) => x.position),
      );
    if (req.method === "GET" && url.pathname === "/api/trades")
      return json(res, 200, allTrades().slice(0, 100));
    if (req.method === "GET" && url.pathname === "/api/markets")
      return json(res, 200, {
        strategy: strategy.name,
        interval: INTERVAL,
        markets: await scanMarkets(),
      });
    if (req.method === "POST" && url.pathname === "/api/bot/start") {
      await startBot();
      return json(res, 200, { ok: true, running });
    }
    if (req.method === "POST" && url.pathname === "/api/bot/stop") {
      stopBot();
      return json(res, 200, { ok: true, running });
    }
    if (req.method === "POST" && url.pathname === "/api/bot/tick") {
      await tickOnce();
      return json(res, 200, aggregate());
    }
    if (req.method === "POST" && url.pathname === "/api/risk/reset-halt") {
      const snapshot = buildPortfolioSnapshot(runners);
      if (!snapshot.valid)
        return json(res, 409, {
          error: "Wait for valid market prices before resetting portfolio risk",
        });
      portfolioRisk.reset({ equity: snapshot.equity, timestamp: Date.now() });
      persistPortfolioRisk();
      for (const r of runners) {
        const price = currentPrice(r);
        r.engine.guard.resetHalt(r.engine.equity(price));
        r.persist();
      }
      return json(res, 200, { ok: true });
    }
    if (
      req.method === "POST" &&
      ["/api/backtest", "/api/train"].includes(url.pathname)
    ) {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64 * 1024)
          return json(res, 413, { error: "Request body too large" });
      }
      let input = {};
      if (body) {
        try {
          input = JSON.parse(body);
        } catch {
          return json(res, 400, { error: "Invalid JSON body" });
        }
      }
      if (backtestBusy)
        return json(res, 429, { error: "A backtest is already running" });
      if (url.pathname === "/api/train") {
        backtestBusy = true;
        const result = await trainSingleCoin({
          symbol: input.symbol,
          direction: input.direction,
          interval: input.interval,
          candles: input.candles,
          feeRate: process.env.FEE_RATE,
          slippage: process.env.SLIPPAGE,
          fundingRatePer8h: process.env.FUNDING_RATE_8H,
        }).finally(() => {
          backtestBusy = false;
        });
        return json(res, 200, result);
      }
      backtestBusy = true;
      const result = await runFuturesBacktest({
        symbol: input.symbol || "BTCUSDT",
        interval: input.interval || "4h",
        candles: Number(input.candles ?? 5000),
        endTime: input.endTime == null ? undefined : Number(input.endTime),
        strategy: input.strategy || strategy.name,
        direction: input.direction,
        allowShort: input.allowShort === true,
        startingBalance: Number(input.startingBalance ?? START_BALANCE),
        leverage: Number(input.leverage ?? LEVERAGE),
        feeRate: Number(input.feeRate ?? process.env.FEE_RATE ?? 0.0005),
        slippage: Number(input.slippage ?? process.env.SLIPPAGE ?? 0.0005),
        fundingRatePer8h: Number(
          input.fundingRatePer8h ?? process.env.FUNDING_RATE_8H ?? 0.0001,
        ),
        riskPercent: Number(
          input.riskPercent ?? process.env.RISK_PERCENT ?? 0.01,
        ),
        maxPositionPercent: Number(
          input.maxPositionPercent ?? process.env.MAX_MARGIN_PERCENT ?? 0.25,
        ),
        maxDailyLossPct: Number(input.maxDailyLossPct ?? 0.03),
        maxDrawdownPct: Number(input.maxDrawdownPct ?? 0.1),
        maxConsecutiveLosses: Number(input.maxConsecutiveLosses ?? 3),
        cooldownMs: Number(input.cooldownMs ?? 14400000),
        maxTradesPerDay: Number(input.maxTradesPerDay ?? 6),
        haltResumeDays: Number(input.haltResumeDays ?? 7),
        split: Number(input.split ?? 0.7),
      }).finally(() => {
        backtestBusy = false;
      });
      recordEvent(
        "info",
        "FUTURES_BACKTEST",
        `Completed Futures backtest for ${result.config.symbol} (${result.config.candlesUsed} candles)`,
        { source: "backtest" },
      );
      return json(res, 200, { success: true, result });
    }
    return json(res, 404, { error: "Not found" });
  } catch (error) {
    recordEvent("error", "API_ERROR", error.message, { source: "api" });
    console.error(error);
    return json(res, 500, { error: error.message });
  }
}

const server = http.createServer(handler);
server.listen(PORT, HOST, () => {
  recordEvent(
    "info",
    "API_READY",
    `TradeLab API listening on http://${HOST}:${PORT}; Futures paper mode only; live orders disabled`,
    { source: "system" },
  );
  console.log(`TradeLab API listening on http://${HOST}:${PORT}`);
});
if (process.env.AUTOSTART === "1")
  startBot().catch((error) => {
    recordEvent("error", "START_ERROR", error.message, { source: "system" });
    console.error(error);
  });

