/**
 * Strategy comparison harness.
 *   npm run compare
 * Env: COINS=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT  TIMEFRAMES=1h,4h  SPLIT=0.7  FEE_RATE  SLIPPAGE  REFRESH=1
 */
const fs = require("fs");
const path = require("path");
const { buildSeries, WARMUP } = require("./indicators");
const { Engine } = require("./engine");
const { computeMetrics } = require("./metrics");
const { STRATEGIES, BREAKOUT_VARIANTS } = require("./strategies");
const { loadCandles, intervalMs } = require("./data");

const list = (v, d) => (v || d).split(",").map(s => s.trim()).filter(Boolean);
const COINS = list(process.env.COINS, "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT");
const TIMEFRAMES = list(process.env.TIMEFRAMES, "1h,4h");
const SPLIT = Number(process.env.SPLIT || 0.7);
const FEE_RATE = Number(process.env.FEE_RATE ?? 0.001);
const SLIPPAGE = Number(process.env.SLIPPAGE ?? 0.0005);
const REFRESH = process.env.REFRESH === "1";
// SET=breakout runs only the breakout family with neighbouring settings (robustness check).
const CANDIDATES = (process.env.SET || "").toLowerCase() === "breakout" ? BREAKOUT_VARIANTS : STRATEGIES;
const CANDLES = { "15m": 20000, "1h": 20000, "4h": 10000, "1d": 3000 };

// Pass criteria (pooled across coins, out-of-sample)
const MIN_TRADES = 100;
const MIN_PF = 1.3;
const MIN_COIN_SHARE = 0.75; // share of coins that must be profitable out-of-sample

function runSegment(strategy, ctx, candles, series, start, end, interval) {
    const engine = new Engine({
        startingBalance: 1000,
        feeRate: FEE_RATE,
        slippage: SLIPPAGE,
        guard: { haltCooldownMs: 7 * 86400e3 },
        ...strategy.engine,
    });

    for (let i = start; i < end; i++) {
        engine.onCandle(candles[i], strategy.analyze(ctx, candles, series, i));
    }
    engine.closeAll(candles[end - 1].close, candles[end - 1].closeTime, "END OF TEST");

    const metrics = computeMetrics({
        trades: engine.trades,
        equityCurve: engine.equityCurve,
        startingBalance: engine.cfg.startingBalance,
        periodsPerYear: (365 * 86400e3) / intervalMs(interval),
    });
    return {
        metrics,
        trades: engine.trades,
        buyHold: (candles[end - 1].close / candles[start].open - 1) * 100,
    };
}

const pad = (v, n) => String(v).padEnd(n);
const rpad = (v, n) => String(v).padStart(n);
const fmtPF = pf => (pf === Infinity ? "inf" : pf.toFixed(2));
const fmtPct = v => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function pooled(trades) {
    return computeMetrics({ trades, equityCurve: [], startingBalance: 1000 });
}

