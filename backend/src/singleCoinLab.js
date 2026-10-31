const {
  getFuturesHistoricalCandles,
  getFuturesSymbolFilters,
} = require("./binance");
const { runFuturesBacktest } = require("./futuresBacktester");
const { STRATEGIES, BREAKOUT_VARIANTS } = require("./strategies");
const { normalizeDirection } = require("./direction");

/** Preset selection, not ML fitting. Select on development data; inspect final holdout once. */
async function trainSingleCoin(options = {}, dependencies = {}) {
  const backtest = dependencies.backtest || runFuturesBacktest;
  const symbol = String(options.symbol || "BTCUSDT")
    .trim()
    .toUpperCase();
  const direction = normalizeDirection(options.direction || "LONG");
  const interval = String(options.interval || "4h");
  const candlesRequested = Number(options.candles ?? 5000);
  if (!/^[A-Z0-9]{3,30}$/.test(symbol)) throw new Error("Invalid symbol");
  if (!["LONG", "SHORT"].includes(direction))
    throw new Error("Single Coin Lab requires LONG or SHORT");
  if (!["15m", "30m", "1h", "4h", "1d"].includes(interval))
    throw new Error("Unsupported lab interval");
  if (
    !Number.isInteger(candlesRequested) ||
    candlesRequested < 1500 ||
    candlesRequested > 20000
  )
    throw new Error("Use 1500 to 20000 candles");
  const candles =
    options.candlesData ||
    (await getFuturesHistoricalCandles(symbol, interval, candlesRequested));
  if (candles.length < 1500)
    throw new Error("At least 1500 closed candles are required");
  const filters = options.filters || (await getFuturesSymbolFilters(symbol));
  const developmentEnd = Math.floor(candles.length * 0.8);
  const development = candles.slice(0, developmentEnd);
  const common = {
    symbol,
    direction,
    interval,
    candles: candlesRequested,
    filters,
    startingBalance: 1000,
    leverage: 1,
    riskPercent: 0.0025,
    maxPositionPercent: 0.1,
    feeRate: Number(options.feeRate ?? 0.0005),
    slippage: Number(options.slippage ?? 0.0005),
    fundingRatePer8h: Number(options.fundingRatePer8h ?? 0.0001),
    haltResumeDays: 0,
  };
  const names = [
    ...new Set([...STRATEGIES, ...BREAKOUT_VARIANTS].filter(s => (!s.requiredInterval || s.requiredInterval === common.interval) && (!s.supportedDirections || s.supportedDirections.includes(direction)) && (!s.warmupBars || Math.floor(development.length * 0.75) > s.warmupBars + 1)).map((s) => s.name)),
  ].filter((name) => direction === "LONG" || name !== "Current (score)");
  const criteria = {
    minimumValidationTrades: 30,
    minimumValidationPF: 1.2,
    maximumDrawdownPct: 10,
    minimumFinalTrades: 10,
  };
  const candidates = [];
  for (const strategy of names) {
    const result = await backtest({
      ...common,
      strategy,
      candlesData: development,
      split: 0.75,
    });
    const training = result.inSample.metrics,
      validation = result.outSample.metrics;
    const qualifies =
      training.returnPct > 0 &&
      training.profitFactor > 1 &&
      validation.returnPct > 0 &&
      validation.profitFactor >= criteria.minimumValidationPF &&
      validation.trades >= criteria.minimumValidationTrades &&
      validation.maxDrawdownPct <= criteria.maximumDrawdownPct;
    candidates.push({ strategy, training, validation, qualifies });
  }
  candidates.sort(
    (a, b) =>
      Number(b.qualifies) - Number(a.qualifies) ||
      b.validation.returnPct - a.validation.returnPct,
  );
  const chosen = candidates.find((row) => row.qualifies);
  // Never use final-period results to choose a different candidate.
  let finalTest = null,
    passed = false;
  if (chosen) {
    const result = await backtest({
      ...common,
      strategy: chosen.strategy,
      candlesData: candles,
      split: 0.8,
    });
    finalTest = result.outSample.metrics;
    passed =
      finalTest.returnPct > 0 &&
      finalTest.profitFactor > 1 &&
      finalTest.trades >= criteria.minimumFinalTrades &&
      finalTest.maxDrawdownPct <= criteria.maximumDrawdownPct;
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
