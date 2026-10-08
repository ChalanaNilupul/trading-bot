const { calculatePosition } = require("./riskManager");

class PaperTrader {
    constructor({ startingBalance = 1000, feeRate = 0.001, riskPercent = 0.01 } = {}) {
        this.startingBalance = startingBalance;
        this.cash = startingBalance;
        this.asset = 0;
        this.entryPrice = null;
        this.entryValue = null;
        this.stopPrice = null;
        this.targetPrice = null;
        this.trades = [];
        this.realizedPnL = 0;
        this.feeRate = feeRate;
        this.riskPercent = riskPercent;
    }

    buy(price, atr) {
        if (this.asset > 0) {
            console.log("Already holding a position.");
            return false;
        }

        const risk = calculatePosition({
            balance: this.cash,
            entryPrice: price,
            atr,
            riskPercent: this.riskPercent,
            atrStopMultiplier: 2,
            rewardRiskRatio: 2,
            maxPositionPercent: 0.25,
        });

        if (!risk) return false;

        const fee = risk.positionValue * this.feeRate;
        if (risk.positionValue + fee > this.cash) return false;

        this.cash -= risk.positionValue + fee;
        this.asset = risk.quantity;
        this.entryPrice = price;
        this.entryValue = risk.positionValue;
        this.stopPrice = risk.stopPrice;
        this.targetPrice = risk.targetPrice;

        console.log("\n🟢 PAPER BUY");
        console.log(`Price:    $${price.toFixed(2)}`);
        console.log(`Position: $${risk.positionValue.toFixed(2)}`);
        console.log(`Risk:     $${risk.actualRisk.toFixed(2)}`);
        console.log(`Stop:     $${risk.stopPrice.toFixed(2)}`);
        console.log(`Target:   $${risk.targetPrice.toFixed(2)}`);
        return true;
    }

    sell(price, reason = "SIGNAL") {
        if (this.asset <= 0) return false;

        const exitValue = this.asset * price;
        const exitFee = exitValue * this.feeRate;
        const entryFee = this.entryValue * this.feeRate;
        const grossPnL = exitValue - this.entryValue;
        const fees = entryFee + exitFee;
        const netPnL = grossPnL - fees;

        this.cash += exitValue - exitFee;
        this.realizedPnL += netPnL;

        this.trades.push({
            entryPrice: this.entryPrice,
            exitPrice: price,
            quantity: this.asset,
            reason,
            grossPnL,
            fees,
            netPnL,
            time: new Date().toISOString(),
        });

        console.log(`\n🔴 PAPER SELL [${reason}]`);
        console.log(`Entry:  $${this.entryPrice.toFixed(2)}`);
        console.log(`Exit:   $${price.toFixed(2)}`);
        console.log(`Net P/L: $${netPnL.toFixed(2)}`);

        this.asset = 0;
        this.entryPrice = null;
        this.entryValue = null;
        this.stopPrice = null;
        this.targetPrice = null;
        return true;
    }

    checkStops(high, low) {
        if (this.asset <= 0) return null;

        if (low <= this.stopPrice) {
            this.sell(this.stopPrice, "STOP LOSS");
            return "STOP LOSS";
        }

        if (high >= this.targetPrice) {
            this.sell(this.targetPrice, "TAKE PROFIT");
            return "TAKE PROFIT";
        }

        return null;
    }

    getBalance(price) {
        return this.cash + this.asset * price;
    }

    getStatus(price) {
        const balance = this.getBalance(price);
        console.log("\n========== PAPER ACCOUNT ==========");
        console.log(`Cash:       $${this.cash.toFixed(2)}`);
        console.log(`Asset:      ${this.asset.toFixed(8)}`);
        console.log(`Balance:    $${balance.toFixed(2)}`);
        console.log(`Total P/L:  $${(balance - this.startingBalance).toFixed(2)}`);
        console.log(`Trades:     ${this.trades.length}`);
        console.log("===================================\n");
    }
}

module.exports = PaperTrader;
