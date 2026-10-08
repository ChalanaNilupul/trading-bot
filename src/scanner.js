const { getCandles, getTopUSDTSymbols } = require("./binance");
const { getStrategyAnalysis } = require("./strategy");

const INTERVAL = process.env.INTERVAL || "15m";
const MAX_SYMBOLS = Number(process.env.MAX_SYMBOLS || 30);
const MIN_QUOTE_VOLUME = Number(process.env.MIN_QUOTE_VOLUME || 20_000_000); // 24h USDT volume
const CONCURRENCY = 4;

async function mapPool(items, worker, size) {
    const results = [];
    for (let i = 0; i < items.length; i += size) {
        const chunk = items.slice(i, i + size);
        results.push(...(await Promise.all(chunk.map(worker))));
    }
    return results;
}

async function scan() {
    console.log("\n==============================");
    console.log("       MARKET SCANNER V3");
    console.log("==============================");

    const symbols = await getTopUSDTSymbols({ limit: MAX_SYMBOLS, minQuoteVolume: MIN_QUOTE_VOLUME });
    console.log(`Scanning ${symbols.length} most liquid USDT pairs on ${INTERVAL}...\n`);

    const results = await mapPool(symbols, async symbol => {
        try {
            const analysis = getStrategyAnalysis(await getCandles(symbol, INTERVAL, 300));
            if (!analysis.indicators) return null;
            return {
                symbol,
                signal: analysis.signal,
                score: analysis.score,
                price: analysis.price,
                rsi: analysis.indicators.rsi14,
                adx: analysis.indicators.adx14,
                blockers: analysis.blockers,
            };
        } catch (error) {
            console.log(`Skipping ${symbol}: ${error.message}`);
            return null;
        }
    }, CONCURRENCY);

    const rank = r => (r.signal === "BUY" ? 100 : 0) + r.score;

    results
        .filter(Boolean)
        .sort((a, b) => rank(b) - rank(a))
        .slice(0, 10)
        .forEach((r, i) => {
            console.log(
                `${String(i + 1).padStart(2)}. ${r.symbol.padEnd(12)} ${r.signal.padEnd(5)} ` +
                `score=${r.score}/9 ADX=${r.adx.toFixed(0).padStart(2)} RSI=${r.rsi.toFixed(0).padStart(3)} ` +
                `price=$${r.price.toFixed(4)}` + (r.blockers.length ? `  [${r.blockers.join(", ")}]` : "")
            );
        });
}

scan().catch(error => console.error("Scanner error:", error.message));
