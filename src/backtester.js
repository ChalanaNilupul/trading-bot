const { getHistoricalCandles } = require("./binance");
const { getStrategyAnalysis } = require("./strategy");
const { calculatePosition } = require("./riskManager");

const SYMBOL = process.env.SYMBOL || "BTCUSDT";
const INTERVAL = process.env.INTERVAL || "1m";
const TOTAL_CANDLES = Number(process.env.CANDLES || 10000);

const STARTING_BALANCE = 1000;
const FEE_RATE = 0.001;
const RISK_PERCENT = 0.01;
const ATR_STOP_MULTIPLIER = 2;
const REWARD_RISK_RATIO = 2;
const MAX_POSITION_PERCENT = 0.25;

async function runBacktest() {
    console.log("\n==============================");
    console.log("        BACKTEST V2");
    console.log("==============================");
    console.log(`Symbol: ${SYMBOL}`);
    console.log(`Interval: ${INTERVAL}`);

    const candles = await getHistoricalCandles(SYMBOL, INTERVAL, TOTAL_CANDLES);

    if (candles.length < 250) {
        console.log("Not enough candle data.");
        return;
    }

    let cash = STARTING_BALANCE;
    let position = null;
    const trades = [];

    let peakBalance = STARTING_BALANCE;
    let maxDrawdown = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let totalFees = 0;

    // Start only after enough history exists for SMA200.
    for (let i = 210; i < candles.length; i++) {
        const candle = candles[i];
        const history = candles.slice(0, i + 1);

        // Manage an existing position before looking for a new entry.
        if (position) {
            let exitPrice = null;
            let exitReason = null;

            // Conservative assumption: if both stop and target occur in one candle,
            // assume stop was hit first because intrabar order is unknown.
            if (candle.low <= position.stopPrice) {
                exitPrice = position.stopPrice;
                exitReason = "STOP LOSS";
            } else if (candle.high >= position.targetPrice) {
                exitPrice = position.targetPrice;
                exitReason = "TAKE PROFIT";
            } else {
                const analysis = getStrategyAnalysis(history);
                if (analysis.signal === "SELL") {
                    exitPrice = candle.close;
                    exitReason = "SIGNAL";
                }
            }

            if (exitPrice !== null) {
                const exitValue = position.quantity * exitPrice;
                const exitFee = exitValue * FEE_RATE;
                const grossPnL = exitValue - position.entryValue;
                const fees = position.entryFee + exitFee;
                const netPnL = grossPnL - fees;

                cash += exitValue - exitFee;
                totalFees += exitFee;

                if (netPnL >= 0) grossProfit += netPnL;
                else grossLoss += Math.abs(netPnL);

                trades.push({
                    entryTime: new Date(position.entryTime).toISOString(),
                    exitTime: new Date(candle.closeTime).toISOString(),
                    entryPrice: position.entryPrice,
                    exitPrice,
                    quantity: position.quantity,
                    reason: exitReason,
                    grossPnL,
                    fees,
                    netPnL,
                });

                console.log(`${exitReason.padEnd(11)} $${exitPrice.toFixed(2)} | P/L: $${netPnL.toFixed(2)}`);

                position = null;
            }
        }

        // New entry only if flat.
        if (!position) {
            const analysis = getStrategyAnalysis(history);

            if (analysis.signal === "BUY") {
                const risk = calculatePosition({
                    balance: cash,
                    entryPrice: candle.close,
                    atr: analysis.indicators.atr14,
                    riskPercent: RISK_PERCENT,
                    atrStopMultiplier: ATR_STOP_MULTIPLIER,
                    rewardRiskRatio: REWARD_RISK_RATIO,
                    maxPositionPercent: MAX_POSITION_PERCENT,
                });

                if (risk && risk.positionValue + risk.positionValue * FEE_RATE <= cash) {
                    const entryFee = risk.positionValue * FEE_RATE;
                    cash -= risk.positionValue + entryFee;
                    totalFees += entryFee;

                    position = {
                        entryTime: candle.closeTime,
                        entryPrice: candle.close,
                        entryValue: risk.positionValue,
                        quantity: risk.quantity,
                        entryFee,
                        stopPrice: risk.stopPrice,
                        targetPrice: risk.targetPrice,
                    };

                    console.log(
                        `BUY         $${candle.close.toFixed(2)} | ` +
                        `Size: $${risk.positionValue.toFixed(2)} | ` +
                        `SL: $${risk.stopPrice.toFixed(2)} | ` +
                        `TP: $${risk.targetPrice.toFixed(2)} | ` +
                        `Score: ${analysis.score}/${analysis.maxScore}`
                    );
                }
            }
        }

        const accountValue = position
            ? cash + position.quantity * candle.close
            : cash;

        peakBalance = Math.max(peakBalance, accountValue);
        const drawdown = ((peakBalance - accountValue) / peakBalance) * 100;
        maxDrawdown = Math.max(maxDrawdown, drawdown);
    }

    // Close any remaining position at the final close.
    if (position) {
        const finalCandle = candles[candles.length - 1];
        const exitPrice = finalCandle.close;
        const exitValue = position.quantity * exitPrice;
        const exitFee = exitValue * FEE_RATE;
        const grossPnL = exitValue - position.entryValue;
        const fees = position.entryFee + exitFee;
        const netPnL = grossPnL - fees;

        cash += exitValue - exitFee;
        totalFees += exitFee;

        if (netPnL >= 0) grossProfit += netPnL;
        else grossLoss += Math.abs(netPnL);

        trades.push({
            entryTime: new Date(position.entryTime).toISOString(),
            exitTime: new Date(finalCandle.closeTime).toISOString(),
            entryPrice: position.entryPrice,
            exitPrice,
            quantity: position.quantity,
            reason: "END OF TEST",
            grossPnL,
            fees,
            netPnL,
        });
    }

    const finalBalance = cash;
    const totalPnL = finalBalance - STARTING_BALANCE;
    const winners = trades.filter(t => t.netPnL > 0);
    const losers = trades.filter(t => t.netPnL < 0);
    const winRate = trades.length ? (winners.length / trades.length) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const expectancy = trades.length ? trades.reduce((sum, t) => sum + t.netPnL, 0) / trades.length : 0;

    console.log("\n==============================");
    console.log("       BACKTEST RESULTS");
    console.log("==============================");
    console.log(`Starting balance: $${STARTING_BALANCE.toFixed(2)}`);
    console.log(`Final balance:    $${finalBalance.toFixed(2)}`);
    console.log(`Total P/L:        $${totalPnL.toFixed(2)}`);
    console.log(`Return:           ${((totalPnL / STARTING_BALANCE) * 100).toFixed(2)}%`);
    console.log(`Trades:           ${trades.length}`);
    console.log(`Winning trades:   ${winners.length}`);
    console.log(`Losing trades:    ${losers.length}`);
    console.log(`Win rate:         ${winRate.toFixed(2)}%`);
    console.log(`Profit factor:    ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}`);
    console.log(`Expectancy/trade: $${expectancy.toFixed(2)}`);
    console.log(`Total fees:       $${totalFees.toFixed(2)}`);
    console.log(`Max drawdown:     ${maxDrawdown.toFixed(2)}%`);
    console.log("==============================\n");
}

runBacktest().catch(error => {
    console.error("Backtest error:", error.message);
});
