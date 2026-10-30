const test = require("node:test");
const assert = require("node:assert/strict");
const { findStrategy } = require("../src/strategies");

function candlesForBreakout() {
  return Array.from({ length: 41 }, (_, i) => ({
    openTime: i * 900000,
    closeTime: (i + 1) * 900000 - 1,
    open: 95,
    high: i === 40 ? 102 : 100,
    low: 90,
    close: i === 40 ? 101 : 95,
    volume: 1,
  }));
}

test("Pure Breakout 40/20 can enter without an SMA200 value", () => {
  const candles = candlesForBreakout();
  const series = {
    atr14: candles.map(() => 1),
    sma200: candles.map(() => null),
  };
  const pure = findStrategy("Pure Breakout 40/20");
  const context = pure.prepare(candles, series);
  assert.equal(pure.analyze(context, candles, series, 40).signal, "BUY");
});

test("filtered Breakout 40/20 waits when SMA200 is unavailable", () => {
  const candles = candlesForBreakout();
  const series = {
    atr14: candles.map(() => 1),
    sma200: candles.map(() => null),
  };
  const filtered = findStrategy("Breakout 40/20");
  const context = filtered.prepare(candles, series);
  assert.equal(filtered.analyze(context, candles, series, 40).signal, "HOLD");
});
