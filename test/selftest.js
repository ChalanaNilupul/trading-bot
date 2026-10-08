const assert = require("node:assert/strict");
const ind = require("../src/indicators");
const { calculatePosition } = require("../src/riskManager");
const { RiskGuard } = require("../src/riskGuard");
const { Engine } = require("../src/engine");
const { analysisAt, getStrategyAnalysis } = require("../src/strategy");
const { generateCandles } = require("../tools/synth");

let passed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log(`  ok   ${name}`); }
    catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

console.log("\nIndicators");
test("SMA series", () => {
    const s = ind.smaSeries([1, 2, 3, 4, 5], 3);
    assert.deepEqual(s, [null, null, 2, 3, 4]);
});
test("EMA seeds with SMA", () => {
    const e = ind.emaSeries([1, 2, 3, 4, 5], 3);
    near(e[2], 2); near(e[3], 3); near(e[4], 4); // linear data: EMA lags by 1
});
test("RSI = 100 on pure uptrend, ~0 on pure downtrend", () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + i);
    const down = Array.from({ length: 40 }, (_, i) => 200 - i);
    assert.equal(ind.rsiSeries(up)[39], 100);
    assert.ok(ind.rsiSeries(down)[39] < 1);
});
test("ATR equals the range on constant-range candles", () => {
    const c = Array.from({ length: 30 }, () => ({ open: 100, high: 101, low: 99, close: 100, volume: 1 }));
    near(ind.atrSeries(c)[29], 2);
});
test("ADX high in a strong trend, low in chop", () => {
    const trend = Array.from({ length: 120 }, (_, i) => ({ open: 100 + i, high: 101 + i, low: 99.5 + i, close: 100.8 + i, volume: 1 }));
    const chop = Array.from({ length: 120 }, (_, i) => { const p = 100 + (i % 2 ? 1 : -1); return { open: p, high: p + 1, low: p - 1, close: p, volume: 1 }; });
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

console.log("\nRisk manager");
test("risk sizing: loses ~riskPercent at the stop when not capped", () => {
    const p = calculatePosition({ balance: 10000, entryPrice: 100, atr: 5, riskPercent: 0.01, maxPositionPercent: 1 });
    near(p.actualRisk, 100, 1e-6);
    assert.equal(p.cappedByCapital, false);
});
test("flags when the position cap overrides risk %", () => {
    const p = calculatePosition({ balance: 1000, entryPrice: 2000, atr: 8, riskPercent: 0.01, maxPositionPercent: 0.25 });
    assert.equal(p.cappedByCapital, true);
    assert.ok(p.effectiveRiskPct < 0.5);
});
test("rejects trades where costs eat the target", () => {
    assert.equal(calculatePosition({ balance: 1000, entryPrice: 2000, atr: 0.5 }), null);
});
test("never spends more than cash (incl. fee)", () => {
    const p = calculatePosition({ balance: 1000, entryPrice: 100, atr: 5, riskPercent: 0.5, maxPositionPercent: 1 });
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
    const g = new RiskGuard({ maxDrawdownPct: 0.10 });
    g.update(1000, T);
    const ev = g.update(890, T + 1000);
    assert.ok(ev.some(m => m.includes("KILL SWITCH")));
    assert.equal(g.canOpen(T + 10 * 86400e3).allowed, false);
    g.resetHalt(890);
    g.update(890, T + 11 * 86400e3);
    assert.equal(g.canOpen(T + 11 * 86400e3).allowed, true);
});
test("optional auto-resume after a halt (backtest mode)", () => {
    const g = new RiskGuard({ maxDrawdownPct: 0.10, haltCooldownMs: 7 * 86400e3 });
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
    g.recordExit(-5, T); g.recordExit(-5, T); g.recordExit(-5, T);
    assert.equal(g.canOpen(T + 3600e3).allowed, false);
    assert.equal(g.canOpen(T + 5 * 3600e3).allowed, true);
});
test("a win resets the loss streak", () => {
    const g = new RiskGuard({ maxConsecutiveLosses: 3 });
    g.update(1000, T);
    g.recordExit(-5, T); g.recordExit(-5, T); g.recordExit(10, T); g.recordExit(-5, T);
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
    const e = new Engine({ onEvent: ev => events.push(ev), ...opts });
    for (let i = ind.WARMUP; i < data.length; i++) e.onCandle(data[i], analysisAt(data, s, i));
    e.closeAll(data[data.length - 1].close, data[data.length - 1].closeTime, "END");
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
    for (const t of e.trades.filter(t => t.reason === "STOP LOSS")) assert.ok(t.rMultiple > -3, `rMultiple ${t.rMultiple}`);
});
test("trailing stop only ratchets up within a trade, and actually triggers", () => {
    let prev = null, raises = 0, bad = 0;
    const { e } = runEngine(data, {
        onEvent: ev => {
            if (ev.type === "EXIT" || ev.type === "ENTRY") prev = null;
            if (ev.type === "TRAIL") { if (prev !== null && ev.stop <= prev) bad++; prev = ev.stop; raises++; }
        },
    });
    assert.equal(bad, 0);
    assert.ok(raises > 0, "trailing should engage at least once");
    assert.ok(e.trades.some(t => t.reason === "TRAILING STOP"), "at least one trailing-stop exit");
});
test("kill switch flattens and blocks further entries", () => {
    const { e, events } = runEngine(data, { guard: { maxDrawdownPct: 0.02 } });
    assert.equal(e.guard.state.halted, true);
    assert.ok(events.some(x => x.type === "GUARD" && x.message.includes("KILL SWITCH")));
    const haltIdx = events.findIndex(x => x.type === "GUARD" && x.message.includes("KILL SWITCH"));
    assert.ok(!events.slice(haltIdx + 1).some(x => x.type === "ENTRY"), "no entries after halt");
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

console.log(`\n${passed} passed${process.exitCode ? ", SOME FAILED" : ""}\n`);
