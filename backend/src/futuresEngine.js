const { RiskGuard } = require("./riskGuard");
const { floorToStep } = require("./riskManager");

const DEFAULTS = {
  startingBalance: 1000,
  leverage: 5,
  marginMode: "ISOLATED",
  feeRate: 0.0005, // illustrative taker fee; configure to your account's actual tier
  slippage: 0.0005,
  riskPercent: 0.01,
  atrStopMultiplier: 2,
  rewardRiskRatio: 2,
  maxPositionPercent: 0.25, // maximum initial margin as a share of current equity
  maintenanceMarginRate: 0.005,
  fundingRatePer8h: 0.0001, // configurable estimate; real funding rates vary by symbol/time
  trailing: true,
  allowShort: false, // short entries require explicit opt-in and a SHORT signal
  stepSize: null,
  minQty: 0,
  minNotional: 5,
};

/** Futures paper simulator only: no credentials, signing, or order-placement code. */
class FuturesEngine {
  constructor(opts = {}) {
    const { guard, onEvent, ...cfg } = opts;
    this.cfg = {
      ...DEFAULTS,
      ...cfg,
      leverage: Math.max(
        1,
        Math.min(125, Number(cfg.leverage ?? DEFAULTS.leverage)),
      ),
    };
    this.guard = new RiskGuard(guard);
    this.onEvent = onEvent || (() => {});
    this.cash = this.cfg.startingBalance; // wallet balance / free collateral before reserved margin
    this.position = null;
    this.pending = null;
    this.trades = [];
    this.equityCurve = [];
    this.peak = this.cfg.startingBalance;
    this.maxDrawdown = 0;
    this.lastEquity = this.cfg.startingBalance;
  }

  unrealized(price) {
    if (!this.position || !price) return 0;
    const p = this.position;
    return (price - p.entryPrice) * p.quantity * (p.side === "LONG" ? 1 : -1);
  }
  equity(price) {
    return (
      this.cash +
      (this.position ? this.position.margin : 0) +
      this.unrealized(price)
    );
  }
  usedMargin() {
    return this.position ? this.position.margin : 0;
  }
  freeCollateral(price) {
    return Math.max(0, this.equity(price) - this.usedMargin());
  }

  onCandle(candle, analysis, execution = {}) {
    const immediate = execution.immediate === true;
    if (
      immediate &&
      (!Number.isFinite(execution.executionPrice) ||
        execution.executionPrice <= 0 ||
        !Number.isFinite(execution.executionTime))
    ) {
      throw new Error("Immediate execution requires a valid observed price and time");
    }
    if (this.pending && !execution.deferPending && !immediate)
      this._executePending(candle, candle.open, candle.openTime);
    let liquidated = false;
    if (this.position) {
      this._chargeFunding(candle);
      if (this.position && this._checkLiquidation(candle)) liquidated = true;
      if (this.position) this._checkExits(candle);
    }

    const price = candle.close;
    const equity = this.equity(price);
    this.lastEquity = equity;
    this.equityCurve.push({ time: candle.closeTime, equity });
    this.peak = Math.max(this.peak, equity);
    this.maxDrawdown = Math.max(
      this.maxDrawdown,
      (this.peak - equity) / Math.max(this.peak, 1e-9),
    );
    for (const msg of this.guard.update(equity, candle.closeTime))
      this._emit("GUARD", msg);

    if (analysis && !this.pending && !liquidated) {
      if (this.position?.side === "LONG" && analysis.signal === "SELL")
        this.pending = { type: "CLOSE", reason: "SIGNAL" };
      else if (this.position?.side === "SHORT" && analysis.signal === "BUY")
        this.pending = { type: "CLOSE", reason: "SIGNAL" };
      else if (
        !this.position &&
        (analysis.signal === "BUY" ||
          (analysis.signal === "SHORT" && this.cfg.allowShort))
      ) {
        const gate = this.guard.canOpen(
          immediate ? execution.executionTime : candle.closeTime,
        );
        if (!gate.allowed)
          this._emit(
            "SKIP",
            `${analysis.signal} signal ignored: ${gate.reason}`,
          );
        else
          this.pending = {
            type: analysis.signal === "BUY" ? "OPEN_LONG" : "OPEN_SHORT",
            atr: analysis.indicators?.atr14,
          };
      }
    }
    if (this.position && this.guard.state.halted)
      this.pending = { type: "CLOSE", reason: "RISK HALT" };
    if (immediate && this.pending)
      this._executePending(
        candle,
        execution.executionPrice,
        execution.executionTime,
      );
  }

