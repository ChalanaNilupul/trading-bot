const assert = require("node:assert/strict");
const ind = require("../src/indicators");
const { calculatePosition } = require("../src/riskManager");
const { RiskGuard } = require("../src/riskGuard");
const { Engine } = require("../src/engine");
const { FuturesEngine } = require("../src/futuresEngine");
const { Runner } = require("../src");
const { analysisAt, getStrategyAnalysis } = require("../src/strategy");
const { generateCandles } = require("../tools/synth");
const {
  STRATEGIES,
  BREAKOUT_VARIANTS,
  findStrategy,
} = require("../src/strategies");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}
const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

console.log("\nIndicators");
test("SMA series", () => {
  const s = ind.smaSeries([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s, [null, null, 2, 3, 4]);
});
test("EMA seeds with SMA", () => {
  const e = ind.emaSeries([1, 2, 3, 4, 5], 3);
  near(e[2], 2);
  near(e[3], 3);
  near(e[4], 4); // linear data: EMA lags by 1
});
test("RSI = 100 on pure uptrend, ~0 on pure downtrend", () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  const down = Array.from({ length: 40 }, (_, i) => 200 - i);
  assert.equal(ind.rsiSeries(up)[39], 100);
  assert.ok(ind.rsiSeries(down)[39] < 1);
});
test("ATR equals the range on constant-range candles", () => {
  const c = Array.from({ length: 30 }, () => ({
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
  }));
  near(ind.atrSeries(c)[29], 2);
});
test("ADX high in a strong trend, low in chop", () => {
  const trend = Array.from({ length: 120 }, (_, i) => ({
    open: 100 + i,
    high: 101 + i,
    low: 99.5 + i,
    close: 100.8 + i,
    volume: 1,
  }));
  const chop = Array.from({ length: 120 }, (_, i) => {
    const p = 100 + (i % 2 ? 1 : -1);
    return { open: p, high: p + 1, low: p - 1, close: p, volume: 1 };
  });
  assert.ok(ind.adxSeries(trend)[119] > 40, "trend ADX should be high");
  assert.ok(ind.adxSeries(chop)[119] < 15, "chop ADX should be low");
});

console.log("\nNo lookahead");
const candles = generateCandles(1500, 7);
const series = ind.buildSeries(candles);
test("analysis at i == analysis on candles[0..i] only", () => {
  for (const i of [250, 600, 900, 1499]) {
    const full = analysisAt(candles, series, i);
    const trunc = getStrategyAnalysis(candles.slice(0, i + 1));
    assert.equal(full.signal, trunc.signal);
    assert.equal(full.score, trunc.score);
    near(full.indicators.rsi14, trunc.indicators.rsi14, 1e-7);
    near(full.indicators.adx14, trunc.indicators.adx14, 1e-7);
  }
});

test("every strategy is causal (decision at i ignores future candles)", () => {
  for (const st of [...STRATEGIES, ...BREAKOUT_VARIANTS].filter(s => !s.requiredInterval)) {
    const ctx = st.prepare(candles, series);
    for (const i of [300, 700, 1200, 1499]) {
      const part = candles.slice(0, i + 1);
      const s2 = ind.buildSeries(part);
      const a = st.analyze(ctx, candles, series, i);
      const b = st.analyze(st.prepare(part, s2), part, s2, i);
      assert.equal(a.signal, b.signal, `${st.name} @${i}`);
    }
  }
});
test("findStrategy resolves names and rejects unknown ones", () => {
  assert.equal(findStrategy("breakout 50/20").name, "Breakout 50/20");
  assert.throws(() => findStrategy("nope"));
});

console.log("\nRisk manager");
test("risk sizing: loses ~riskPercent at the stop when not capped", () => {
  const p = calculatePosition({
    balance: 10000,
    entryPrice: 100,
    atr: 5,
    riskPercent: 0.01,
    maxPositionPercent: 1,
  });
  near(p.actualRisk, 100, 1e-6);
  assert.equal(p.cappedByCapital, false);
});
test("flags when the position cap overrides risk %", () => {
  const p = calculatePosition({
    balance: 1000,
    entryPrice: 2000,
    atr: 8,
    riskPercent: 0.01,
    maxPositionPercent: 0.25,
  });
  assert.equal(p.cappedByCapital, true);
  assert.ok(p.effectiveRiskPct < 0.5);
});
test("rejects trades where costs eat the target", () => {
  assert.equal(
    calculatePosition({ balance: 1000, entryPrice: 2000, atr: 0.5 }),
    null,
  );
});
test("never spends more than cash (incl. fee)", () => {
  const p = calculatePosition({
    balance: 1000,
    entryPrice: 100,
    atr: 5,
    riskPercent: 0.5,
    maxPositionPercent: 1,
  });
  assert.ok(p.positionValue * 1.001 <= 1000 + 1e-9);
});

