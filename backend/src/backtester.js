// const fs = require("fs");
// const path = require("path");
// const { getHistoricalCandles } = require("./binance");
// const { buildSeries, WARMUP } = require("./indicators");
// const { analysisAt } = require("./strategy");
// const { Engine } = require("./futureEngine");
// const { computeMetrics, printMetrics } = require("./metrics");

// const DEFAULTS = {
//   symbol: process.env.SYMBOL || "ETHUSDT",
//   interval: process.env.INTERVAL || "15m",
//   candles: Number(process.env.CANDLES || 20000),
//   slippage: Number(process.env.SLIPPAGE ?? 0.0005),
//   feeRate: Number(process.env.FEE_RATE ?? 0.001),
//   trailing: process.env.TRAILING !== "0",
//   split: Number(process.env.SPLIT || 0.7),
//   verbose: process.env.VERBOSE === "1",
//   dataFile: process.env.DATA_FILE,
//   refresh: process.env.REFRESH === "1",
//   haltResumeDays: Number(process.env.HALT_RESUME_DAYS ?? 7),
// };

// const UNIT_MS = {
//   m: 60e3,
//   h: 3600e3,
//   d: 86400e3,
//   w: 7 * 86400e3,
// };

// function intervalMs(interval) {
//   const match = /^(\d+)([mhdw])$/.exec(interval);

//   if (!match) {
//     throw new Error(`Unsupported interval: ${interval}`);
//   }

//   return Number(match[1]) * UNIT_MS[match[2]];
// }

// async function loadCandles(config) {
//   const { symbol, interval, candles: totalCandles, dataFile, refresh } = config;

//   if (dataFile) {
//     return JSON.parse(fs.readFileSync(dataFile, "utf8"));
//   }

//   const cache = path.join("data", `${symbol}_${interval}_${totalCandles}.json`);

//   if (!refresh && fs.existsSync(cache)) {
//     console.log(`Using cached candles: ${cache} (REFRESH=1 to re-download)`);

//     return JSON.parse(fs.readFileSync(cache, "utf8"));
//   }

//   const candles = await getHistoricalCandles(symbol, interval, totalCandles);

//   fs.mkdirSync("data", { recursive: true });
//   fs.writeFileSync(cache, JSON.stringify(candles));

//   return candles;
// }

// function runSegment(candles, series, start, end, config) {
//   const engine = new Engine({
//     startingBalance: 1000,
//     feeRate: config.feeRate,
//     slippage: config.slippage,
//     trailing: config.trailing,

//     guard: {
//       haltCooldownMs:
//         config.haltResumeDays > 0 ? config.haltResumeDays * 86400e3 : null,
//     },

//     onEvent: config.verbose
//       ? (e) => console.log(`[${e.type}] ${e.message}`)
//       : undefined,
//   });

//   for (let i = start; i < end; i++) {
//     engine.onCandle(candles[i], analysisAt(candles, series, i));
//   }

//   engine.closeAll(
//     candles[end - 1].close,
//     candles[end - 1].closeTime,
//     "END OF TEST",
//   );

//   const metrics = computeMetrics({
//     trades: engine.trades,
//     equityCurve: engine.equityCurve,
//     startingBalance: engine.cfg.startingBalance,
//     periodsPerYear: (365 * 86400e3) / intervalMs(config.interval),
//   });

//   const buyHold = (candles[end - 1].close / candles[start].open - 1) * 100;

//   return {
//     engine,
//     metrics,
//     buyHold,
//   };
// }

// async function runBacktest(options = {}) {
//   const config = {
//     ...DEFAULTS,
//     ...options,
//   };

//   const {
//     symbol,
//     interval,
//     candles: totalCandles,
//     feeRate,
//     slippage,
//     trailing,
//     split,
//     haltResumeDays,
//   } = config;

//   console.log("\n==============================");
//   console.log("        BACKTEST V3");
//   console.log("==============================");

//   console.log(
//     `${symbol} ${interval} | fee ${(feeRate * 100).toFixed(2)}% | slippage ${(slippage * 100).toFixed(2)}% | trailing ${trailing ? "on" : "off"}`,
//   );

