const fs = require("fs");
const path = require("path");

const {
  getFuturesHistoricalCandles,
  getFuturesSymbolFilters,
} = require("./binance");

const { STRATEGIES, BREAKOUT_VARIANTS } = require("./strategies");
const { runFuturesBacktest } = require("./futuresBacktester");

const list = (value, fallback) =>
  (value || fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const { normalizeDirection } = require("./direction");
const DIRECTION = normalizeDirection(process.env.DIRECTION || "LONG");
const COINS = list(process.env.BOT_SYMBOL || process.env.COINS, "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT");

const TIMEFRAMES = list(process.env.TIMEFRAMES, "1h,4h");

const CANDLES = Math.max(
  500,
  Math.min(20000, Math.floor(Number(process.env.CANDLES || 5000))),
);

const START_BALANCE = Number(process.env.START_BALANCE || 1000);
const LEVERAGE = Number(process.env.LEVERAGE || 5);
const SPLIT = Number(process.env.SPLIT || 0.7);

const STRATEGY_LIST = [
  ...new Map(
    [...STRATEGIES, ...BREAKOUT_VARIANTS].map((strategy) => [
      strategy.name,
      strategy,
    ]),
  ).values(),
];

const csvValue = (value) => {
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (value == null || Number.isNaN(value)) return "";
  if (typeof value === "string") {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const csvLine = (values) => values.map(csvValue).join(",");

const average = (values) => {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
};

const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;

  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

async function main() {
  console.log("\n==================================");
  console.log("       FUTURES TOURNAMENT");
  console.log("==================================");
  console.log(`Coins: ${COINS.join(", ")} | Direction: ${DIRECTION}`);
  console.log(`Timeframes: ${TIMEFRAMES.join(", ")}`);
  console.log(`Strategies: ${STRATEGY_LIST.length}`);
  console.log(`Candles: ${CANDLES} | Balance: ${START_BALANCE}`);
  console.log(`Leverage: ${LEVERAGE}x | IS/OOS split: ${SPLIT}/${1 - SPLIT}`);
  console.log("Historical backtests only. No live orders.\n");

  const details = [];
  const groups = new Map();
  const failures = [];

  for (const timeframe of TIMEFRAMES) {
    for (const coin of COINS) {
      let candles;
      let filters;

      // Download once per coin/timeframe, not once per strategy.
      try {
        console.log(`Loading ${coin} ${timeframe}...`);

        candles = await getFuturesHistoricalCandles(coin, timeframe, CANDLES);

        if (!Array.isArray(candles) || candles.length < 300) {
          throw new Error(
            `Insufficient candle history: ${candles?.length || 0}`,
          );
        }

        filters = await getFuturesSymbolFilters(coin).catch(() => ({}));
      } catch (error) {
        const reason = `${coin} ${timeframe}: ${error.message}`;
        console.error(`SKIPPED: ${reason}`);
        failures.push(reason);
        continue;
      }

      for (const strategy of STRATEGY_LIST) {
        for (const trailing of [true, false]) {
          const trailingMode = trailing ? "ON" : "OFF";
          const label = `${strategy.name} | ${coin} | ${timeframe} | TRAILING ${trailingMode}`;

          try {
            const result = await runFuturesBacktest({
              symbol: coin,
              interval: timeframe,
              candles: CANDLES,
              candlesData: candles,
              filters,
              strategy: strategy.name,
              startingBalance: START_BALANCE,
              leverage: LEVERAGE,
              split: SPLIT,
              direction: DIRECTION,
              trailing,
            });

            const m = result.outSample.metrics;
            const trades = result.outSample.trades || [];

            const oosLiquidations = trades.filter(
              (trade) => trade.reason === "LIQUIDATION",
            ).length;

            const row = {
              trailingMode,
              direction: DIRECTION,
              strategy: strategy.name,
              coin,
              timeframe,
              candles: result.config.candlesUsed,
              isTrades: result.inSample.metrics.trades,
              isPF: result.inSample.metrics.profitFactor,
              oosTrades: m.trades,
              oosWinRate: m.winRate,
              oosPF: m.profitFactor,
              oosReturnPct: m.returnPct,
              oosMaxDDPct: m.maxDrawdownPct,
              oosFunding: m.funding,
              oosLiquidations,
              oosBuyHoldPct: result.outSample.buyHold,
            };

            details.push(row);

            const key = `${trailingMode}::${timeframe}::${strategy.name}`;

            if (!groups.has(key)) {
              groups.set(key, {
                trailingMode,
                timeframe,
                strategy: strategy.name,
                rows: [],
              });
            }

            groups.get(key).rows.push(row);

            console.log(
              `  ${label}: return ${Number(m.returnPct).toFixed(2)}%` +
                ` | PF ${m.profitFactor === Infinity ? "inf" : Number(m.profitFactor).toFixed(2)}` +
                ` | trades ${m.trades}`,
            );
          } catch (error) {
            const reason = `${label}: ${error.message}`;
            console.error(`  FAILED: ${reason}`);
            failures.push(reason);
          }
        }
      }
    }

    fs.mkdirSync("data", { recursive: true });

    const detailColumns = [
      "direction",
      "trailingMode",
      "strategy",
      "coin",
      "timeframe",
      "candles",
      "isTrades",
      "isPF",
      "oosTrades",
      "oosWinRate",
      "oosPF",
      "oosReturnPct",
      "oosMaxDDPct",
      "oosFunding",
      "oosLiquidations",
      "oosBuyHoldPct",
    ];

    for (const mode of ["ON", "OFF"]) {
      const modeDetails = details.filter((row) => row.trailingMode === mode);

      const detailCsv = [
        detailColumns.join(","),
        ...modeDetails.map((row) =>
          csvLine(detailColumns.map((column) => row[column])),
        ),
      ];

      fs.writeFileSync(
        path.join(
          "data",
          `futures_tournament_details_${DIRECTION.toLowerCase()}_trailing_${mode.toLowerCase()}.csv`,
        ),
        detailCsv.join("\n"),
      );

      const summaries = [...groups.values()]
        .filter((group) => group.trailingMode === mode)
        .map((group) => {
          const rows = group.rows;
          const returns = rows.map((r) => r.oosReturnPct);
          const finitePFs = rows.map((r) => r.oosPF).filter(Number.isFinite);

          return {
            timeframe: group.timeframe,
            strategy: group.strategy,
            coinsTested: rows.length,
            profitableCoins: rows.filter((r) => r.oosReturnPct > 0).length,
            avgReturnPct: average(returns),
            medianReturnPct: median(returns),
            avgPF: average(finitePFs),
            infinitePFCount: rows.filter((r) => r.oosPF === Infinity).length,
            avgMaxDDPct: average(rows.map((r) => r.oosMaxDDPct)),
            totalOosTrades: rows.reduce((sum, r) => sum + r.oosTrades, 0),
            totalLiquidations: rows.reduce(
              (sum, r) => sum + r.oosLiquidations,
              0,
            ),
            avgBuyHoldPct: average(rows.map((r) => r.oosBuyHoldPct)),
          };
        });

      summaries.sort(
        (a, b) => (b.avgReturnPct ?? -Infinity) - (a.avgReturnPct ?? -Infinity),
      );

      const summaryColumns = [
        "rank",
        "strategy",
        "timeframe",
        "coinsTested",
        "profitableCoins",
        "avgReturnPct",
        "medianReturnPct",
        "avgPF",
        "infinitePFCount",
        "avgMaxDDPct",
        "totalOosTrades",
        "totalLiquidations",
        "avgBuyHoldPct",
      ];

      const summaryCsv = [
        summaryColumns.join(","),
        ...summaries.map((row, index) =>
          csvLine(
            summaryColumns.map((column) =>
              column === "rank" ? index + 1 : row[column],
            ),
          ),
        ),
      ];

      fs.writeFileSync(
        path.join(
          "data",
          `futures_tournament_ranked_${DIRECTION.toLowerCase()}_trailing_${mode.toLowerCase()}.csv`,
        ),
        summaryCsv.join("\n"),
      );

      console.log(`\nTop 10 strategies — trailing ${mode}:`);

      summaries.slice(0, 10).forEach((row, index) => {
        console.log(
          `${index + 1}. ${row.strategy} @ ${row.timeframe}` +
            ` | avg return ${row.avgReturnPct?.toFixed(2) ?? "N/A"}%` +
            ` | median ${row.medianReturnPct?.toFixed(2) ?? "N/A"}%` +
            ` | PF ${row.avgPF?.toFixed(2) ?? "N/A"}` +
            ` | profitable coins ${row.profitableCoins}/${row.coinsTested}` +
            ` | avg DD ${row.avgMaxDDPct?.toFixed(2) ?? "N/A"}%`,
        );
      });
    }
  }
}

main().catch((error) => {
  console.error("Tournament error:", error);
  process.exitCode = 1;
});