async function main() {
    console.log("\n==============================");
    console.log("     STRATEGY COMPARISON");
    console.log("==============================");
    console.log(`Coins: ${COINS.join(", ")} | Timeframes: ${TIMEFRAMES.join(", ")}`);
    console.log(`Fee ${(FEE_RATE * 100).toFixed(2)}% | slippage ${(SLIPPAGE * 100).toFixed(2)}% | out-of-sample = last ${Math.round((1 - SPLIT) * 100)}%`);
    console.log("Parameters are fixed textbook values, not tuned on this data.\n");

    const csv = ["timeframe,strategy,coin,is_trades,is_pf,oos_trades,oos_winrate,oos_pf,oos_return_pct,oos_maxdd_pct,oos_buyhold_pct"];
    const verdicts = [];

    for (const tf of TIMEFRAMES) {
        const total = Number(process.env.CANDLES_OVERRIDE) || CANDLES[tf] || 20000;
        console.log(`\n######## TIMEFRAME ${tf} ########`);

        // Load each coin once, build indicators once.
        const datasets = [];
        for (const coin of COINS) {
            try {
                console.log(`Loading ${coin} ${tf}...`);
                const candles = await loadCandles(coin, tf, total, { refresh: REFRESH });
                if (candles.length < WARMUP + 300) { console.log(`  skipped: only ${candles.length} candles`); continue; }
                const series = buildSeries(candles);
                const split = WARMUP + Math.floor((candles.length - WARMUP) * SPLIT);
                datasets.push({ coin, candles, series, split });
            } catch (error) {
                console.log(`  skipped ${coin}: ${error.message}`);
            }
        }
        if (datasets.length === 0) continue;

        for (const strategy of CANDIDATES) {
            console.log(`\n${strategy.name}  -  ${strategy.description}`);
            console.log(`  ${pad("Coin", 9)}${rpad("IS PF", 7)}${rpad("OOS trades", 12)}${rpad("Win%", 7)}${rpad("OOS PF", 8)}${rpad("Return", 9)}${rpad("MaxDD", 8)}${rpad("Buy&Hold", 10)}`);

            const rows = [];
            for (const d of datasets) {
                const ctx = strategy.prepare(d.candles, d.series);
                const is = runSegment(strategy, ctx, d.candles, d.series, WARMUP, d.split, tf);
                const oos = runSegment(strategy, ctx, d.candles, d.series, d.split, d.candles.length, tf);
                rows.push({ coin: d.coin, is, oos });

                const m = oos.metrics;
                console.log(`  ${pad(d.coin, 9)}${rpad(fmtPF(is.metrics.profitFactor), 7)}${rpad(m.trades, 12)}${rpad(m.winRate.toFixed(0), 7)}${rpad(fmtPF(m.profitFactor), 8)}${rpad(fmtPct(m.returnPct), 9)}${rpad(m.maxDrawdownPct.toFixed(1) + "%", 8)}${rpad(fmtPct(oos.buyHold), 10)}`);
                csv.push([tf, strategy.name, d.coin, is.metrics.trades, is.metrics.profitFactor.toFixed(3), m.trades, m.winRate.toFixed(1), m.profitFactor.toFixed(3), m.returnPct.toFixed(2), m.maxDrawdownPct.toFixed(2), oos.buyHold.toFixed(2)].join(","));
            }

            const pOOS = pooled(rows.flatMap(r => r.oos.trades));
            const pIS = pooled(rows.flatMap(r => r.is.trades));
            const profitable = rows.filter(r => r.oos.metrics.returnPct > 0).length;
            const checks = {
                trades: pOOS.trades >= MIN_TRADES,
                pf: pOOS.profitFactor > MIN_PF,
                coins: profitable >= Math.ceil(MIN_COIN_SHARE * rows.length),
                insample: pIS.profitFactor > 1,
            };
            verdicts.push({ tf, name: strategy.name, pOOS, pIS, profitable, n: rows.length, checks, pass: Object.values(checks).every(Boolean) });
        }
    }

    // ---- Verdict table ----
    console.log("\n\n==================================================================");
    console.log("  VERDICT (out-of-sample, all coins pooled)");
    console.log("==================================================================");
    console.log(`Pass needs: >=${MIN_TRADES} trades, PF >${MIN_PF}, >=${Math.round(MIN_COIN_SHARE * 100)}% of coins profitable, in-sample PF >1\n`);
    console.log(`${pad("TF", 5)}${pad("Strategy", 20)}${rpad("Trades", 8)}${rpad("PF", 7)}${rpad("Coins+", 8)}${rpad("IS PF", 8)}   Result`);

    verdicts.sort((a, b) => b.pOOS.profitFactor - a.pOOS.profitFactor);
    for (const v of verdicts) {
        const failed = Object.entries(v.checks).filter(([, ok]) => !ok).map(([k]) => k);
        console.log(`${pad(v.tf, 5)}${pad(v.name, 20)}${rpad(v.pOOS.trades, 8)}${rpad(fmtPF(v.pOOS.profitFactor), 7)}${rpad(`${v.profitable}/${v.n}`, 8)}${rpad(fmtPF(v.pIS.profitFactor), 8)}   ${v.pass ? "PASS" : "fail (" + failed.join(", ") + ")"}`);
    }

    const passers = verdicts.filter(v => v.pass);
    console.log("\n------------------------------------------------------------------");
    if (passers.length === 0) {
        console.log("Nothing passed. That's a valid result: none of these ideas shows a reliable edge");
        console.log("after fees and slippage. Do not trade them. Try different ideas, or longer history.");
    } else {
        console.log(`${passers.length} candidate(s) passed: ${passers.map(p => `${p.name} @ ${p.tf}`).join("; ")}`);
        console.log("\nCAUTION: you just tested many combinations, so some pass by luck alone.");
        console.log("Before trusting a pass: (1) check it on coins NOT in this list (set COINS=...),");
        console.log("(2) re-run with REFRESH=1 in a few weeks on new data, (3) then paper trade it.");
    }

    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync(path.join("data", "compare_results.csv"), csv.join("\n"));
    console.log("\nDetailed rows saved: data/compare_results.csv\n");
}

main().catch(error => {
    console.error("Compare error:", error.message);
    process.exitCode = 1;
});
