const { getCandles, getUSDTSymbols } = require("./binance");
const { getStrategyAnalysis } = require("./strategy");

const INTERVAL = process.env.INTERVAL || "15m";
const CANDLE_LIMIT = 250;
const MAX_SYMBOLS = Number(process.env.MAX_SYMBOLS || 30);

async function scan() {
    console.log("\n==============================");
    console.log("       MARKET SCANNER V2");
    console.log("==============================");

    const symbols = await getUSDTSymbols();
    const selected = symbols
        .filter(symbol => !symbol.includes("UP") && !symbol.includes("DOWN"))
        .slice(0, MAX_SYMBOLS);

    const results = [];

    for (const symbol of selected) {
        try {
            const candles = await getCandles(symbol, INTERVAL, CANDLE_LIMIT);
            const analysis = getStrategyAnalysis(candles);

            results.push({
                symbol,
                signal: analysis.signal,
                score: analysis.score,
                price: analysis.price,
                rsi: analysis.indicators?.rsi14 ?? null,
            });
        } catch (error) {
            console.log(`Skipping ${symbol}: ${error.message}`);
        }
    }

    results
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .forEach((r, index) => {
            console.log(
                `${String(index + 1).padStart(2)}. ${r.symbol.padEnd(12)} ` +
                `${r.signal.padEnd(5)} score=${r.score}/9 ` +
                `price=$${r.price?.toFixed(4) ?? "-"} ` +
                `RSI=${r.rsi?.toFixed(1) ?? "-"}`
            );
        });
}

scan().catch(error => console.error("Scanner error:", error.message));