console.log("\nRiskGuard");
const T = Date.UTC(2025, 0, 1, 12);
test("daily loss limit blocks entries, resets next UTC day", () => {
  const g = new RiskGuard({ maxDailyLossPct: 0.03 });
  g.update(1000, T);
  assert.equal(g.canOpen(T).allowed, true);
  g.update(965, T + 3600e3);
  assert.equal(g.canOpen(T + 3600e3).allowed, false);
  g.update(965, T + 24 * 3600e3);
  assert.equal(g.canOpen(T + 24 * 3600e3).allowed, true);
});
test("max drawdown trips the kill switch until reset", () => {
  const g = new RiskGuard({ maxDrawdownPct: 0.1 });
  g.update(1000, T);
  const ev = g.update(890, T + 1000);
  assert.ok(ev.some((m) => m.includes("KILL SWITCH")));
  assert.equal(g.canOpen(T + 10 * 86400e3).allowed, false);
  g.resetHalt(890);
  g.update(890, T + 11 * 86400e3);
  assert.equal(g.canOpen(T + 11 * 86400e3).allowed, true);
});
test("optional auto-resume after a halt (backtest mode)", () => {
  const g = new RiskGuard({ maxDrawdownPct: 0.1, haltCooldownMs: 7 * 86400e3 });
  g.update(1000, T);
  g.update(890, T + 1000);
  assert.equal(g.state.halted, true);
  g.update(890, T + 6 * 86400e3);
  assert.equal(g.state.halted, true);
  g.update(890, T + 8 * 86400e3);
  assert.equal(g.state.halted, false);
});
test("cooldown after N consecutive losses", () => {
  const g = new RiskGuard({ maxConsecutiveLosses: 3, cooldownMs: 4 * 3600e3 });
  g.update(1000, T);
  g.recordExit(-5, T);
  g.recordExit(-5, T);
  g.recordExit(-5, T);
  assert.equal(g.canOpen(T + 3600e3).allowed, false);
  assert.equal(g.canOpen(T + 5 * 3600e3).allowed, true);
});
test("a win resets the loss streak", () => {
  const g = new RiskGuard({ maxConsecutiveLosses: 3 });
  g.update(1000, T);
  g.recordExit(-5, T);
  g.recordExit(-5, T);
  g.recordExit(10, T);
  g.recordExit(-5, T);
  assert.equal(g.canOpen(T).allowed, true);
});
test("throttle halves risk in a deep drawdown", () => {
  const g = new RiskGuard({ throttleDrawdownPct: 0.05 });
  g.update(1000, T);
  g.update(940, T + 1000);
  assert.equal(g.riskMultiplier(940), 0.5);
});

console.log("\nEngine");
function runEngine(data, opts = {}) {
  const s = ind.buildSeries(data);
  const events = [];
  const e = new Engine({ onEvent: (ev) => events.push(ev), ...opts });
  for (let i = ind.WARMUP; i < data.length; i++)
    e.onCandle(data[i], analysisAt(data, s, i));
  e.closeAll(
    data[data.length - 1].close,
    data[data.length - 1].closeTime,
    "END",
  );
  return { e, events };
}
const data = generateCandles(8000, 42);

