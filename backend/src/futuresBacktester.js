const {
  getFuturesHistoricalCandles,
  getFuturesSymbolFilters,
} = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { DEFAULT_STRATEGY } = require("./strategies");
const { FuturesEngine, FUTURES_DEFAULTS } = require("./futuresEngine");
const { computeMetrics } = require("./metrics");
const { intervalMs } = require("./data");
const { directedStrategy, normalizeDirection } = require("./direction");

const INTERVALS = new Set([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
]);
const SYMBOL_RE = /^[A-Z0-9]{3,30}$/;

function priceReturnPct(candles, start, end) {
  const first = candles[start]?.close;
  const last = candles[end - 1]?.close;
  if (
    !Number.isFinite(first) ||
    !Number.isFinite(last) ||
    first <= 0 ||
    end <= start
  )
    return 0;
  return (last / first - 1) * 100;
}

function runSegment({ candles, strategy, config, filters, start, end }) {
  const riskEvents = [];
  const engine = new FuturesEngine({
    ...config,
    ...strategy.engine,
    trailing: config.trailing ?? strategy.engine?.trailing,
    ...filters,
    allowShort: config.allowShort,
    startingBalance: config.startingBalance,
    leverage: config.leverage,
    feeRate: config.feeRate,
    slippage: config.slippage,
    fundingRatePer8h: config.fundingRatePer8h,
    guard: {
      maxDailyLossPct: config.maxDailyLossPct,
      maxDrawdownPct: config.maxDrawdownPct,
      maxConsecutiveLosses: config.maxConsecutiveLosses,
      cooldownMs: config.cooldownMs ?? 4 * 60 * 60 * 1000,
      maxTradesPerDay: config.maxTradesPerDay,
      haltCooldownMs: config.haltResumeDays * 86400e3,
    },
    onEvent: (event) => {
      if (event.type === "GUARD" || event.type === "SKIP") {
        riskEvents.push({
          type: event.type,
          message: event.message,
          time: event.time ?? null,
        });
      }
    },
  });
  const slice = candles.slice(0, end);
  const series = buildSeries(slice);
  const context = strategy.prepare(slice, series);
  for (let i = Math.max(WARMUP, start); i < end; i++) {
    const analysis = strategy.analyze(context, slice, series, i);
    engine.onCandle(slice[i], analysis);
  }
  const last = slice[end - 1];
  if (engine.position && last)
    engine.closeAll(last.close, last.closeTime, "BACKTEST END");
  const finalEquity = engine.cash;
  if (engine.equityCurve.length)
    engine.equityCurve[engine.equityCurve.length - 1].equity = finalEquity;
  const metrics = computeMetrics({
    trades: engine.trades,
    equityCurve: engine.equityCurve,
    startingBalance: config.startingBalance,
    periodsPerYear: config.periodsPerYear,
  });
  metrics.finalEquity = finalEquity;
  metrics.returnPct = (finalEquity / config.startingBalance - 1) * 100;
  metrics.maxDrawdownPct = Math.max(
    metrics.maxDrawdownPct,
    engine.maxDrawdown * 100,
  );
  metrics.funding = engine.trades.reduce(
    (sum, trade) => sum + (trade.funding || 0),
    0,
  );
  const cooldownMs = config.cooldownMs ?? 4 * 60 * 60 * 1000;

  const cooldownEvents = riskEvents.filter(
    (e) =>
      e.type === "GUARD" &&
      e.message?.includes("Consecutive loss cooldown activated"),
  );

  const cooldownSkips = riskEvents.filter(
    (e) =>
      e.type === "SKIP" &&
      e.message?.includes("cooldown after consecutive losses"),
  );

  const cooldownIntervals = cooldownEvents
    .filter((e) => Number.isFinite(e.time))
    .map((e) => [e.time, e.time + cooldownMs])
    .sort((a, b) => a[0] - b[0]);

  let cooldownTotalMs = 0;
  let intervalStart = null;
  let intervalEnd = null;

  for (const [start, end] of cooldownIntervals) {
    if (intervalStart === null) {
      intervalStart = start;
      intervalEnd = end;
    } else if (start <= intervalEnd) {
      intervalEnd = Math.max(intervalEnd, end);
    } else {
      cooldownTotalMs += intervalEnd - intervalStart;
      intervalStart = start;
      intervalEnd = end;
    }
  }

  if (intervalStart !== null) {
    cooldownTotalMs += intervalEnd - intervalStart;
  }

  const riskSummary = {
    consecutiveLossCooldowns: cooldownEvents.length,
    cooldownHours: Number((cooldownTotalMs / 3600000).toFixed(2)),
    blockedEntries: cooldownSkips.length,
    cooldownSignalRejections: cooldownSkips.filter((e) =>
      e.message?.includes("signal ignored"),
    ).length,
    cooldownFillBlocks: cooldownSkips.filter((e) =>
      e.message?.includes("entry blocked at fill"),
    ).length,
    dailyLossWarnings: riskEvents.filter((e) =>
      e.message?.includes("Daily loss limit"),
    ).length,
    drawdownWarnings: riskEvents.filter((e) =>
      e.message?.includes("KILL SWITCH"),
    ).length,
  };

  return {
    engine,
    metrics,
    riskSummary,
    buyHold: priceReturnPct(candles, start, end),
  };
}

