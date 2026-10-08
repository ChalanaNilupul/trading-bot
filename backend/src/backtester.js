const fs = require("fs");
const path = require("path");
const { getHistoricalCandles } = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { analysisAt } = require("./strategy");
const { Engine } = require("./engine");
const { computeMetrics, printMetrics } = require("./metrics");

const SYMBOL = process.env.SYMBOL || "ETHUSDT";
const INTERVAL = process.env.INTERVAL || "15m"; // same default as the live bot
const TOTAL_CANDLES = Number(process.env.CANDLES || 20000);
const SLIPPAGE = Number(process.env.SLIPPAGE ?? 0.0005);
const FEE_RATE = Number(process.env.FEE_RATE ?? 0.001);
const TRAILING = process.env.TRAILING !== "0";
const SPLIT = Number(process.env.SPLIT || 0.7); // in-sample / out-of-sample split
const VERBOSE = process.env.VERBOSE === "1";
const DATA_FILE = process.env.DATA_FILE;       // load candles from a JSON file instead of Binance
const REFRESH = process.env.REFRESH === "1";
// Live, the kill switch needs a manual reset. In a backtest, auto-resume after N days so one halt
// doesn't hide the rest of the data. HALT_RESUME_DAYS=0 keeps it halted for the whole run.
const HALT_RESUME_DAYS = Number(process.env.HALT_RESUME_DAYS ?? 7);

const UNIT_MS = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 };
function intervalMs(interval) {
    const match = /^(\d+)([mhdw])$/.exec(interval);
    if (!match) throw new Error(`Unsupported interval: ${interval}`);
    return Number(match[1]) * UNIT_MS[match[2]];
}

async function loadCandles() {
    if (DATA_FILE) return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    const cache = path.join("data", `${SYMBOL}_${INTERVAL}_${TOTAL_CANDLES}.json`);
    if (!REFRESH && fs.existsSync(cache)) {
        console.log(`Using cached candles: ${cache} (REFRESH=1 to re-download)`);
        return JSON.parse(fs.readFileSync(cache, "utf8"));
    }

    const candles = await getHistoricalCandles(SYMBOL, INTERVAL, TOTAL_CANDLES);
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(candles));
    return candles;
}

function runSegment(candles, series, start, end) {
    const engine = new Engine({
        startingBalance: 1000,
        feeRate: FEE_RATE,
        slippage: SLIPPAGE,
        trailing: TRAILING,
        guard: { haltCooldownMs: HALT_RESUME_DAYS > 0 ? HALT_RESUME_DAYS * 86400e3 : null },
        onEvent: VERBOSE ? e => console.log(`[${e.type}] ${e.message}`) : undefined,
    });

    for (let i = start; i < end; i++) {
        engine.onCandle(candles[i], analysisAt(candles, series, i));
    }
    engine.closeAll(candles[end - 1].close, candles[end - 1].closeTime, "END OF TEST");

    const metrics = computeMetrics({
        trades: engine.trades,
        equityCurve: engine.equityCurve,
        startingBalance: engine.cfg.startingBalance,
        periodsPerYear: (365 * 86400e3) / intervalMs(INTERVAL),
    });
    const buyHold = (candles[end - 1].close / candles[start].open - 1) * 100;

    return { engine, metrics, buyHold };
}

async function runBacktest() {
    console.log("\n==============================");
    console.log("        BACKTEST V3");
    console.log("==============================");
    console.log(`${SYMBOL} ${INTERVAL} | fee ${(FEE_RATE * 100).toFixed(2)}% | slippage ${(SLIPPAGE * 100).toFixed(2)}% | trailing ${TRAILING ? "on" : "off"}`);

    const candles = await loadCandles();
    if (candles.length < WARMUP + 100) {
        console.log(`Not enough candles (${candles.length}).`);
        return;
    }

    const days = ((candles[candles.length - 1].closeTime - candles[0].openTime) / 86400e3).toFixed(0);
    console.log(`Candles: ${candles.length} (~${days} days)`);

    const series = buildSeries(candles); // computed once: O(n)
    const split = WARMUP + Math.floor((candles.length - WARMUP) * SPLIT);

    const full = runSegment(candles, series, WARMUP, candles.length);
    const inSample = runSegment(candles, series, WARMUP, split);
    const outSample = runSegment(candles, series, split, candles.length);

    printMetrics("FULL PERIOD", full.metrics, full.buyHold);
    printMetrics(`IN-SAMPLE (first ${Math.round(SPLIT * 100)}%)`, inSample.metrics, inSample.buyHold);
    printMetrics(`OUT-OF-SAMPLE (last ${Math.round((1 - SPLIT) * 100)}%)`, outSample.metrics, outSample.buyHold);

    const haltExits = full.metrics.byReason["RISK HALT"] || 0;
    console.log(`\nRiskGuard (full run): kill switch flattened ${haltExits} position(s)` + (HALT_RESUME_DAYS > 0 ? `, auto-resume after ${HALT_RESUME_DAYS}d (backtest only)` : ""));

    console.log("\nHow to read this:");
    console.log("  * If out-of-sample is much worse than in-sample, the strategy is overfit to the past.");
    console.log("  * Profit factor < 1.3 or fewer than ~100 trades = not enough evidence of an edge.");
    console.log("  * Compare against buy & hold: beating cash isn't enough if holding did better with less work.");

    fs.mkdirSync("data", { recursive: true });
    const header = "entryTime,exitTime,entryPrice,exitPrice,quantity,reason,grossPnL,fees,netPnL,rMultiple";
    const rows = full.engine.trades.map(t => [
        new Date(t.entryTime).toISOString(), new Date(t.exitTime).toISOString(),
        t.entryPrice, t.exitPrice, t.quantity, t.reason, t.grossPnL, t.fees, t.netPnL, t.rMultiple,
    ].join(","));
    fs.writeFileSync(path.join("data", "backtest_trades.csv"), [header, ...rows].join("\n"));
    console.log("Trade log: data/backtest_trades.csv\n");
}

runBacktest().catch(error => {
    console.error("Backtest error:", error.message);
    process.exitCode = 1;
});