  _executePending(candle, referencePrice, time) {
    const order = this.pending;
    this.pending = null;
    if (order.type === "OPEN_LONG" && !this.position)
      this._open(candle, "LONG", order.atr, referencePrice, time);
    else if (order.type === "OPEN_SHORT" && !this.position)
      this._open(candle, "SHORT", order.atr, referencePrice, time);
    else if (order.type === "CLOSE" && this.position)
      this._close(
        this._marketFill(
          referencePrice,
          this.position.side === "LONG" ? "SELL" : "BUY",
        ),
        time,
        order.reason,
      );
  }

  _marketFill(price, action) {
    return (
      price * (action === "BUY" ? 1 + this.cfg.slippage : 1 - this.cfg.slippage)
    );
  }

  _open(candle, side, atr, referencePrice = candle.open, executionTime = candle.openTime) {
    const c = this.cfg,
      fill = this._marketFill(referencePrice, side === "LONG" ? "BUY" : "SELL");
    const equity = this.equity(fill);
    const stopDistance = Number(atr) * c.atrStopMultiplier;
    if (
      !(
        equity > 0 &&
        fill > 0 &&
        stopDistance > 0 &&
        Number.isFinite(stopDistance)
      )
    )
      return this._emit(
        "SKIP",
        `${side} entry rejected: invalid ATR/price/equity`,
      );
    const gate = this.guard.canOpen(executionTime);
    if (!gate.allowed)
      return this._emit(
        "SKIP",
        `${side} entry blocked at fill: ${gate.reason}`,
      );

    const riskCash = equity * c.riskPercent * this.guard.riskMultiplier(equity);
    const riskQty = riskCash / stopDistance;
    const marginCap = Math.max(0, equity * c.maxPositionPercent);
    const maxNotionalByMargin =
      Math.max(0, Math.min(this.cash, marginCap)) * c.leverage;
    const maxQtyByMargin = maxNotionalByMargin / fill;
    const quantity = floorToStep(Math.min(riskQty, maxQtyByMargin), c.stepSize);
    const notional = quantity * fill;
    const margin = notional / c.leverage;
    const entryFee = notional * c.feeRate;
    if (
      !(
        quantity >= c.minQty &&
        notional >= c.minNotional &&
        margin + entryFee <= this.cash &&
        quantity > 0
      )
    ) {
      return this._emit(
        "SKIP",
        `${side} entry rejected: insufficient free collateral or below exchange minimum`,
      );
    }
    const stopPrice =
      side === "LONG" ? fill - stopDistance : fill + stopDistance;
    if (stopPrice <= 0)
      return this._emit("SKIP", "Entry rejected: invalid stop price");
    const targetPrice =
      side === "LONG"
        ? fill + stopDistance * c.rewardRiskRatio
        : fill - stopDistance * c.rewardRiskRatio;
    this.cash -= margin + entryFee;
    this.position = {
      side,
      entryTime: executionTime,
      entryPrice: fill,
      quantity,
      notional,
      margin,
      entryFee,
      fundingPaid: 0,
      stopPrice,
      initialStop: stopPrice,
      stopDistance,
      targetPrice,
      extreme: fill,
      leverage: c.leverage,
      liquidationPrice: this._liquidationPrice(side, fill, margin, quantity),
      lastFundingAt: candle.openTime,
    };
    this.guard.recordEntry();
    this._emit(
      "ENTRY",
      `${side} ${quantity} @ ${fill.toFixed(4)} | ${c.leverage}x isolated | margin ${margin.toFixed(2)} USDT | SL ${stopPrice.toFixed(4)} | TP ${targetPrice.toFixed(4)}`,
      { position: { ...this.position } },
    );
  }

  _liquidationPrice(side, entry, margin, qty) {
    // Approximate isolated liquidation: isolated margin + unrealized PnL equals maintenance margin.
    const mmr = this.cfg.maintenanceMarginRate;
    if (side === "LONG")
      return Math.max(0, (entry * qty - margin) / (qty * (1 - mmr)));
    return (entry * qty + margin) / (qty * (1 + mmr));
  }

  _chargeFunding(candle) {
    const p = this.position;
    if (!p) return;
    const interval = 8 * 60 * 60 * 1000;
    const previous = p.lastFundingAt ?? candle.openTime;
    const crossed =
      Math.floor(candle.closeTime / interval) - Math.floor(previous / interval);
    if (crossed > 0) {
      const fee =
        p.notional *
        this.cfg.fundingRatePer8h *
        crossed *
        (p.side === "LONG" ? 1 : -1);
      // Positive configured rate: longs pay, shorts receive. Negative rates reverse this.
      this.cash -= fee;
      p.fundingPaid += fee;
      p.lastFundingAt = candle.closeTime;
      this._emit(
        "FUNDING",
        `${p.side} funding ${fee >= 0 ? "paid" : "received"}: ${Math.abs(fee).toFixed(4)} USDT (${crossed} interval(s); estimated rate)`,
        { funding: fee },
      );
    }
  }

