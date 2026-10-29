const { test } = require("node:test");
const assert = require("node:assert/strict");
const { directedStrategy, normalizeDirection } = require("../src/direction");
const { buildSeries } = require("../src/indicators");
const { FuturesEngine } = require("../src/futuresEngine");
const { runFuturesBacktest } = require("../src/futuresBacktester");
const { trainSingleCoin } = require("../src/singleCoinLab");
const { STRATEGIES, BREAKOUT_VARIANTS } = require("../src/strategies");
const makeCandles = (sign, count = 600) =>
  Array.from({ length: count }, (_, i) => {
    const close = 200 + sign * i * 0.1;
    return {
      openTime: i * 900000,
      closeTime: (i + 1) * 900000 - 1,
      open: close - sign * 0.05,
      high: close + 0.08,
      low: close - 0.08,
      close,
      volume: 1000,
    };
  });
test("direction config rejects invalid values and unsupported short scoring preset", () => {
  assert.equal(normalizeDirection(" short "), "SHORT");
  assert.throws(() => normalizeDirection("neutral"));
  assert.throws(
    () => directedStrategy("Current (score)", "SHORT"),
    /no short-entry/,
  );
});
test("short breakout uses a bearish entry channel, not a long exit SELL", () => {
  const candles = makeCandles(-1),
    series = buildSeries(candles),
    strategy = directedStrategy("Breakout 50/20", "SHORT"),
    ctx = strategy.prepare(candles, series);
  assert.equal(strategy.analyze(ctx, candles, series, 300).signal, "SHORT");
  const rising = makeCandles(1),
    upSeries = buildSeries(rising);
  assert.notEqual(
    strategy.analyze(strategy.prepare(rising, upSeries), rising, upSeries, 300)
      .signal,
    "SHORT",
  );
});
test("all directional strategies remain causal when future candles change", () => {
  for (const name of new Set(
    [...STRATEGIES, ...BREAKOUT_VARIANTS].map((s) => s.name),
  )) {
    for (const direction of ["LONG", "SHORT"]) {
      if (name === "Current (score)" && direction === "SHORT") continue;
      const candles = makeCandles(-1),
        i = 300,
        strategy = directedStrategy(name, direction),
        series = buildSeries(candles);
      const full = strategy.analyze(
        strategy.prepare(candles, series),
        candles,
        series,
        i,
      );
      const truncated = candles.slice(0, i + 1),
        past = buildSeries(truncated);
      assert.deepEqual(
        full,
        strategy.analyze(strategy.prepare(truncated, past), truncated, past, i),
        `${name} ${direction}`,
      );
    }
  }
});
test("direction is enforced for new and queued entries without blocking short exits", () => {
  const candle = {
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    openTime: 1,
    closeTime: 2,
  };
  const execute = { immediate: true, executionPrice: 100, executionTime: 3 };
  const engine = new FuturesEngine({
    direction: "SHORT",
    allowShort: true,
    feeRate: 0,
    slippage: 0,
  });
  engine.onCandle(candle, { signal: "BUY", indicators: { atr14: 2 } }, execute);
  assert.equal(engine.position, null);
  engine.pending = { type: "OPEN_LONG", atr: 2 };
  engine.onCandle(candle, null);
  assert.equal(engine.position, null);
  engine.onCandle(
    candle,
    { signal: "SHORT", indicators: { atr14: 2 } },
    execute,
  );
  assert.equal(engine.position.side, "SHORT");
  engine.onCandle(candle, { signal: "BUY", entryAllowed: false }, execute);
  assert.equal(engine.position, null);
  assert.equal(engine.trades.length, 1);
  const long = new FuturesEngine({ direction: "LONG", allowShort: true });
  long.onCandle(candle, { signal: "SHORT", indicators: { atr14: 2 } }, execute);
  assert.equal(long.position, null);
});
test("shared historical engine produces only the requested trade direction", async () => {
  for (const direction of ["LONG", "SHORT"]) {
    const result = await runFuturesBacktest({
      symbol: "BTCUSDT",
      direction,
      strategy: "Breakout 50/20",
      candlesData: makeCandles(direction === "LONG" ? 1 : -1),
      filters: {},
      leverage: 1,
    });
    assert.ok(result.full.trades.length > 0);
    assert.ok(result.full.trades.every((t) => t.side === direction));
    assert.equal(result.config.direction, direction);
  }
});
const metrics = (overrides = {}) => ({
  returnPct: 5,
  profitFactor: 1.5,
  trades: 40,
  maxDrawdownPct: 2,
  expectancy: 1,
  ...overrides,
});
test("lab selects on validation only; final failure does not cause a different winner", async () => {
  const calls = [];
  const result = await trainSingleCoin(
    {
      symbol: "ETHUSDT",
      direction: "SHORT",
      interval: "15m",
      candles: 1500,
      candlesData: makeCandles(-1, 1500),
      filters: {},
    },
    {
      backtest: async (options) => {
        calls.push(options);
        if (options.split === 0.8)
          return { outSample: { metrics: metrics({ returnPct: -5 }) } };
        return {
          inSample: { metrics: metrics() },
          outSample: {
            metrics: metrics({
              returnPct: options.strategy === "EMA pullback" ? 10 : 5,
            }),
          },
        };
      },
    },
  );
  assert.equal(result.selected.strategy, "EMA pullback");
  assert.equal(result.passed, false);
  assert.equal(result.env, null);
  const finals = calls.filter((c) => c.split === 0.8);
  assert.equal(finals.length, 1);
  assert.equal(finals[0].strategy, "EMA pullback");
  assert.equal(finals[0].candlesData.length, 1500);
  assert.ok(
    calls
      .filter((c) => c.split === 0.75)
      .every((c) => c.candlesData.length === 1200),
  );
  assert.ok(
    calls.every((c) => c.direction === "SHORT" && c.haltResumeDays === 0),
  );
});
test("no candidate means no final test or activation settings", async () => {
  const result = await trainSingleCoin(
    {
      symbol: "BTCUSDT",
      direction: "LONG",
      candles: 1500,
      candlesData: makeCandles(1, 1500),
      filters: {},
    },
    {
      backtest: async (options) => {
        assert.equal(options.split, 0.75);
        return {
          inSample: { metrics: metrics({ returnPct: -1 }) },
          outSample: { metrics: metrics() },
        };
      },
    },
  );
  assert.equal(result.selected, null);
  assert.equal(result.finalTest, null);
  assert.equal(result.env, null);
});
test("lab emits a single coin profile only after the fixed final screen passes", async () => {
  const result = await trainSingleCoin(
    {
      symbol: "BTCUSDT",
      direction: "SHORT",
      candles: 1500,
      candlesData: makeCandles(-1, 1500),
      filters: {},
    },
    {
      backtest: async () => ({
        inSample: { metrics: metrics() },
        outSample: { metrics: metrics() },
      }),
    },
  );
  assert.equal(result.passed, true);
  assert.ok(result.env.includes("BOT_SYMBOL=BTCUSDT\nDIRECTION=SHORT"));
  assert.equal(result.aiIncluded, false);
  await assert.rejects(
    () => trainSingleCoin({ symbol: "bad/input", direction: "LONG" }),
    /Invalid symbol/,
  );
  await assert.rejects(
    () => trainSingleCoin({ direction: "BOTH" }),
    /requires LONG or SHORT/,
  );
});