test("accounting identity: final cash == start + sum(net P/L)", () => {
  const { e } = runEngine(data);
  const sum = e.trades.reduce((s, t) => s + t.netPnL, 0);
  near(e.cash, e.cfg.startingBalance + sum, 1e-6);
  assert.equal(e.position, null);
  assert.ok(e.trades.length > 0, "synthetic run should trade at least once");
});
test("cash never goes negative; every loss respects stop+slippage bound", () => {
  const { e } = runEngine(data);
  for (const p of e.equityCurve) assert.ok(p.equity > 0);
  // a stop-loss trade can't lose much more than ~risk% (+ gap/fees): sanity bound of 3R
  for (const t of e.trades.filter((t) => t.reason === "STOP LOSS"))
    assert.ok(t.rMultiple > -3, `rMultiple ${t.rMultiple}`);
});
test("trailing stop only ratchets up within a trade, and actually triggers", () => {
  let prev = null,
    raises = 0,
    bad = 0;
  const { e } = runEngine(data, {
    onEvent: (ev) => {
      if (ev.type === "EXIT" || ev.type === "ENTRY") prev = null;
      if (ev.type === "TRAIL") {
        if (prev !== null && ev.stop <= prev) bad++;
        prev = ev.stop;
        raises++;
      }
    },
  });
  assert.equal(bad, 0);
  assert.ok(raises > 0, "trailing should engage at least once");
  assert.ok(
    e.trades.some((t) => t.reason === "TRAILING STOP"),
    "at least one trailing-stop exit",
  );
});
test("kill switch flattens and blocks further entries", () => {
  const { e, events } = runEngine(data, { guard: { maxDrawdownPct: 0.02 } });
  assert.equal(e.guard.state.halted, true);
  assert.ok(
    events.some((x) => x.type === "GUARD" && x.message.includes("KILL SWITCH")),
  );
  const haltIdx = events.findIndex(
    (x) => x.type === "GUARD" && x.message.includes("KILL SWITCH"),
  );
  assert.ok(
    !events.slice(haltIdx + 1).some((x) => x.type === "ENTRY"),
    "no entries after halt",
  );
});
test("state survives save/restore", () => {
  const { e } = runEngine(data.slice(0, 3000));
  const copy = new Engine();
  copy.restore(JSON.parse(JSON.stringify(e.toJSON())));
  assert.equal(copy.cash, e.cash);
  assert.equal(copy.trades.length, e.trades.length);
  assert.deepEqual(copy.guard.state, e.guard.state);
});
test("deterministic: same data, same result", () => {
  near(runEngine(data).e.cash, runEngine(data).e.cash);
});

console.log("\nUSDⓈ-M Futures paper engine");
const candle = (t, o, h, l, c) => ({
  openTime: t,
  closeTime: t + 60_000,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 100,
});
const neutral = { signal: "HOLD", indicators: { atr14: 1 } };
test("futures paper engine opens an isolated leveraged long with stop, target and liquidation price", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
    minNotional: 5,
  });
  e.onCandle(candle(T, 100, 100.5, 99.5, 100), { ...neutral, signal: "BUY" });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);
  assert.equal(e.position.side, "LONG");
  assert.equal(e.position.leverage, 5);
  assert.ok(e.position.margin > 0 && e.position.margin < 1000);
  assert.ok(e.position.stopPrice < e.position.entryPrice);
  assert.ok(e.position.targetPrice > e.position.entryPrice);
  assert.ok(e.position.liquidationPrice < e.position.stopPrice);
  assert.ok(e.cash < 1000);
});
test("immediate paper execution fills at the observed price, not the closed candle open", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0,
    slippage: 0,
    maxPositionPercent: 0.25,
  });
  const executionTime = T + 90_000;
  e.onCandle(
    candle(T, 100, 101, 99, 100),
    { ...neutral, signal: "BUY" },
    {
      immediate: true,
      executionPrice: 110,
      executionTime,
    },
  );
  assert.equal(e.position.entryPrice, 110);
  assert.equal(e.position.entryTime, executionTime);
  assert.equal(e.pending, null);
});
test("delayed polling ignores stale signals from missed candles and uses only the latest close", () => {
  const data = Array.from({ length: ind.WARMUP + 3 }, (_, i) =>
    candle(T + i * 60_000, 100, 101, 99, 100),
  );
  const firstNewIndex = ind.WARMUP + 1;
  const latestNewIndex = ind.WARMUP + 2;
  const analyzed = [];
  const testStrategy = {
    name: "test",
    engine: {},
    prepare: () => ({}),
    analyze: (_ctx, _candles, _series, i) => {
      analyzed.push(i);
      return { ...neutral, signal: i === firstNewIndex ? "BUY" : "HOLD" };
    },
  };
  const engine = new FuturesEngine({ startingBalance: 1000, slippage: 0 });
  const runner = new Runner("TESTUSDT", { strategy: testStrategy, engine });
  runner.persist = () => {};
  runner.lastProcessed = data[ind.WARMUP].closeTime;

  runner.processCandles(data, 105, T + 5 * 60_000);

  assert.deepEqual(
    analyzed,
    [latestNewIndex],
    "only the newest missed candle may create a signal",
  );
  assert.equal(
    engine.position,
    null,
    "a stale signal must not open a position",
  );
  assert.equal(engine.pending, null);
  assert.equal(runner.lastProcessed, data[latestNewIndex].closeTime);
  assert.equal(runner.lastPrice, 105);
});
test("delayed polling executes the latest signal at the current observed price", () => {
  const data = Array.from({ length: ind.WARMUP + 3 }, (_, i) =>
    candle(T + i * 60_000, 100, 101, 99, 100),
  );
  const testStrategy = {
    name: "test",
    engine: {},
    prepare: () => ({}),
    analyze: () => ({ ...neutral, signal: "BUY" }),
  };
  const engine = new FuturesEngine({ startingBalance: 1000, slippage: 0 });
  const runner = new Runner("TESTUSDT", { strategy: testStrategy, engine });
  runner.persist = () => {};
  runner.lastProcessed = data[ind.WARMUP].closeTime;

  runner.allRunners = [runner];
  runner.lastPrice = 100;

  runner.processCandles(data, 112, T + 5 * 60_000);

  assert.equal(engine.position.entryPrice, 112);
  assert.equal(engine.position.entryTime, T + 5 * 60_000);
  assert.equal(engine.pending, null);
});
test("delayed polling closes a position at the current observed price", () => {
  const data = Array.from({ length: ind.WARMUP + 3 }, (_, i) =>
    candle(T + i * 60_000, 100, 101, 99, 100),
  );
  const testStrategy = {
    name: "test",
    engine: {},
    prepare: () => ({}),
    analyze: () => ({ ...neutral, signal: "SELL" }),
  };
  const engine = new FuturesEngine({ startingBalance: 1000, slippage: 0 });
  engine.onCandle(candle(T, 100, 101, 99, 100), { ...neutral, signal: "BUY" });
  engine.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);
  const runner = new Runner("TESTUSDT", { strategy: testStrategy, engine });
  runner.persist = () => {};
  runner.lastProcessed = data[ind.WARMUP].closeTime;

  runner.processCandles(data, 90, T + 5 * 60_000);

  assert.equal(engine.position, null);
  assert.equal(engine.trades.at(-1).exitPrice, 90);
  assert.equal(engine.trades.at(-1).reason, "SIGNAL");
});

