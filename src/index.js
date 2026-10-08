const { getCandles } = require("./binance");
const { getStrategyAnalysis } = require("./strategy");
const PaperTrader = require("./paperTrader");

const SYMBOL = process.env.SYMBOL || "ETHUSDT";
const INTERVAL = process.env.INTERVAL || "15m";

const trader = new PaperTrader({
    startingBalance: 1000,
    feeRate: 0.001,
    riskPercent: 0.01,
});

async function runBot() {
    try {
        console.log("\n==============================");
        console.log("       PAPER BOT V2");
        console.log("==============================");

        const candles = await getCandles(SYMBOL, INTERVAL, 250);
        if (candles.length < 210) {
            console.log("Not enough candle data.");
            return;
        }

        const latest = candles[candles.length - 1];
        const analysis = getStrategyAnalysis(candles);

        console.log(`Symbol: ${SYMBOL}`);
        console.log(`Interval: ${INTERVAL}`);
        console.log(`Candle: ${new Date(latest.closeTime).toLocaleString()}`);
        console.log(`Price: $${latest.close.toFixed(4)}`);
        console.log(`Signal: ${analysis.signal}`);
        console.log(`Score: ${analysis.score}/${analysis.maxScore}`);
        console.log(`RSI: ${analysis.indicators.rsi14.toFixed(2)}`);
        console.log(`ATR: ${analysis.indicators.atr14.toFixed(4)}`);
        console.log(`SMA20: ${analysis.indicators.sma20.toFixed(4)}`);
        console.log(`SMA50: ${analysis.indicators.sma50.toFixed(4)}`);
        console.log(`SMA200: ${analysis.indicators.sma200.toFixed(4)}`);
        console.log(`Reasons: ${analysis.reasons.join(", ") || "none"}`);
        console.log(`Warnings: ${analysis.warnings?.join(", ") || "none"}`);

        // Check an existing paper position first.
        if (trader.asset > 0) {
            trader.checkStops(latest.high, latest.low);
        }

        if (analysis.signal === "BUY" && trader.asset === 0) {
            trader.buy(latest.close, analysis.indicators.atr14);
        } else if (analysis.signal === "SELL" && trader.asset > 0) {
            trader.sell(latest.close, "SIGNAL");
        }

        trader.getStatus(latest.close);
    } catch (error) {
        console.error("Bot error:", error.message);
    }
}

runBot();
