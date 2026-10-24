const { calculatePosition } = require("./riskManager");
const { RiskGuard } = require("./riskGuard");

const DEFAULTS = {
    startingBalance: 1000,
    feeRate: 0.001,
    slippage: 0.0005,          // applied against you on market fills (entry, stop, signal exit)
    riskPercent: 0.01,
    atrStopMultiplier: 2,
    rewardRiskRatio: 2,
    maxPositionPercent: 0.5,
    minRewardToCost: 3,
    trailing: true,            // once +1R, trail the stop 1R below the highest price (break-even first)
    keepEquityCurve: true,
    stepSize: null,
    minNotional: 0,
};

/**
 * One execution model for backtest AND live paper trading.
 *
 * Per closed candle:
 *   1. fill orders queued on the previous candle's close at THIS candle's open
 *   2. check stop / target against this candle's range (stop wins if both are touched)
 *   3. mark equity, update the RiskGuard
 *   4. read the new signal and queue an order for the NEXT open (no lookahead)
 */
class Engine {
    constructor(opts = {}) {
        const { guard, onEvent, ...cfg } = opts;
        this.cfg = { ...DEFAULTS, ...cfg };
        this.guard = new RiskGuard(guard);
        this.onEvent = onEvent || (() => {});

        this.cash = this.cfg.startingBalance;
        this.position = null;
        this.pending = null;
        this.trades = [];
        this.equityCurve = [];
        this.peak = this.cfg.startingBalance;
        this.maxDrawdown = 0;
        this.lastEquity = this.cfg.startingBalance;
        this._lastSkip = null;
    }

    equity(price) {
        return this.cash + (this.position ? this.position.quantity * price : 0);
    }

    onCandle(candle, analysis) {
        // 1. Fill queued orders at the open.
        if (this.pending) {
            const order = this.pending;
            this.pending = null;
            if (order.type === "BUY" && !this.position) this._open(candle, order);
            else if (order.type === "SELL" && this.position) {
                this._close(candle.open * (1 - this.cfg.slippage), candle.openTime, order.reason);
            }
        }

        // 2. Stops and targets.
        if (this.position) this._checkExits(candle);

        // 3. Mark to market.
        const equity = this.equity(candle.close);
        this.lastEquity = equity;
        if (this.cfg.keepEquityCurve) this.equityCurve.push({ time: candle.closeTime, equity });
        this.peak = Math.max(this.peak, equity);
        this.maxDrawdown = Math.max(this.maxDrawdown, (this.peak - equity) / this.peak);
        for (const msg of this.guard.update(equity, candle.closeTime)) this._emit("GUARD", msg);

        // 4. Decide.
        if (analysis) {
            if (analysis.signal !== "BUY") this._lastSkip = null;

            if (!this.position && !this.pending && analysis.signal === "BUY") {
                const gate = this.guard.canOpen(candle.closeTime);
                if (gate.allowed) {
                    this.pending = { type: "BUY", atr: analysis.indicators.atr14 };
                } else if (this._lastSkip !== gate.reason) {
                    this._lastSkip = gate.reason;
                    this._emit("SKIP", `BUY signal ignored: ${gate.reason}`);
                }
            } else if (this.position && !this.pending && analysis.signal === "SELL") {
                this.pending = { type: "SELL", reason: "SIGNAL" };
            }
        }

        // Kill switch overrides everything: flatten at the next open.
        if (this.position && this.guard.state.halted) {
            this.pending = { type: "SELL", reason: "RISK HALT" };
        }
    }