test("futures paper engine opens explicit short and closes on BUY without live orders", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
    allowShort: true,
  });

  e.onCandle(candle(T, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "SHORT",
  });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);

  assert.ok(e.position, "short position should open");
  assert.equal(e.position.side, "SHORT");
  assert.ok(e.position.stopPrice > e.position.entryPrice);
  assert.ok(e.position.targetPrice < e.position.entryPrice);

  e.onCandle(candle(T + 120_000, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });
  e.onCandle(candle(T + 180_000, 99, 99.5, 98.5, 99), neutral);

  assert.equal(e.position, null);
  assert.equal(e.trades.length, 1);
  assert.equal(e.trades[0].side, "SHORT");
  assert.ok(Number.isFinite(e.trades[0].netPnL));
});

test("SELL while flat does not open a short", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
    allowShort: true,
  });

  e.onCandle(candle(T, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "SELL",
  });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);

  assert.equal(e.position, null);
  assert.equal(e.trades.length, 0);
});

test("futures engine triggers stop before liquidation when stop is reached first", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
  });

  e.onCandle(candle(T, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);

  const stop = e.position.stopPrice;
  const liq = e.position.liquidationPrice;

  assert.ok(stop > liq, "long stop should be above liquidation price");

  e.onCandle(candle(T + 120_000, 100, 101, liq - 1, liq), neutral);

  assert.equal(e.position, null);
  assert.equal(e.trades.at(-1).reason, "STOP LOSS");
  assert.equal(e.trades.at(-1).exitPrice, stop);
});

