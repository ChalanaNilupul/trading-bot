const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  runSolBaseline,
  validateCandles,
  validateReference,
  compareOffice,
  summarizeTrades,
} = require("../src/solBaseline");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sol-baseline-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candles = Array.from({ length: 500 }, (_, i) => ({
    openTime: i * 14400000,
    closeTime: (i + 1) * 14400000 - 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
  const metrics = {
    finalEquity: 1042,
    returnPct: 4.2,
    trades: 39,
    profitFactor: 1.76,
    maxDrawdownPct: 2.04,
    fees: 2.4,
    funding: 4.5,
  };
  const reference = {
    config: {
      symbol: "SOLUSDT",
      interval: "4h",
      direction: "LONG",
      leverage: 1,
      strategy: "Pure Breakout 40/20",
      candlesUsed: 500,
      startingBalance: 1000,
      feeRate: 0.0005,
      slippage: 0.0005,
      fundingRatePer8h: 0.0001,
      riskPercent: 0.0025,
      maxPositionPercent: 0.1,
      split: 0.7,
      haltResumeDays: 7,
      filters: { minNotional: 5 },
    },
    period: { startTime: 0, endTime: candles.at(-1).closeTime },
  };
  for (const segment of ["full", "inSample", "outSample"])
    reference[segment] = { metrics };
  const referencePath = path.join(dir, "reference.json");
  fs.writeFileSync(referencePath, "\uFEFF" + JSON.stringify(reference));
  return {
    dir,
    candles,
    reference,
    referencePath,
    dataDir: path.join(dir, "results"),
  };
}
function result(reference, difference = 0) {
  const row = {
    config: reference.config,
    period: reference.period,
    assumptions: {},
    risk: {},
  };
  for (const segment of ["full", "inSample", "outSample"])
    row[segment] = {
      metrics: {
        ...reference[segment].metrics,
        returnPct: reference[segment].metrics.returnPct + difference,
      },
      buyHold: 3,
      trades: [],
    };
  return row;
}
test("reference and 4h candle range are validated strictly", (t) => {
  const f = fixture(t);
  validateReference(f.reference);
  validateCandles(f.candles, f.reference);
  assert.throws(
    () =>
      validateReference({
        ...f.reference,
        config: { ...f.reference.config, interval: "15m" },
      }),
    /4h/,
  );
  assert.throws(
    () => validateCandles(f.candles.slice(1), f.reference),
    /exactly/,
  );
  const broken = structuredClone(f.candles);
  broken[1].openTime++;
  assert.throws(() => validateCandles(broken, f.reference), /Invalid/);
  const invalid = structuredClone(f.candles);
  invalid[5].high = 50;
  assert.throws(() => validateCandles(invalid, f.reference), /Invalid/);
});
test("baseline freezes dates, filters and costs and does not use environment trading settings", async (t) => {
  const f = fixture(t),
    calls = [];
  let fetches = 0;
  const report = await runSolBaseline(f, {
    fetchCandles: async (...args) => {
      fetches++;
      assert.deepEqual(args, [
        "SOLUSDT",
        "4h",
        500,
        f.reference.period.endTime,
      ]);
      return f.candles;
    },
    backtest: async (options) => {
      calls.push(options);
      return result(f.reference);
    },
  });
  assert.equal(fetches, 1);
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(
      (c) =>
        c.candlesData === f.candles &&
        c.direction === "LONG" &&
        c.leverage === 1 &&
        c.haltResumeDays === 7 &&
        c.trailing === false,
    ),
  );
  assert.deepEqual(calls[0].filters, f.reference.config.filters);
  assert.equal(calls[1].strategy, "Breakout 40/20");
  assert.equal(calls[2].feeRate, 0.001);
  assert.equal(calls[2].slippage, 0.001);
  assert.equal(calls[2].fundingRatePer8h, 0.0001);
  assert.equal(report.officeComparison.matches, true);
  assert.equal(report.aiIncluded, false);
  assert.equal(report.liveOrdersEnabled, false);
  assert.equal(fs.existsSync(path.join(f.dataDir, "report.json")), true);
  assert.equal(report.source.hashes["futuresEngine.js"].length, 64);
});
test("offline replay reuses archived candles without making market-data requests", async (t) => {
  const f = fixture(t);
  const backtest = async () => result(f.reference);
  const first = await runSolBaseline(f, {
    fetchCandles: async () => f.candles,
    backtest,
  });
  const second = await runSolBaseline(
    { ...f, offline: true },
    {
      fetchCandles: async () => {
        throw Error("unexpected network");
      },
      backtest,
    },
  );
  assert.equal(second.dataset.source, "cached");
  assert.equal(first.dataset.sha256, second.dataset.sha256);
});
test("offline missing cache and tampered cache fail rather than silently downloading", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    () => runSolBaseline({ ...f, offline: true }),
    /No archived candles/,
  );
  await runSolBaseline(f, {
    fetchCandles: async () => f.candles,
    backtest: async () => result(f.reference),
  });
  const file = path.join(f.dataDir, "candles.json");
  const cached = JSON.parse(fs.readFileSync(file));
  cached.candles[0].close = 100.5;
  fs.writeFileSync(file, JSON.stringify(cached));
  await assert.rejects(
    () => runSolBaseline({ ...f, offline: true }),
    /checksum mismatch/,
  );
});
test("incorrect returned candle dates are not archived as a valid baseline", async (t) => {
  const f = fixture(t),
    different = structuredClone(f.candles);
  different[0].openTime++;
  await assert.rejects(
    () => runSolBaseline(f, { fetchCandles: async () => different }),
    /dates differ/,
  );
  assert.equal(fs.existsSync(path.join(f.dataDir, "candles.json")), false);
});
test("office metric differences are visible and not disguised by a positive return", (t) => {
  const f = fixture(t);
  const comparison = compareOffice(result(f.reference, 1), f.reference);
  assert.equal(comparison.matches, false);
  assert.equal(
    comparison.differences.find(
      (x) => x.segment === "full" && x.metric === "returnPct",
    ).delta,
    1,
  );
  assert.equal(
    compareOffice(result(f.reference, 1e-8), f.reference).matches,
    true,
  );
});
test("trade diagnostic summary retains exit type, costs and holding time", () => {
  const summary = summarizeTrades([
    {
      reason: "STOP LOSS",
      entryTime: 0,
      exitTime: 3600000,
      netPnL: -1,
      fees: 0.1,
      funding: 0.02,
    },
    {
      reason: "SIGNAL",
      entryTime: 0,
      exitTime: 7200000,
      netPnL: 2,
      fees: 0.2,
      funding: 0.03,
    },
  ]);
  assert.equal(summary[0].netPnL, -1);
  assert.equal(summary[0].averageHoldingHours, 1);
  assert.equal(summary[1].winners, 1);
  assert.equal(summary[1].averageHoldingHours, 2);
});
