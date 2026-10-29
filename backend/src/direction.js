const { findStrategy } = require("./strategies");

function normalizeDirection(value = "LONG") {
  const direction = String(value).trim().toUpperCase();
  if (!["LONG", "SHORT", "BOTH"].includes(direction))
    throw new Error("Direction must be LONG, SHORT or BOTH");
  return direction;
}

// Explicit bearish entries; SELL from a long strategy is never blindly treated as SHORT.
function shortAnalysis(name, ctx, candles, series, i) {
  const c = candles[i].close,
    atr = series.atr14[i],
    sma = series.sma200[i];
  const result = (signal) => ({
    signal,
    score: 0,
    maxScore: 0,
    reasons: [],
    blockers: [],
    warnings: [],
    indicators: { atr14: atr },
    price: c,
  });
  if (atr == null || sma == null) return result("HOLD");
  if (name.startsWith("Breakout ")) {
    const [entryN, exitN] = name.slice(9).split("/").map(Number);
    if (i < Math.max(entryN, exitN)) return result("HOLD");
    const low = Math.min(...candles.slice(i - entryN, i).map((x) => x.low));
    const cover = Math.max(...candles.slice(i - exitN, i).map((x) => x.high));
    if (c < low && c < sma) return result("SHORT");
    if (c > cover) return result("BUY");
  } else if (name === "EMA pullback") {
    const e20 = series.ema20[i],
      e50 = series.ema50[i],
      previous = series.ema20[i - 1];
    if (e20 == null || e50 == null || previous == null || i < 1)
      return result("HOLD");
    if (e20 < e50 && e50 < sma && candles[i - 1].close >= previous && c < e20)
      return result("SHORT");
    if (c > e50) return result("BUY");
  } else if (name === "Dip buy (RSI)") {
    const rsi = series.rsi14[i];
    if (rsi == null) return result("HOLD");
    if (c < sma && rsi > 65) return result("SHORT");
    if (rsi < 40 || c > sma) return result("BUY");
  } else if (name === "Trend filter only") {
    const s50 = series.sma50[i];
    if (s50 == null) return result("HOLD");
    return result(c < sma && s50 < sma ? "SHORT" : "BUY");
  }
  return result("HOLD");
}

function directedStrategy(name, value = "LONG") {
  const base = findStrategy(name);
  const direction = normalizeDirection(value);
  if (direction !== "LONG" && base.name === "Current (score)")
    throw new Error(
      "Current (score) has no short-entry strategy; choose a breakout, EMA, RSI or trend strategy",
    );
  return {
    ...base,
    direction,
    description: `${base.description} Direction: ${direction}.`,
    describe: (ctx, candles, series, i) =>
      `${direction} | close ${candles[i].close.toFixed(4)}`,
    analyze: (ctx, candles, series, i) => {
      if (direction === "SHORT")
        return shortAnalysis(base.name, ctx, candles, series, i);
      const long = base.analyze(ctx, candles, series, i);
      if (direction === "LONG") return long;
      const short = shortAnalysis(base.name, ctx, candles, series, i);
      // Keep exit intents separate from entries for each side.
      return {
        ...long,
        signal:
          long.signal === "BUY"
            ? "BUY"
            : short.signal === "SHORT"
              ? "SHORT"
              : long.signal,
        closeLong: long.signal === "SELL",
        closeShort: short.signal === "BUY",
      };
    },
  };
}
module.exports = { normalizeDirection, directedStrategy };
