const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { getFuturesHistoricalCandles } = require("./binance");
const { runFuturesBacktest } = require("./futuresBacktester");
const store = require("./store");

const BACKEND = path.resolve(__dirname, "..");
const DEFAULT_REFERENCE = path.join(
  BACKEND,
  "leverage-tests",
  "SOLUSDT-1x.json",
);
const DEFAULT_DATA_DIR = path.join(BACKEND, "data", "sol-4h-baseline");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const parse = (text) => JSON.parse(text.replace(/^\uFEFF/, ""));

function validateReference(reference) {
  const c = reference?.config,
    p = reference?.period;
  if (
    !c ||
    !p ||
    c.symbol !== "SOLUSDT" ||
    c.interval !== "4h" ||
    c.direction !== "LONG" ||
    c.leverage !== 1 ||
    c.strategy !== "Pure Breakout 40/20"
  )
    throw new Error(
      "Reference must be the SOLUSDT 4h LONG 1x Pure Breakout 40/20 office report",
    );
  if (
    !Number.isInteger(c.candlesUsed) ||
    c.candlesUsed < 500 ||
    c.candlesUsed > 20000 ||
    !Number.isFinite(p.startTime) ||
    !Number.isFinite(p.endTime)
  )
    throw new Error("Invalid reference candle range");
  for (const key of [
    "feeRate",
    "slippage",
    "riskPercent",
    "maxPositionPercent",
    "fundingRatePer8h",
    "split",
    "haltResumeDays",
  ])
    if (!Number.isFinite(c[key]))
      throw new Error(`Reference is missing ${key}`);
  if (
    !c.filters ||
    !reference.full?.metrics ||
    !reference.inSample?.metrics ||
    !reference.outSample?.metrics
  )
    throw new Error("Reference is missing filters or metrics");
}

function validateCandles(candles, reference) {
  const { config: c, period: p } = reference;
  if (!Array.isArray(candles) || candles.length !== c.candlesUsed)
    throw new Error(`Expected exactly ${c.candlesUsed} candles`);
  if (
    candles[0].openTime !== p.startTime ||
    candles.at(-1).closeTime !== p.endTime
  )
    throw new Error("Candle dates differ from the office reference");
  for (let i = 0; i < candles.length; i++) {
    const row = candles[i];
    if (
      ![
        "openTime",
        "closeTime",
        "open",
        "high",
        "low",
        "close",
        "volume",
      ].every((k) => Number.isFinite(row[k])) ||
      row.low <= 0 ||
      row.volume < 0 ||
      row.high < Math.max(row.open, row.close) ||
      row.low > Math.min(row.open, row.close) ||
      row.closeTime !== row.openTime + 14400000 - 1 ||
      (i > 0 && row.openTime !== candles[i - 1].openTime + 14400000)
    )
      throw new Error(`Invalid or missing 4h candle at index ${i}`);
  }
}

function sourceFingerprint() {
  const files = [
    "futuresBacktester.js",
    "futuresEngine.js",
    "strategies.js",
    "direction.js",
    "indicators.js",
    "riskGuard.js",
    "metrics.js",
    "riskManager.js",
    "data.js",
    "store.js",
    "binance.js",
    "solBaseline.js",
  ];
  const hashes = Object.fromEntries(
    files.map((file) => [
      file,
      hash(fs.readFileSync(path.join(__dirname, file))),
    ]),
  );
  let commit = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: BACKEND,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* ZIP checkouts still have source hashes. */
  }
  return { commit, node: process.version, hashes };
}

function compareOffice(current, reference, tolerance = 1e-6) {
  const differences = [];
  for (const segment of ["full", "inSample", "outSample"]) {
    for (const metric of [
      "finalEquity",
      "returnPct",
      "trades",
      "profitFactor",
      "maxDrawdownPct",
      "fees",
      "funding",
    ]) {
      const actual = current[segment]?.metrics?.[metric],
        expected = reference[segment]?.metrics?.[metric];
      const matches =
        actual === expected ||
        (Number.isFinite(actual) &&
          Number.isFinite(expected) &&
          Math.abs(actual - expected) <= tolerance);
      differences.push({
        segment,
        metric,
        expected: expected ?? null,
        actual: actual ?? null,
        delta:
          Number.isFinite(actual) && Number.isFinite(expected)
            ? actual - expected
            : null,
        matches,
      });
    }
  }
  return {
    matches: differences.every((row) => row.matches),
    tolerance,
    differences,
  };
}

function summarizeTrades(trades) {
  const groups = new Map();
  for (const trade of trades) {
    const group = groups.get(trade.reason) || {
      reason: trade.reason,
      trades: 0,
      winners: 0,
      netPnL: 0,
      fees: 0,
      funding: 0,
      holdingHours: 0,
    };
    group.trades++;
    group.winners += Number(trade.netPnL > 0);
    group.netPnL += trade.netPnL;
    group.fees += trade.fees || 0;
    group.funding += trade.funding || 0;
    group.holdingHours += (trade.exitTime - trade.entryTime) / 3600000;
    groups.set(trade.reason, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    averageHoldingHours: group.holdingHours / group.trades,
  }));
}

