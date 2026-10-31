/**
 * Candidate strategies for comparison. Each one is a different IDEA, not a tweak of the same one.
 * Parameters are classic textbook values chosen BEFORE testing and deliberately NOT tuned,
 * so a good result can't be blamed on fitting the past.
 *
 * Interface:
 *   prepare(candles, series)            -> context (precomputed arrays), computed once
 *   analyze(ctx, candles, series, i)    -> { signal: BUY|SELL|HOLD, indicators: { atr14 } }
 * analyze(i) may only use data up to and including candle i.
 */
const { analysisAt } = require("./strategy");
const { multiTimeframeStrategy } = require("./multiTimeframe");
const { breakoutRetestStrategy } = require("./breakoutRetest");

const result = (signal, atr, price) => ({
  signal,
  score: 0,
  maxScore: 0,
  reasons: [],
  warnings: [],
  blockers: [],
  indicators: { atr14: atr },
  price,
});

function rollingMaxPrior(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - n; j < i; j++) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}

function rollingMinPrior(values, n) {
  const out = new Array(values.length).fill(null);
  for (let i = n; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - n; j < i; j++) if (values[j] < m) m = values[j];
    out[i] = m;
  }
  return out;
}

/**
 * Donchian-style breakout: buy a close above the highest high of the last `entryN` candles
 * while the market is in an uptrend (above SMA200); exit on a close below the lowest low of
 * the last `exitN` candles. No profit target: winners run until the channel breaks.
 */
function makeBreakout(entryN, exitN, options = {}) {
  const useSma200 = options.useSma200 !== false;
  const name = options.name || `Breakout ${entryN}/${exitN}`;
  return {
    name,
    description: `Buy a close above the prior ${entryN}-candle high${useSma200 ? " while above SMA200" : ""}; exit below the prior ${exitN}-candle low. Lets winners run.`,
    engine: { rewardRiskRatio: null, trailing: false },
    prepare: (candles) => ({
      hh: rollingMaxPrior(
        candles.map((c) => c.high),
        entryN,
      ),
      ll: rollingMinPrior(
        candles.map((c) => c.low),
        exitN,
      ),
    }),
    analyze: (ctx, candles, series, i) => {
      const atr = series.atr14[i],
        sma200 = series.sma200[i],
        c = candles[i].close;
      if (
        atr == null ||
        (useSma200 && sma200 == null) ||
        ctx.hh[i] == null ||
        ctx.ll[i] == null
      )
        return result("HOLD", atr, c);
      if (c > ctx.hh[i] && (!useSma200 || c > sma200))
        return result("BUY", atr, c);
      if (c < ctx.ll[i]) return result("SELL", atr, c);
      return result("HOLD", atr, c);
    },
    describe: (ctx, candles, series, i) =>
      `close ${candles[i].close.toFixed(4)} | buy above ${ctx.hh[i]?.toFixed(4)}${useSma200 ? ` and above SMA200 ${series.sma200[i]?.toFixed(4)}` : ""} | exit below ${ctx.ll[i]?.toFixed(4)}`,
  };
}

const STRATEGIES = [
  multiTimeframeStrategy,
  breakoutRetestStrategy,
  {
    name: "Current (score)",
    description:
      "Your existing SMA/MACD/RSI scoring strategy (the baseline to beat)",
    engine: {},
    prepare: () => null,
    analyze: (ctx, candles, series, i) => analysisAt(candles, series, i),
  },
  makeBreakout(50, 20),
  makeBreakout(40, 20, { useSma200: false, name: "Pure Breakout 40/20" }),
  {
    name: "Dip buy (RSI)",
    description:
      "Mean reversion: buy RSI<35 dips while above SMA200; exit when RSI>60 or the uptrend breaks.",
    engine: { rewardRiskRatio: 3, trailing: false },
    prepare: () => null,
    analyze: (ctx, candles, series, i) => {
      const atr = series.atr14[i],
        sma200 = series.sma200[i],
        rsi = series.rsi14[i],
        c = candles[i].close;
      if (atr == null || sma200 == null || rsi == null)
        return result("HOLD", atr, c);
      if (c > sma200 && rsi < 35) return result("BUY", atr, c);
      if (rsi > 60 || c < sma200) return result("SELL", atr, c);
      return result("HOLD", atr, c);
    },
  },
  {
    name: "EMA pullback",
    description:
      "In a strong uptrend (EMA20>EMA50>SMA200), buy when price reclaims EMA20 after dipping below; exit below EMA50.",
    engine: { rewardRiskRatio: 3, trailing: true },
    prepare: () => null,
    analyze: (ctx, candles, series, i) => {
      const atr = series.atr14[i],
        e20 = series.ema20[i],
        e50 = series.ema50[i],
        s200 = series.sma200[i];
      const c = candles[i].close;
      if (
        atr == null ||
        e50 == null ||
        s200 == null ||
        i < 1 ||
        series.ema20[i - 1] == null
      )
        return result("HOLD", atr, c);
      const uptrend = e20 > e50 && e50 > s200;
      const reclaimed = candles[i - 1].close <= series.ema20[i - 1] && c > e20;
      if (uptrend && reclaimed) return result("BUY", atr, c);
      if (c < e50) return result("SELL", atr, c);
      return result("HOLD", atr, c);
    },
  },
  {
    name: "Trend filter only",
    description:
      "Simplest possible: be long while price and SMA50 are above SMA200, otherwise flat. The benchmark that fancier ideas must beat.",
    engine: { rewardRiskRatio: null, trailing: false },
    prepare: () => null,
    analyze: (ctx, candles, series, i) => {
      const atr = series.atr14[i],
        s50 = series.sma50[i],
        s200 = series.sma200[i],
        c = candles[i].close;
      if (atr == null || s200 == null || s50 == null)
        return result("HOLD", atr, c);
      if (c > s200 && s50 > s200) return result("BUY", atr, c);
      return result("SELL", atr, c);
    },
  },
];

// Neighbouring settings, used to check the edge isn't a coincidence of exactly 50/20.
// The existing 40/20 variant keeps the SMA200 filter; "Pure Breakout 40/20" removes it
// so both hypotheses can be compared on the same candles and execution assumptions.
const BREAKOUT_VARIANTS = [
  [30, 15],
  [40, 20],
  [50, 20],
  [50, 30],
  [60, 20],
  [80, 30],
].map(([a, b]) => makeBreakout(a, b));

const DEFAULT_STRATEGY = "Breakout 50/20";

function findStrategy(name) {
  const wanted = String(name).trim().toLowerCase();
  const all = [...STRATEGIES, ...BREAKOUT_VARIANTS];
  const found = all.find((s) => s.name.toLowerCase() === wanted);
  if (!found)
    throw new Error(
      `Unknown strategy "${name}". Options: ${[...new Set(all.map((s) => s.name))].join(", ")}`,
    );
  return found;
}

module.exports = {
  STRATEGIES,
  BREAKOUT_VARIANTS,
  DEFAULT_STRATEGY,
  findStrategy,
};