test("futures engine simulates isolated liquidation before a stop on a gap candle", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
  });
  e.onCandle(candle(T, 100, 100.5, 99.5, 100), { ...neutral, signal: "BUY" });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);
  const liq = e.position.liquidationPrice;
  e.onCandle(candle(T + 120_000, liq - 2, liq + 1, liq - 3, liq - 1), neutral);
  assert.equal(e.position, null);
  assert.equal(e.trades.at(-1).reason, "LIQUIDATION");
  assert.ok(
    e.cash >= 0,
    "isolated paper wallet must not go negative from liquidation",
  );
});
test("futures engine charges estimated funding when an 8-hour boundary is crossed", () => {
  const nearFunding = Date.UTC(2025, 0, 1, 7, 58);
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
    fundingRatePer8h: 0.0001,
  });
  e.onCandle(candle(nearFunding, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });
  e.onCandle(candle(nearFunding + 60_000, 100, 101, 99, 100), neutral);
  e.onCandle(candle(nearFunding + 2 * 60_000, 100, 101, 99, 100), neutral);
  assert.ok(e.position.fundingPaid > 0);
});
test("futures engine calculates funding using the boundary price", () => {
  const nearFunding = Date.UTC(2025, 0, 1, 7, 58);

  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0,
    slippage: 0,
    maxPositionPercent: 0.25,
    fundingRatePer8h: 0.0001,
  });

  e.onCandle(candle(nearFunding, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });

  e.onCandle(candle(nearFunding + 60_000, 100, 101.5, 99.5, 101), neutral);

  assert.ok(e.position, "position should remain open");

  const quantity = e.position.quantity;
  const boundaryPrice = 101;
  const expectedFunding = quantity * boundaryPrice * 0.0001;

  near(e.position.fundingPaid, expectedFunding);
});

test("futures state fully survives restart with an open isolated margin position", () => {
  const e = new FuturesEngine({ startingBalance: 1000, leverage: 5 });

  e.onCandle(candle(T, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);

  assert.ok(e.position, "test must create an open position");

  // Simulate saving state to disk and constructing a fresh engine after restart.
  const savedState = JSON.parse(JSON.stringify(e.toJSON()));
  const restored = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
  });

  restored.restore(savedState);

  assert.ok(restored.position, "open position must be restored");
  assert.equal(restored.position.side, e.position.side);
  assert.equal(restored.position.side, "LONG");

  for (const field of [
    "entryPrice",
    "quantity",
    "margin",
    "stopPrice",
    "targetPrice",
    "liquidationPrice",
    "fundingPaid",
  ]) {
    assert.equal(
      restored.position[field],
      e.position[field],
      `${field} must survive restart`,
    );
  }

  assert.equal(restored.cash, e.cash);
  assert.equal(restored.trades.length, e.trades.length);
  assert.equal(restored.leverage, e.leverage);

  // Both engines must produce the same equity after restoration.
  assert.equal(restored.equity, e.equity);
});

test("allowShort=false ignores SELL signals while flat (long-only mode)", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    allowShort: false,
  });
  e.onCandle(candle(T, 100, 100.5, 99.5, 100), { ...neutral, signal: "SELL" });
  assert.equal(e.pending, null);
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);
  assert.equal(e.position, null);
  assert.equal(e.trades.length, 0);
});
test("liquidation candle still updates equity curve and risk guard", () => {
  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0.0005,
    slippage: 0,
    maxPositionPercent: 0.25,
  });
  e.onCandle(candle(T, 100, 100.5, 99.5, 100), { ...neutral, signal: "BUY" });
  e.onCandle(candle(T + 60_000, 100, 101, 99, 100), neutral);
  const liq = e.position.liquidationPrice;
  const before = e.equityCurve.length;
  e.onCandle(candle(T + 120_000, liq - 2, liq + 1, liq - 3, liq - 1), {
    ...neutral,
    signal: "BUY",
  });
  assert.equal(e.trades.at(-1).reason, "LIQUIDATION");
  assert.equal(
    e.equityCurve.length,
    before + 1,
    "equity curve must record the liquidation candle",
  );
  assert.equal(
    e.pending,
    null,
    "no new entry may be queued on the liquidation candle",
  );
});
test("futures engine uses 4h candle open at funding boundary", () => {
  const beforeFunding = Date.UTC(2025, 0, 1, 4, 0);

  const e = new FuturesEngine({
    startingBalance: 1000,
    leverage: 5,
    feeRate: 0,
    slippage: 0,
    maxPositionPercent: 0.25,
    fundingRatePer8h: 0.0001,
  });

  e.onCandle(candle(beforeFunding, 100, 100.5, 99.5, 100), {
    ...neutral,
    signal: "BUY",
  });

  e.onCandle(candle(beforeFunding + 60_000, 100, 101, 99, 100), neutral);

  const quantity = e.position.quantity;
  const fundingOpenPrice = 100;

  e.onCandle(
    candle(Date.UTC(2025, 0, 1, 8, 0), fundingOpenPrice, 100.1, 99.9, 100.05),
    neutral,
  );

  const expectedFunding = quantity * fundingOpenPrice * 0.0001;

  near(e.position.fundingPaid, expectedFunding);
});

console.log(`\n${passed} passed${process.exitCode ? ", SOME FAILED" : ""}\n`);