  _checkLiquidation(candle) {
    const p = this.position;
    const liq = p.liquidationPrice;
    const touched = p.side === "LONG" ? candle.low <= liq : candle.high >= liq;
    if (!touched) return false;
    const raw =
      p.side === "LONG"
        ? Math.min(candle.open, liq)
        : Math.max(candle.open, liq);
    this._close(
      this._marketFill(raw, p.side === "LONG" ? "SELL" : "BUY"),
      candle.closeTime,
      "LIQUIDATION",
      true,
    );
    return true;
  }

  _checkExits(candle) {
    const p = this.position;
    const stopHit =
      p.side === "LONG"
        ? candle.low <= p.stopPrice
        : candle.high >= p.stopPrice;
    if (stopHit) {
      const raw =
        p.side === "LONG"
          ? Math.min(candle.open, p.stopPrice)
          : Math.max(candle.open, p.stopPrice);
      this._close(
        this._marketFill(raw, p.side === "LONG" ? "SELL" : "BUY"),
        candle.closeTime,
        p.stopPrice !== p.initialStop ? "TRAILING STOP" : "STOP LOSS",
      );
      return;
    }
    const targetHit =
      p.side === "LONG"
        ? candle.high >= p.targetPrice
        : candle.low <= p.targetPrice;
    if (targetHit) {
      const raw =
        p.side === "LONG"
          ? Math.max(candle.open, p.targetPrice)
          : Math.min(candle.open, p.targetPrice);
      this._close(
        this._marketFill(raw, p.side === "LONG" ? "SELL" : "BUY"),
        candle.closeTime,
        "TAKE PROFIT",
      );
      return;
    }
    p.extreme =
      p.side === "LONG"
        ? Math.max(p.extreme, candle.high)
        : Math.min(p.extreme, candle.low);
    if (
      this.cfg.trailing &&
      (p.side === "LONG"
        ? p.extreme >= p.entryPrice + p.stopDistance
        : p.extreme <= p.entryPrice - p.stopDistance)
    ) {
      const trail =
        p.side === "LONG"
          ? p.extreme - p.stopDistance
          : p.extreme + p.stopDistance;
      if (p.side === "LONG" ? trail > p.stopPrice : trail < p.stopPrice) {
        p.stopPrice = trail;
        this._emit("TRAIL", `Stop moved to ${trail.toFixed(4)}`, {
          stop: trail,
        });
      }
    }
  }

  _close(exitPrice, time, reason, liquidation = false) {
    const p = this.position;
    const exitNotional = p.quantity * exitPrice;
    const exitFee = exitNotional * this.cfg.feeRate;
    const grossPnL =
      (exitPrice - p.entryPrice) * p.quantity * (p.side === "LONG" ? 1 : -1);
    let netPnL = grossPnL - p.entryFee - exitFee - p.fundingPaid;
    // Margin is returned with realized PnL. Isolated liquidation cannot lose more than its reserved margin plus entry fee/funding.
    let returned = p.margin + grossPnL - exitFee;
    if (liquidation) {
      returned = Math.max(0, returned);
      netPnL = returned - p.margin - p.entryFee - p.fundingPaid;
    }
    this.cash += returned;
    const trade = {
      side: p.side,
      entryTime: p.entryTime,
      exitTime: time,
      entryPrice: p.entryPrice,
      exitPrice,
      quantity: p.quantity,
      leverage: p.leverage,
      margin: p.margin,
      reason,
      grossPnL,
      fees: p.entryFee + exitFee,
      funding: p.fundingPaid,
      netPnL,
      rMultiple: netPnL / Math.max(p.stopDistance * p.quantity, 1e-9),
    };
    this.trades.push(trade);
    this.position = null;
    this.guard.recordExit(netPnL, time);
    this._emit(
      "EXIT",
      `${reason}: ${trade.side} exit ${exitPrice.toFixed(4)} | net ${netPnL >= 0 ? "+" : ""}${netPnL.toFixed(2)} USDT (${trade.rMultiple.toFixed(2)}R)`,
      { trade },
    );
  }

  closeAll(price, time, reason = "MANUAL") {
    if (!this.position) return;
    const action = this.position.side === "LONG" ? "SELL" : "BUY";
    this._close(this._marketFill(price, action), time, reason);
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
module.exports = { FuturesEngine, FUTURES_DEFAULTS: DEFAULTS };