    _open(candle, order) {
        const c = this.cfg;
        const gate = this.guard.canOpen(candle.openTime);
        if (!gate.allowed) {
            this._emit("SKIP", `Entry blocked at fill: ${gate.reason}`);
            return;
        }

        const fill = candle.open * (1 + c.slippage);
        const size = calculatePosition({
            balance: this.cash,
            entryPrice: fill,
            atr: order.atr,
            riskPercent: c.riskPercent,
            riskMultiplier: this.guard.riskMultiplier(this.cash),
            atrStopMultiplier: c.atrStopMultiplier,
            rewardRiskRatio: c.rewardRiskRatio,
            maxPositionPercent: c.maxPositionPercent,
            feeRate: c.feeRate,
            slippage: c.slippage,
            minRewardToCost: c.minRewardToCost,
            stepSize: c.stepSize,
            minNotional: c.minNotional,
        });

        if (!size) {
            this._emit("SKIP", "Entry rejected by risk manager (size too small or costs too high vs. target)");
            return;
        }

        const entryFee = size.positionValue * c.feeRate;
        this.cash -= size.positionValue + entryFee;
        this.guard.recordEntry();

        this.position = {
            entryTime: candle.openTime,
            entryPrice: fill,
            quantity: size.quantity,
            entryValue: size.positionValue,
            entryFee,
            stopPrice: size.stopPrice,
            initialStop: size.stopPrice,
            stopDistance: size.stopDistance,
            targetPrice: size.targetPrice,
            highest: fill,
        };

        this._emit("ENTRY", `BUY ${size.quantity} @ ${fill.toFixed(4)} | SL ${size.stopPrice.toFixed(4)} | TP ${size.targetPrice.toFixed(4)} | risk ${size.effectiveRiskPct.toFixed(2)}%${size.cappedByCapital ? " (size-capped)" : ""}`, { position: this.position });
    }

    _checkExits(candle) {
        const pos = this.position;
        const slip = this.cfg.slippage;

        // Stop first: if both levels sit inside one candle we can't know the order, so assume the worst.
        if (candle.low <= pos.stopPrice) {
            const raw = Math.min(candle.open, pos.stopPrice); // gap through the stop fills at the open
            const reason = pos.stopPrice > pos.initialStop ? "TRAILING STOP" : "STOP LOSS";
            this._close(raw * (1 - slip), candle.closeTime, reason);
            return;
        }

        if (candle.high >= pos.targetPrice) {
            const raw = Math.max(candle.open, pos.targetPrice); // limit order: no slippage
            this._close(raw, candle.closeTime, "TAKE PROFIT");
            return;
        }

        // Survived the candle: ratchet the stop for the NEXT candle.
        pos.highest = Math.max(pos.highest, candle.high);
        if (this.cfg.trailing && pos.highest >= pos.entryPrice + pos.stopDistance) {
            const trail = pos.highest - pos.stopDistance;
            if (trail > pos.stopPrice) {
                pos.stopPrice = trail;
                this._emit("TRAIL", `Stop raised to ${trail.toFixed(4)}`, { stop: trail });
            }
        }
    }

    _close(exitPrice, time, reason) {
        const pos = this.position;
        const exitValue = pos.quantity * exitPrice;
        const exitFee = exitValue * this.cfg.feeRate;
        const fees = pos.entryFee + exitFee;
        const grossPnL = exitValue - pos.entryValue;
        const netPnL = grossPnL - fees;

        this.cash += exitValue - exitFee;

        const trade = {
            entryTime: pos.entryTime,
            exitTime: time,
            entryPrice: pos.entryPrice,
            exitPrice,
            quantity: pos.quantity,
            reason,
            grossPnL,
            fees,
            netPnL,
            rMultiple: netPnL / (pos.stopDistance * pos.quantity),
        };

        this.trades.push(trade);
        this.position = null;
        this.guard.recordExit(netPnL, time);
        this._emit("EXIT", `${reason}: exit ${exitPrice.toFixed(4)} | net ${netPnL >= 0 ? "+" : ""}${netPnL.toFixed(2)} (${trade.rMultiple.toFixed(2)}R)`, { trade });
    }

    /** Force-close (end of backtest, manual flatten). */
    closeAll(price, time, reason = "MANUAL") {
        if (!this.position) return;
        this.pending = null;
        this._close(price * (1 - this.cfg.slippage), time, reason);
        this.lastEquity = this.cash;
        if (this.cfg.keepEquityCurve && this.equityCurve.length) {
            this.equityCurve[this.equityCurve.length - 1].equity = this.cash;
        }
    }

    _emit(type, message, data = {}) {
        this.onEvent({ type, message, ...data });
    }

    toJSON() {
        return {
            cash: this.cash,
            position: this.position,
            pending: this.pending,
            trades: this.trades,
            peak: this.peak,
            maxDrawdown: this.maxDrawdown,
            guard: this.guard.toJSON(),
        };
    }

    restore(saved) {
        if (!saved) return;
        this.cash = saved.cash ?? this.cash;
        this.position = saved.position ?? null;
        this.pending = saved.pending ?? null;
        this.trades = saved.trades ?? [];
        this.peak = saved.peak ?? this.peak;
        this.maxDrawdown = saved.maxDrawdown ?? 0;
        this.guard.restore(saved.guard);
    }
}

module.exports = { Engine, DEFAULTS };