//   const candles = await loadCandles(config);

//   if (candles.length < WARMUP + 100) {
//     throw new Error(
//       `Not enough candles (${candles.length}). Need at least ${WARMUP + 100}.`,
//     );
//   }

//   const days = (
//     (candles[candles.length - 1].closeTime - candles[0].openTime) /
//     86400e3
//   ).toFixed(0);

//   console.log(`Candles: ${candles.length} (~${days} days)`);

//   const series = buildSeries(candles);

//   const splitIndex = WARMUP + Math.floor((candles.length - WARMUP) * split);

//   const full = runSegment(candles, series, WARMUP, candles.length, config);

//   const inSample = runSegment(candles, series, WARMUP, splitIndex, config);

//   const outSample = runSegment(
//     candles,
//     series,
//     splitIndex,
//     candles.length,
//     config,
//   );

//   printMetrics("FULL PERIOD", full.metrics, full.buyHold);

//   printMetrics(
//     `IN-SAMPLE (first ${Math.round(split * 100)}%)`,
//     inSample.metrics,
//     inSample.buyHold,
//   );

//   printMetrics(
//     `OUT-OF-SAMPLE (last ${Math.round((1 - split) * 100)}%)`,
//     outSample.metrics,
//     outSample.buyHold,
//   );

//   const haltExits = full.metrics.byReason?.["RISK HALT"] || 0;

//   console.log(
//     `\nRiskGuard (full run): kill switch flattened ${haltExits} position(s)` +
//       (haltResumeDays > 0
//         ? `, auto-resume after ${haltResumeDays}d (backtest only)`
//         : ""),
//   );

//   /*
//    * Save CSV
//    */

//   fs.mkdirSync("data", { recursive: true });

//   const header =
//     "entryTime,exitTime,entryPrice,exitPrice,quantity,reason,grossPnL,fees,netPnL,rMultiple";

//   const rows = full.engine.trades.map((t) =>
//     [
//       new Date(t.entryTime).toISOString(),
//       new Date(t.exitTime).toISOString(),
//       t.entryPrice,
//       t.exitPrice,
//       t.quantity,
//       t.reason,
//       t.grossPnL,
//       t.fees,
//       t.netPnL,
//       t.rMultiple,
//     ].join(","),
//   );

//   const csvPath = path.join(
//     "data",
//     `backtest_trades_${symbol}_${interval}.csv`,
//   );

//   fs.writeFileSync(csvPath, [header, ...rows].join("\n"));

//   console.log(`Trade log: ${csvPath}`);

//   /*
//    * Structured result for API / frontend
//    */

//   return {
//     config: {
//       symbol,
//       interval,
//       candlesRequested: totalCandles,
//       candlesUsed: candles.length,
//       feeRate,
//       slippage,
//       trailing,
//       split,
//       haltResumeDays,
//     },

//     period: {
//       startTime: candles[0].openTime,
//       endTime: candles[candles.length - 1].closeTime,
//       days: Number(days),
//     },

//     full: {
//       metrics: full.metrics,
//       buyHold: full.buyHold,
//       trades: full.engine.trades,
//       equityCurve: full.engine.equityCurve,
//     },

//     inSample: {
//       metrics: inSample.metrics,
//       buyHold: inSample.buyHold,
//       trades: inSample.engine.trades,
//       equityCurve: inSample.engine.equityCurve,
//     },

//     outSample: {
//       metrics: outSample.metrics,
//       buyHold: outSample.buyHold,
//       trades: outSample.engine.trades,
//       equityCurve: outSample.engine.equityCurve,
//     },

//     risk: {
//       haltExits,
//     },

//     csv: csvPath,
//   };
// }

// /*
//  * Keep CLI usage working.
//  *
//  * Example:
//  *
//  * PowerShell:
//  * $env:SYMBOL="ETHUSDT"
//  * $env:INTERVAL="15m"
//  * $env:CANDLES="10000"
//  * node src/backtester.js
//  */

// if (require.main === module) {
//   runBacktest().catch((error) => {
//     console.error("Backtest error:", error.message);
//     process.exitCode = 1;
//   });
// }

// module.exports = {
//   runBacktest,
// };
