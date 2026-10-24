const { getFuturesHistoricalCandles, getFuturesSymbolFilters } = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { findStrategy, DEFAULT_STRATEGY } = require("./strategies");
const { FuturesEngine, FUTURES_DEFAULTS } = require("./futuresEngine");
const { computeMetrics } = require("./metrics");
const { intervalMs } = require("./data");

const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]);
const SYMBOL_RE = /^[A-Z0-9]{3,30}$/;

function runSegment({ candles, strategy, config, filters, start, end }) {
    const engine = new FuturesEngine({
        ...config,
        ...strategy.engine,
        ...filters,
        startingBalance: config.startingBalance,
        leverage: config.leverage,
        feeRate: config.feeRate,
        slippage: config.slippage,
        fundingRatePer8h: config.fundingRatePer8h,
        guard: {
            maxDailyLossPct: config.maxDailyLossPct,
            maxDrawdownPct: config.maxDrawdownPct,
            maxConsecutiveLosses: config.maxConsecutiveLosses,
            maxTradesPerDay: config.maxTradesPerDay,
            haltCooldownMs: config.haltResumeDays * 86400e3,
        },
        onEvent: () => {},
    });
    const slice = candles.slice(0, end);
    const series = buildSeries(slice);
    const context = strategy.prepare(slice, series);
    for (let i = Math.max(WARMUP, start); i < end; i++) {
        const analysis = strategy.analyze(context, slice, series, i);
        engine.onCandle(slice[i], analysis);
    }
    const last = slice[end - 1];
    if (engine.position && last) engine.closeAll(last.close, last.closeTime, "BACKTEST END");
    const finalEquity = engine.cash;
    if (engine.equityCurve.length) engine.equityCurve[engine.equityCurve.length - 1].equity = finalEquity;
    const metrics = computeMetrics({
        trades: engine.trades,
        equityCurve: engine.equityCurve,
        startingBalance: config.startingBalance,
        periodsPerYear: config.periodsPerYear,
    });
    metrics.finalEquity = finalEquity;
    metrics.returnPct = ((finalEquity / config.startingBalance) - 1) * 100;
    metrics.maxDrawdownPct = Math.max(metrics.maxDrawdownPct, engine.maxDrawdown * 100);
    metrics.funding = engine.trades.reduce((sum, trade) => sum + (trade.funding || 0), 0);
    return { engine, metrics };
}

async function runFuturesBacktest(options = {}) {
    const config = {
        symbol: String(options.symbol || "BTCUSDT").trim().toUpperCase(),
        interval: String(options.interval || "4h"),
        candles: Math.max(500, Math.min(20000, Math.floor(Number(options.candles ?? 5000)))),
        strategyName: String(options.strategy || DEFAULT_STRATEGY),
        startingBalance: Number(options.startingBalance ?? 1000),
        leverage: Number(options.leverage ?? 5),
        feeRate: Number(options.feeRate ?? FUTURES_DEFAULTS.feeRate),
        slippage: Number(options.slippage ?? FUTURES_DEFAULTS.slippage),
        fundingRatePer8h: Number(options.fundingRatePer8h ?? FUTURES_DEFAULTS.fundingRatePer8h),
        riskPercent: Number(options.riskPercent ?? FUTURES_DEFAULTS.riskPercent),
        maxPositionPercent: Number(options.maxPositionPercent ?? FUTURES_DEFAULTS.maxPositionPercent),
        maintenanceMarginRate: Number(options.maintenanceMarginRate ?? FUTURES_DEFAULTS.maintenanceMarginRate),
        maxDailyLossPct: Number(options.maxDailyLossPct ?? 0.03),
        maxDrawdownPct: Number(options.maxDrawdownPct ?? 0.10),
        maxConsecutiveLosses: Number(options.maxConsecutiveLosses ?? 3),
        maxTradesPerDay: Number(options.maxTradesPerDay ?? 6),
        haltResumeDays: Number(options.haltResumeDays ?? 7),
        allowShort: options.allowShort ?? process.env.SHORTS === "1",
        split: Math.max(0.5, Math.min(0.9, Number(options.split ?? 0.7))),
    };
    if (!SYMBOL_RE.test(config.symbol)) throw new Error("Invalid symbol");
    if (!INTERVALS.has(config.interval)) throw new Error("Unsupported candle interval");
    config.periodsPerYear = config.interval === "1M" ? 12 : Math.round(365 * 86400e3 / intervalMs(config.interval));
    if (!Number.isFinite(config.startingBalance) || config.startingBalance <= 0) throw new Error("startingBalance must be greater than 0");
    if (!Number.isFinite(config.leverage) || config.leverage < 1 || config.leverage > 125) throw new Error("leverage must be between 1 and 125");
    for (const key of ["feeRate", "slippage", "fundingRatePer8h", "riskPercent", "maxPositionPercent", "maintenanceMarginRate"]) {
        if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`${key} must be a non-negative number`);
    }

    const strategy = findStrategy(config.strategyName);
    const candles = await getFuturesHistoricalCandles(config.symbol, config.interval, config.candles);
    if (candles.length < WARMUP + 100) throw new Error(`Not enough USDⓈ-M Futures candles (${candles.length}); need at least ${WARMUP + 100}`);
    const filters = await getFuturesSymbolFilters(config.symbol).catch(() => ({}));
    const splitIndex = Math.max(WARMUP + 1, Math.floor(candles.length * config.split));
    const full = runSegment({ candles, strategy, config, filters, start: WARMUP, end: candles.length });
    const inSample = runSegment({ candles, strategy, config, filters, start: WARMUP, end: splitIndex });
    const outSample = runSegment({ candles, strategy, config, filters, start: splitIndex, end: candles.length });
    const days = (candles[candles.length - 1].closeTime - candles[0].openTime) / 86400e3;

    return {
        marketType: "BINANCE_USDM_FUTURES",
        mode: "FUTURES_BACKTEST",
        liveOrdersEnabled: false,
        config: { ...config, strategy: strategy.name, candlesRequested: config.candles, candlesUsed: candles.length, marginMode: "ISOLATED", filters },
        period: { startTime: candles[0].openTime, endTime: candles[candles.length - 1].closeTime, days: Number(days.toFixed(2)) },
        assumptions: {
            marginMode: "ISOLATED",
            feeRate: config.feeRate,
            slippage: config.slippage,
            fundingRatePer8h: config.fundingRatePer8h,
            fundingModel: "estimated fixed rate charged at crossed 8-hour boundaries; longs pay positive funding and shorts receive it",
            liquidationModel: "approximation; not an exact Binance liquidation or insurance-clearance simulation",
            entryModel: "signals are evaluated at candle close and queued entries execute at the next candle open",
        },
        full: { metrics: full.metrics, trades: full.engine.trades, equityCurve: full.engine.equityCurve },
        inSample: { metrics: inSample.metrics, trades: inSample.engine.trades, equityCurve: inSample.engine.equityCurve },
        outSample: { metrics: outSample.metrics, trades: outSample.engine.trades, equityCurve: outSample.engine.equityCurve },
        risk: { fullMaxDrawdownPct: full.engine.maxDrawdown * 100, liquidationCount: full.engine.trades.filter(t => t.reason === "LIQUIDATION").length },
    };
}

module.exports = { runFuturesBacktest };
