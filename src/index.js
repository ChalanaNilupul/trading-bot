/**
 * Live PAPER bot. Runs continuously, acts once per closed candle, survives restarts.
 *
 * Env: SYMBOL, INTERVAL, POLL_SECONDS (default 20), ONE_SHOT=1 (single pass then exit),
 *      RESET_HALT=1 (clear the kill switch after you've reviewed why it fired),
 *      TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID (optional alerts)
 */
const { getCandles, getSymbolFilters } = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { analysisAt } = require("./strategy");
const { Engine } = require("./engine");
const { computeMetrics } = require("./metrics");
const store = require("./store");
const { notify } = require("./notify");

const SYMBOL = process.env.SYMBOL || "ETHUSDT";
const INTERVAL = process.env.INTERVAL || "15m";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 20);
const ONE_SHOT = process.env.ONE_SHOT === "1";

const STATE_FILE = `data/state_${SYMBOL}_${INTERVAL}.json`;
const TRADE_LOG = `data/trades_${SYMBOL}_${INTERVAL}.jsonl`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);

let lastProcessed = null;

const engine = new Engine({
    startingBalance: 1000,
    keepEquityCurve: false,
    onEvent: e => {
        log(`${e.type.padEnd(5)} ${SYMBOL} ${e.message}`);
        if (e.type === "EXIT") store.appendLine(TRADE_LOG, { symbol: SYMBOL, ...e.trade });
        if (["ENTRY", "EXIT", "GUARD"].includes(e.type)) notify(`${SYMBOL}: ${e.message}`);
    },
});

function persist() {
    store.save(STATE_FILE, { lastProcessed, engine: engine.toJSON() });
}

function printDashboard(candle, analysis) {
    const eq = engine.equity(candle.close);
    const m = computeMetrics({ trades: engine.trades, startingBalance: engine.cfg.startingBalance });
    const g = engine.guard.state;
    const ind = analysis.indicators;

    console.log("\n==============================");
    console.log(`  PAPER BOT V3  ${SYMBOL} ${INTERVAL}`);
    console.log("==============================");
    console.log(`Candle:   ${new Date(candle.closeTime).toLocaleString()}   Price: $${candle.close.toFixed(4)}`);
    console.log(`Signal:   ${analysis.signal}  (score ${analysis.score}/${analysis.maxScore})`);
    if (ind) console.log(`RSI ${ind.rsi14.toFixed(1)} | ADX ${ind.adx14.toFixed(1)} | ATR ${ind.atr14.toFixed(4)}`);
    console.log(`Reasons:  ${analysis.reasons.join(", ") || "none"}`);
    console.log(`Warnings: ${analysis.warnings.join(", ") || "none"}`);

    const pos = engine.position;
    console.log(pos
        ? `Position: ${pos.quantity} @ ${pos.entryPrice.toFixed(4)} | SL ${pos.stopPrice.toFixed(4)} | TP ${pos.targetPrice.toFixed(4)}`
        : `Position: flat${engine.pending ? ` (queued ${engine.pending.type} for next open)` : ""}`);

    console.log(`Equity:   $${eq.toFixed(2)}  (${((eq / engine.cfg.startingBalance - 1) * 100).toFixed(2)}%)  peak $${engine.peak.toFixed(2)}`);
    console.log(`Trades:   ${m.trades}  win rate ${m.winRate.toFixed(0)}%  PF ${m.profitFactor === Infinity ? "inf" : m.profitFactor.toFixed(2)}`);
    console.log(`Guard:    ${g.halted ? "HALTED - " + g.haltReason : g.dayBlocked ? "daily limit hit" : "OK"} | trades today ${g.tradesToday} | loss streak ${g.consecutiveLosses}`);
}

async function tick() {
    const candles = await getCandles(SYMBOL, INTERVAL, 500);
    if (candles.length < WARMUP + 1) {
        log("Not enough candle data.");
        return;
    }

    // First ever run: start from the newest closed candle instead of replaying history.
    if (lastProcessed === null) lastProcessed = candles[candles.length - 2].closeTime;

    const series = buildSeries(candles);
    let lastAnalysis = null;
    let processed = 0;

    for (let i = WARMUP; i < candles.length; i++) {
        if (candles[i].closeTime <= lastProcessed) continue;
        lastAnalysis = analysisAt(candles, series, i);
        engine.onCandle(candles[i], lastAnalysis);
        lastProcessed = candles[i].closeTime;
        processed++;
    }

    if (processed > 0) {
        persist();
        printDashboard(candles[candles.length - 1], lastAnalysis);
    }
}

async function main() {
    const saved = store.load(STATE_FILE);
    if (saved) {
        engine.restore(saved.engine);
        lastProcessed = saved.lastProcessed ?? null;
        log(`Restored state: equity $${engine.lastEquity.toFixed(2)}, ${engine.trades.length} trades, ${engine.position ? "IN POSITION" : "flat"}`);
    }

    if (process.env.RESET_HALT === "1") {
        engine.guard.resetHalt(engine.cash);
        log("Kill switch manually reset.");
        persist();
    }

    try {
        Object.assign(engine.cfg, await getSymbolFilters(SYMBOL));
        log(`Exchange filters: step ${engine.cfg.stepSize}, min notional ${engine.cfg.minNotional}`);
    } catch (error) {
        log(`Could not load exchange filters (${error.message}); continuing without them.`);
    }

    const shutdown = () => {
        log("Shutting down, saving state.");
        persist();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    notify(`Paper bot started: ${SYMBOL} ${INTERVAL}`);

    let consecutiveErrors = 0;
    do {
        try {
            await tick();
            consecutiveErrors = 0;
        } catch (error) {
            consecutiveErrors++;
            log(`Tick error (${consecutiveErrors}): ${error.message}`);
            if (consecutiveErrors === 10) notify(`${SYMBOL}: 10 consecutive errors, bot is not getting data!`);
        }
        if (!ONE_SHOT) await sleep(POLL_SECONDS * 1000);
    } while (!ONE_SHOT);
}

main();
