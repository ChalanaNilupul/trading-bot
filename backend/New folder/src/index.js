/**
 * Live PAPER bot. Runs continuously, acts once per closed candle, survives restarts.
 * Trades several coins in parallel; each coin has its own pretend $1000 account.
 *
 * Env:
 *   SYMBOLS        comma list (default: the 8 coins that were backtested)
 *   INTERVAL       candle size (default 4h, the timeframe the strategy was validated on)
 *   STRATEGY       name from strategies.js (default "Breakout 50/20")
 *   POLL_SECONDS   how often to check Binance (default 60)
 *   START_BALANCE  pretend balance per coin (default 1000)
 *   ONE_SHOT=1     single pass then exit
 *   RESET_HALT=1   clear a tripped kill switch after you've reviewed why it fired
 *   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   optional alerts
 */
const { getCandles, getSymbolFilters } = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { findStrategy, DEFAULT_STRATEGY } = require("./strategies");
const { Engine } = require("./engine");
const { computeMetrics } = require("./metrics");
const store = require("./store");
const { notify } = require("./notify");

const DEFAULT_SYMBOLS = "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,LINKUSDT";
const SYMBOLS = (process.env.SYMBOLS || process.env.SYMBOL || DEFAULT_SYMBOLS).split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const INTERVAL = process.env.INTERVAL || "4h";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const START_BALANCE = Number(process.env.START_BALANCE || 1000);
const ONE_SHOT = process.env.ONE_SHOT === "1";

const strategy = findStrategy(process.env.STRATEGY || DEFAULT_STRATEGY);
const slug = strategy.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);
const fmtPF = pf => (pf === Infinity ? "inf" : pf.toFixed(2));

class Runner {
    constructor(symbol) {
        this.symbol = symbol;
        this.lastProcessed = null;
        this.errors = 0;
        this.stateFile = `data/state_${symbol}_${INTERVAL}_${slug}.json`;
        this.tradeLog = `data/trades_${symbol}_${INTERVAL}_${slug}.jsonl`;
        this.engine = new Engine({
            startingBalance: START_BALANCE,
            keepEquityCurve: false,
            ...strategy.engine,
            onEvent: e => this.onEvent(e),
        });
        this.lastPrice = null;
        this.lastNote = "";
    }

    onEvent(e) {
        log(`${e.type.padEnd(5)} ${this.symbol} ${e.message}`);
        if (e.type === "EXIT") store.appendLine(this.tradeLog, { symbol: this.symbol, strategy: strategy.name, ...e.trade });
        if (["ENTRY", "EXIT", "GUARD"].includes(e.type)) notify(`${this.symbol} [${strategy.name}]: ${e.message}`);
    }

    persist() {
        store.save(this.stateFile, { lastProcessed: this.lastProcessed, engine: this.engine.toJSON() });
    }

    async init(loadFilters = true) {
        const saved = store.load(this.stateFile);
        if (saved) {
            this.engine.restore(saved.engine);
            this.lastProcessed = saved.lastProcessed ?? null;
            log(`${this.symbol}: restored state, ${this.engine.trades.length} trades, ${this.engine.position ? "IN POSITION" : "flat"}`);
        }
        if (process.env.RESET_HALT === "1") {
            this.engine.guard.resetHalt(this.engine.cash);
            this.persist();
            log(`${this.symbol}: kill switch manually reset`);
        }
        if (loadFilters) {
            try {
                Object.assign(this.engine.cfg, await getSymbolFilters(this.symbol));
            } catch (error) {
                log(`${this.symbol}: could not load exchange filters (${error.message}); continuing without them`);
            }
        }
    }

    async tick() {
        const candles = await getCandles(this.symbol, INTERVAL, 500);
        if (candles.length < WARMUP + 1) {
            log(`${this.symbol}: not enough candle data`);
            return false;
        }

        // First ever run: start from the newest closed candle instead of replaying history.
        if (this.lastProcessed === null) this.lastProcessed = candles[candles.length - 2].closeTime;

        const series = buildSeries(candles);
        const ctx = strategy.prepare(candles, series);
        let processed = 0;

        for (let i = WARMUP; i < candles.length; i++) {
            if (candles[i].closeTime <= this.lastProcessed) continue;
            const analysis = strategy.analyze(ctx, candles, series, i);
            this.engine.onCandle(candles[i], analysis);
            this.lastProcessed = candles[i].closeTime;
            this.lastPrice = candles[i].close;
            this.lastNote = `${analysis.signal} | ${strategy.describe ? strategy.describe(ctx, candles, series, i) : ""}`;
            processed++;
        }

        if (processed > 0) this.persist();
        return processed > 0;
    }

    summaryRow() {
        const e = this.engine;
        const m = computeMetrics({ trades: e.trades, startingBalance: e.cfg.startingBalance });
        const price = this.lastPrice ?? 0;
        const eq = e.equity(price);
        const g = e.guard.state;
        const pos = e.position ? `LONG ${e.position.quantity} @ ${e.position.entryPrice.toFixed(4)} SL ${e.position.stopPrice.toFixed(4)}` : e.pending ? `flat (queued ${e.pending.type})` : "flat";
        const guard = g.halted ? "HALTED" : g.dayBlocked ? "day-limit" : "ok";
        return `${this.symbol.padEnd(10)} ${pos.padEnd(46)} equity $${eq.toFixed(2).padStart(8)} (${(((eq / e.cfg.startingBalance) - 1) * 100).toFixed(1).padStart(5)}%)  trades ${String(m.trades).padStart(3)}  PF ${fmtPF(m.profitFactor).padStart(4)}  guard ${guard}`;
    }
}

function printSummary(runners) {
    console.log("\n==================================================================");
    console.log(`  PAPER BOT  ${strategy.name}  ${INTERVAL}   ${new Date().toLocaleString()}`);
    console.log("==================================================================");
    for (const r of runners) console.log(r.summaryRow());
    const live = runners.filter(r => r.lastNote);
    if (live.length) {
        console.log("\nLatest signal per coin:");
        for (const r of live) console.log(`  ${r.symbol.padEnd(10)} ${r.lastNote}`);
    }
    console.log("");
}

async function main() {
    log(`Strategy: ${strategy.name} | ${INTERVAL} | coins: ${SYMBOLS.join(", ")}`);
    const runners = SYMBOLS.map(s => new Runner(s));
    for (const r of runners) await r.init();

    const shutdown = () => {
        log("Shutting down, saving state.");
        runners.forEach(r => r.persist());
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    notify(`Paper bot started: ${strategy.name} ${INTERVAL} on ${SYMBOLS.join(", ")}`);

    let firstPass = true;
    do {
        let anyNew = false;
        for (const r of runners) {
            try {
                if (await r.tick()) anyNew = true;
                r.errors = 0;
            } catch (error) {
                r.errors++;
                log(`${r.symbol}: tick error (${r.errors}): ${error.message}`);
                if (r.errors === 10) notify(`${r.symbol}: 10 consecutive errors, bot is not getting data!`);
            }
        }
        if (anyNew || firstPass) printSummary(runners);
        firstPass = false;
        if (!ONE_SHOT) await sleep(POLL_SECONDS * 1000);
    } while (!ONE_SHOT);
}

if (require.main === module) main();

module.exports = { Runner, SYMBOLS, INTERVAL, POLL_SECONDS, START_BALANCE, strategy };
