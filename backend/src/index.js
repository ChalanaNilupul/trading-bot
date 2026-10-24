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
const { getFuturesCandles, getFuturesTickerPrice, getFuturesSymbolFilters } = require("./binance");
const { buildSeries, WARMUP } = require("./indicators");
const { findStrategy, DEFAULT_STRATEGY } = require("./strategies");
const { FuturesEngine } = require("./futuresEngine");
const { computeMetrics } = require("./metrics");
const store = require("./store");
const { notify } = require("./notify");

const DEFAULT_SYMBOLS = "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,ADAUSDT,AVAXUSDT,LINKUSDT";
const SYMBOLS = (process.env.SYMBOLS || process.env.SYMBOL || DEFAULT_SYMBOLS).split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const INTERVAL = process.env.INTERVAL || "4h";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || 60);
const START_BALANCE = Number(process.env.START_BALANCE || 1000);
const LEVERAGE = Number(process.env.LEVERAGE || 5);
const RUNNER_BALANCE = START_BALANCE / SYMBOLS.length;
const ONE_SHOT = process.env.ONE_SHOT === "1";

const strategy = findStrategy(process.env.STRATEGY || DEFAULT_STRATEGY);
const slug = strategy.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);
const fmtPF = pf => (pf === Infinity ? "inf" : pf.toFixed(2));

class Runner {
    constructor(symbol, options = {}) {
        this.symbol = symbol;
        this.strategy = options.strategy || strategy;
        this.lastProcessed = null;
        this.resetToken = null;
        this.errors = 0;
        this.stateFile = `data/state_futures_${symbol}_${INTERVAL}_${slug}.json`;
        this.tradeLog = `data/trades_futures_${symbol}_${INTERVAL}_${slug}.jsonl`;
        this.engine = options.engine || new FuturesEngine({
            startingBalance: RUNNER_BALANCE,
            leverage: LEVERAGE,
            feeRate: Number(process.env.FEE_RATE || 0.0005),
            slippage: Number(process.env.SLIPPAGE || 0.0005),
            fundingRatePer8h: Number(process.env.FUNDING_RATE_8H || 0.0001),
            riskPercent: Number(process.env.RISK_PERCENT || 0.01),
            maxPositionPercent: Number(process.env.MAX_MARGIN_PERCENT || 0.25),
            allowShort: process.env.SHORTS === "1",
            keepEquityCurve: false,
            ...this.strategy.engine,
            onEvent: e => this.onEvent(e),
        });
        this.lastPrice = null;
        this.lastNote = "";
    }

    onEvent(e) {
        log(`${e.type.padEnd(5)} ${this.symbol} ${e.message}`);
        if (e.type === "EXIT") store.appendLine(this.tradeLog, { symbol: this.symbol, strategy: this.strategy.name, ...e.trade });
        if (["ENTRY", "EXIT", "GUARD"].includes(e.type)) notify(`${this.symbol} [${this.strategy.name}]: ${e.message}`);
    }

    persist() {
        store.save(this.stateFile, { lastProcessed: this.lastProcessed, resetToken: this.resetToken, engine: this.engine.toJSON() });
    }

    async init(loadFilters = true) {
        const saved = store.load(this.stateFile);
        if (saved) {
            this.engine.restore(saved.engine);
            this.lastProcessed = saved.lastProcessed ?? null;
            this.resetToken = saved.resetToken ?? null;
            log(`${this.symbol}: restored state, ${this.engine.trades.length} trades, ${this.engine.position ? "IN POSITION" : "flat"}`);
        }
        // One-shot: applies only when RESET_HALT's value differs from the last one used (e.g. 1, then 2).
        if (process.env.RESET_HALT && process.env.RESET_HALT !== this.resetToken) {
            this.engine.guard.resetHalt(this.engine.cash);
            this.resetToken = process.env.RESET_HALT;
            this.persist();
            log(`${this.symbol}: kill switch manually reset (token ${this.resetToken})`);
        }
        if (loadFilters) {
            try {
                Object.assign(this.engine.cfg, await getFuturesSymbolFilters(this.symbol));
            } catch (error) {
                log(`${this.symbol}: could not load exchange filters (${error.message}); continuing without them`);
            }
        }
    }

    async tick() {
        const [candles, observedPrice] = await Promise.all([
            getFuturesCandles(this.symbol, INTERVAL, 500),
            getFuturesTickerPrice(this.symbol),
        ]);
        if (candles.length < WARMUP + 1) {
            log(`${this.symbol}: not enough candle data`);
            return false;
        }
        return this.processCandles(candles, observedPrice, Date.now());
    }

    processCandles(candles, observedPrice, executionTime) {
        if (!Number.isFinite(observedPrice) || observedPrice <= 0) {
            throw new Error(`Invalid observed execution price for ${this.symbol}`);
        }
        // First ever run: start from the newest closed candle instead of replaying history.
        if (this.lastProcessed === null) this.lastProcessed = candles[candles.length - 2].closeTime;

        const series = buildSeries(candles);
        const ctx = this.strategy.prepare(candles, series);
        const newIndices = [];
        for (let i = WARMUP; i < candles.length; i++) {
            if (candles[i].closeTime > this.lastProcessed) newIndices.push(i);
        }
        if (newIndices.length === 0) {
            this.lastPrice = observedPrice;
            return false;
        }

        const latestNewIndex = newIndices[newIndices.length - 1];
        if (this.engine.pending?.type === "OPEN_LONG" || this.engine.pending?.type === "OPEN_SHORT") {
            this.engine.pending = null;
            log(`${this.symbol}: discarded stale entry signal while catching up`);
        }
        for (const i of newIndices) {
            const isLatest = i === latestNewIndex;
            const analysis = isLatest
                ? this.strategy.analyze(ctx, candles, series, i)
                : null;
            this.engine.onCandle(candles[i], analysis, {
                deferPending: !isLatest,
                immediate: isLatest,
                executionPrice: observedPrice,
                executionTime,
            });
            this.lastProcessed = candles[i].closeTime;
            if (isLatest) {
                this.lastPrice = observedPrice;
                this.lastNote = `${analysis.signal} | ${this.strategy.describe ? this.strategy.describe(ctx, candles, series, i) : ""}`;
            }
        }

        this.persist();
        return true;
    }

    summaryRow() {
        const e = this.engine;
        const m = computeMetrics({ trades: e.trades, startingBalance: e.cfg.startingBalance });
        const price = this.lastPrice ?? 0;
        const eq = e.equity(price);
        const g = e.guard.state;
        const pos = e.position ? `${e.position.side} ${e.position.quantity} @ ${e.position.entryPrice.toFixed(4)} SL ${e.position.stopPrice.toFixed(4)} LIQ ${e.position.liquidationPrice.toFixed(4)}` : e.pending ? `flat (queued ${e.pending.type})` : "flat";
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
    log(`Mode: FUTURES PAPER (no live orders) | ${LEVERAGE}x isolated | total wallet: ${START_BALANCE} USDT (${RUNNER_BALANCE.toFixed(2)} per symbol account) | Strategy: ${strategy.name} | ${INTERVAL} | coins: ${SYMBOLS.join(", ")}`);
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

module.exports = { Runner, SYMBOLS, INTERVAL, POLL_SECONDS, START_BALANCE, RUNNER_BALANCE, LEVERAGE, strategy };