async function runFuturesBacktest(options = {}) {
  const config = {
    symbol: String(options.symbol || "BTCUSDT")
      .trim()
      .toUpperCase(),
    interval: String(options.interval || "4h"),
    candles: Math.max(
      500,
      Math.min(20000, Math.floor(Number(options.candles ?? 5000))),
    ),
    strategyName: String(options.strategy || DEFAULT_STRATEGY),
    startingBalance: Number(options.startingBalance ?? 1000),
    leverage: Number(options.leverage ?? 5),
    feeRate: Number(options.feeRate ?? FUTURES_DEFAULTS.feeRate),
    slippage: Number(options.slippage ?? FUTURES_DEFAULTS.slippage),
    fundingRatePer8h: Number(
      options.fundingRatePer8h ?? FUTURES_DEFAULTS.fundingRatePer8h,
    ),
    riskPercent: Number(options.riskPercent ?? FUTURES_DEFAULTS.riskPercent),
    maxPositionPercent: Number(
      options.maxPositionPercent ?? FUTURES_DEFAULTS.maxPositionPercent,
    ),
    maintenanceMarginRate: Number(
      options.maintenanceMarginRate ?? FUTURES_DEFAULTS.maintenanceMarginRate,
    ),
    maxDailyLossPct: Number(options.maxDailyLossPct ?? 0.03),
    maxDrawdownPct: Number(options.maxDrawdownPct ?? 0.1),
    maxConsecutiveLosses: Number(options.maxConsecutiveLosses ?? 3),
    cooldownMs: Number(options.cooldownMs ?? 14400000),
    maxTradesPerDay: Number(options.maxTradesPerDay ?? 6),
    haltResumeDays: Number(options.haltResumeDays ?? 7),
    direction: normalizeDirection(
      options.direction ?? (options.allowShort === true ? "BOTH" : "LONG"),
    ),
    allowShort: options.direction
      ? normalizeDirection(options.direction) !== "LONG"
      : options.allowShort === true,
    trailing: options.trailing,
    split: Math.max(0.5, Math.min(0.9, Number(options.split ?? 0.7))),
  };
  if (!SYMBOL_RE.test(config.symbol)) throw new Error("Invalid symbol");
  if (!INTERVALS.has(config.interval))
    throw new Error("Unsupported candle interval");
  config.periodsPerYear =
    config.interval === "1M"
      ? 12
      : Math.round((365 * 86400e3) / intervalMs(config.interval));
  if (!Number.isFinite(config.startingBalance) || config.startingBalance <= 0)
    throw new Error("startingBalance must be greater than 0");
  if (
    !Number.isFinite(config.leverage) ||
    config.leverage < 1 ||
    config.leverage > 125
  )
    throw new Error("leverage must be between 1 and 125");
  for (const key of [
    "feeRate",
    "slippage",
    "fundingRatePer8h",
    "riskPercent",
    "maxPositionPercent",
    "maintenanceMarginRate",
  ]) {
    if (!Number.isFinite(config[key]) || config[key] < 0)
      throw new Error(`${key} must be a non-negative number`);
  }

  const strategy = directedStrategy(config.strategyName, config.direction);
  if (strategy.requiredInterval && config.interval !== strategy.requiredInterval) throw new Error(`${strategy.name} requires interval=${strategy.requiredInterval}`);
  const candles = Array.isArray(options.candlesData)
    ? options.candlesData
    : await getFuturesHistoricalCandles(
        config.symbol,
        config.interval,
        config.candles,
        options.endTime ?? Date.now(),
      );
  if (candles.length < WARMUP + 100)
    throw new Error(
      `Not enough USDⓈ-M Futures candles (${candles.length}); need at least ${WARMUP + 100}`,
    );
  const filters =
    options.filters && typeof options.filters === "object"
      ? options.filters
      : await getFuturesSymbolFilters(config.symbol).catch(() => ({}));
  const indexAt = (time, label) => {
    if (!Number.isFinite(time)) throw new Error(`${label} must be a timestamp`);
    const i = candles.findIndex(c => c.openTime >= time);
    if (i < 0) throw new Error(`${label} is outside the dataset`);
    return i;
  };
  const warmup = Math.max(WARMUP, strategy.warmupBars || 0);
  const evaluationStart = options.evaluationStartTime === undefined ? warmup : indexAt(options.evaluationStartTime, 'evaluationStartTime');
  if (evaluationStart < warmup || evaluationStart >= candles.length - 2) throw new Error(`Need at least ${warmup} warmup bars and a subsequent evaluation period`);
  const splitIndex = options.splitTime === undefined ? Math.max(evaluationStart + 1, Math.floor(candles.length * config.split)) : indexAt(options.splitTime, 'splitTime');
  if (splitIndex <= evaluationStart || splitIndex >= candles.length - 1) throw new Error('Split must be inside the evaluation period; request more candles');
  const full = runSegment({
    candles,
    strategy,
    config,
    filters,
    start: evaluationStart,
    end: candles.length,
  });
  const inSample = runSegment({
    candles,
    strategy,
    config,
    filters,
    start: evaluationStart,
    end: splitIndex,
  });
  const outSample = runSegment({
    candles,
    strategy,
    config,
    filters,
    start: splitIndex,
    end: candles.length,
  });
  const days =
    (candles[candles.length - 1].closeTime - candles[0].openTime) / 86400e3;

  return {
    marketType: "BINANCE_USDM_FUTURES",
    mode: "FUTURES_BACKTEST",
    liveOrdersEnabled: false,
    config: {
      ...config,
      strategy: strategy.name,
      candlesRequested: config.candles,
      candlesUsed: candles.length,
      marginMode: "ISOLATED",
      filters,
    },
    period: {
      evaluationStartTime: candles[evaluationStart].openTime,
      splitTime: candles[splitIndex].openTime,
      startTime: candles[0].openTime,
      endTime: candles[candles.length - 1].closeTime,
      days: Number(days.toFixed(2)),
    },
    assumptions: {
      marginMode: "ISOLATED",
      feeRate: config.feeRate,
      slippage: config.slippage,
      fundingRatePer8h: config.fundingRatePer8h,
      fundingModel:
        "estimated fixed rate charged at crossed 8-hour boundaries; longs pay positive funding and shorts receive it",
      liquidationModel:
        "approximation; not an exact Binance liquidation or insurance-clearance simulation",
      entryModel:
        "signals are evaluated at candle close and queued entries execute at the next candle open",
    },
    full: {
      buyHold: full.buyHold,
      metrics: full.metrics,
      trades: full.engine.trades,
      equityCurve: full.engine.equityCurve,
      riskSummary: full.riskSummary,
    },
    inSample: {
      buyHold: inSample.buyHold,
      metrics: inSample.metrics,
      trades: inSample.engine.trades,
      equityCurve: inSample.engine.equityCurve,
      riskSummary: inSample.riskSummary,
    },
    outSample: {
      buyHold: outSample.buyHold,
      metrics: outSample.metrics,
      trades: outSample.engine.trades,
      equityCurve: outSample.engine.equityCurve,
      riskSummary: outSample.riskSummary,
    },
    risk: {
      fullMaxDrawdownPct: full.engine.maxDrawdown * 100,
      liquidationCount: full.engine.trades.filter(
        (t) => t.reason === "LIQUIDATION",
      ).length,
      full: full.riskSummary,
      inSample: inSample.riskSummary,
      outSample: outSample.riskSummary,
    },
  };
}

module.exports = { runFuturesBacktest, priceReturnPct };