async function runSolBaseline(
  {
    referencePath = DEFAULT_REFERENCE,
    dataDir = DEFAULT_DATA_DIR,
    offline = false,
  } = {},
  dependencies = {},
) {
  const rawReference = fs.readFileSync(referencePath, "utf8");
  const reference = parse(rawReference);
  validateReference(reference);
  const cachePath = path.join(dataDir, "candles.json");
  const referenceKey = {
    symbol: reference.config.symbol,
    interval: reference.config.interval,
    candles: reference.config.candlesUsed,
    startTime: reference.period.startTime,
    endTime: reference.period.endTime,
  };
  let candles, candleHash, dataSource;
  if (fs.existsSync(cachePath)) {
    const cached = parse(fs.readFileSync(cachePath, "utf8"));
    if (JSON.stringify(cached.referenceKey) !== JSON.stringify(referenceKey))
      throw new Error(
        "Cached dataset belongs to a different reference; use a separate output directory",
      );
    candles = cached.candles;
    candleHash = hash(JSON.stringify(candles));
    if (candleHash !== cached.sha256)
      throw new Error(
        "Cached candle checksum mismatch; dataset may have been edited",
      );
    dataSource = "cached";
  } else {
    if (offline)
      throw new Error(
        "No archived candles found. Run once without --offline to download the frozen date range",
      );
    candles = await (dependencies.fetchCandles || getFuturesHistoricalCandles)(
      referenceKey.symbol,
      referenceKey.interval,
      referenceKey.candles,
      referenceKey.endTime,
    );
    validateCandles(candles, reference);
    candleHash = hash(JSON.stringify(candles));
    store.save(cachePath, {
      referenceKey,
      sha256: candleHash,
      downloadedAt: new Date().toISOString(),
      candles,
    });
    dataSource = "downloaded";
  }
  validateCandles(candles, reference);
  const backtest = dependencies.backtest || runFuturesBacktest;
  const common = {
    ...reference.config,
    candles: reference.config.candlesUsed,
    candlesData: candles,
    filters: reference.config.filters,
    endTime: reference.period.endTime,
    trailing: false,
  };
  const scenarios = [
    { label: "Office settings replay", strategy: "Pure Breakout 40/20" },
    { label: "SMA200 comparison", strategy: "Breakout 40/20" },
    {
      label: "Pure breakout: 2x fees/slippage",
      strategy: "Pure Breakout 40/20",
      feeRate: common.feeRate * 2,
      slippage: common.slippage * 2,
    },
  ];
  const runs = [];
  let officeComparison;
  for (const scenario of scenarios) {
    const { label, ...overrides } = scenario;
    const result = await backtest({ ...common, ...overrides });
    if (!officeComparison) officeComparison = compareOffice(result, reference);
    runs.push({
      label,
      config: result.config,
      period: result.period,
      assumptions: result.assumptions,
      risk: result.risk,
      segments: Object.fromEntries(
        ["full", "inSample", "outSample"].map((segment) => [
          segment,
          {
            metrics: result[segment].metrics,
            buyHold: result[segment].buyHold,
            exitSummary: summarizeTrades(result[segment].trades),
            trades: result[segment].trades,
          },
        ]),
      ),
    });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "FROZEN_HISTORICAL_RESEARCH",
    liveOrdersEnabled: false,
    aiIncluded: false,
    source: sourceFingerprint(),
    reference: {
      file: path.basename(referencePath),
      sha256: hash(rawReference),
      ...referenceKey,
    },
    dataset: { file: "candles.json", sha256: candleHash, source: dataSource },
    officeComparison,
    runs,
    limitations: [
      "The original office report did not archive its input candles or code hash; matching dates/settings alone cannot prove identical original inputs.",
      "Later runs reuse archived candles. Metrics differences can reflect code changes or differences in the historical feed.",
      "The office auto-resume setting is preserved for reproduction; it is not approval to use auto-resume for live trading.",
      "No AI review or shared portfolio gate is simulated. These already-inspected periods are diagnostic data, not an untouched holdout.",
      "A historical match or positive result does not establish production readiness or future profitability.",
    ],
  };
  store.save(path.join(dataDir, "report.json"), report);
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--offline")) {
    console.error("Usage: node src/solBaseline.js [--offline]");
    process.exitCode = 1;
  } else
    runSolBaseline({ offline: args.includes("--offline") })
      .then((report) => {
        console.log(
          `SOLUSDT 4h LONG baseline | candles ${report.reference.candles} | ${new Date(report.reference.startTime).toISOString()} to ${new Date(report.reference.endTime).toISOString()}`,
        );
        console.log(
          `Office metrics: ${report.officeComparison.matches ? "MATCH" : "DIFFER — inspect report.json before changing strategy"}`,
        );
        console.table(
          report.runs.map((run) => ({
            Scenario: run.label,
            FullReturn: run.segments.full.metrics.returnPct.toFixed(2),
            OOSReturn: run.segments.outSample.metrics.returnPct.toFixed(2),
            OOSTrades: run.segments.outSample.metrics.trades,
            OOSPF: run.segments.outSample.metrics.profitFactor,
            OOSDrawdown:
              run.segments.outSample.metrics.maxDrawdownPct.toFixed(2),
          })),
        );
        console.log(
          `Dataset SHA256: ${report.dataset.sha256}\nReport: ${path.join(DEFAULT_DATA_DIR, "report.json")}\nNo orders or AI calls were made. Bot settings and paper state were not changed.`,
        );
      })
      .catch((error) => {
        console.error(`Baseline failed: ${error.message}`);
        process.exitCode = 1;
      });
}
module.exports = {
  runSolBaseline,
  validateCandles,
  validateReference,
  compareOffice,
  summarizeTrades,
};
