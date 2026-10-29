/**
 * Portfolio-level risk gate for TradeLab V2 PAPER trading.
 *
 * This module does not place orders and does not replace FuturesEngine/RiskGuard.
 * It provides an additional shared gate before any runner opens a new position.
 *
 * Inputs are supplied by the caller so the module remains independent of the
 * existing engine implementation and can be unit-tested in isolation.
 */
const DEFAULTS = Object.freeze({
  maxDailyLossPct: 0.01,       // 1% of portfolio equity at UTC day start
  maxDrawdownPct: 0.05,        // 5% from observed portfolio peak
  maxOpenPositions: 1,
  maxAggregateStopRiskPct: 0.01, // planned stop risk across all positions + candidate
  maxSameDirectionPositions: 1,
});

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function normalizePosition(position) {
  const quantity = Number(position?.quantity);
  const entryPrice = Number(position?.entryPrice);
  const stopPrice = Number(position?.stopPrice);
  const side = String(position?.side || "").toUpperCase();
  const symbol = String(position?.symbol || "").toUpperCase();

  if (!symbol || !["LONG", "SHORT"].includes(side) ||
      !finitePositive(quantity) || !finitePositive(entryPrice) ||
      !finitePositive(stopPrice)) {
    return null;
  }

  // Stop risk is measured in quote currency, before fees/slippage/gaps.
  const stopRisk = quantity * Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(stopRisk)) return null;

  return { symbol, side, quantity, entryPrice, stopPrice, stopRisk };
}

class PortfolioRiskManager {
  constructor(options = {}) {
    this.cfg = { ...DEFAULTS, ...options };
    this.state = {
      utcDay: null,
      dayStartEquity: null,
      peakEquity: null,
      halted: false,
      haltReason: null,
      lastEquity: null,
      updatedAt: null,
    };
  }

  _updateEquityState(equity, timestamp) {
    if (!finitePositive(equity)) {
      return { allowed: false, reason: "invalid portfolio equity" };
    }
    const time = Number(timestamp);
    if (!Number.isFinite(time)) {
      return { allowed: false, reason: "invalid timestamp" };
    }

    const utcDay = new Date(time).toISOString().slice(0, 10);
    if (this.state.utcDay !== utcDay) {
      this.state.utcDay = utcDay;
      this.state.dayStartEquity = equity;
    }
    if (this.state.peakEquity === null) this.state.peakEquity = equity;

    this.state.peakEquity = Math.max(this.state.peakEquity, equity);
    this.state.lastEquity = equity;
    this.state.updatedAt = time;

    const dayStart = this.state.dayStartEquity;
    const peak = this.state.peakEquity;
    const dailyLossPct = dayStart > 0 ? (dayStart - equity) / dayStart : 0;
    const drawdownPct = peak > 0 ? (peak - equity) / peak : 0;

    if (!this.state.halted && dailyLossPct >= this.cfg.maxDailyLossPct) {
      this.state.halted = true;
      this.state.haltReason =
        `Portfolio daily loss limit reached (${(dailyLossPct * 100).toFixed(2)}%)`;
    }
    if (!this.state.halted && drawdownPct >= this.cfg.maxDrawdownPct) {
      this.state.halted = true;
      this.state.haltReason =
        `Portfolio max drawdown reached (${(drawdownPct * 100).toFixed(2)}%)`;
    }

    return {
      allowed: !this.state.halted,
      reason: this.state.haltReason,
      dailyLossPct,
      drawdownPct,
    };
  }

  /**
   * Decide whether a candidate entry may be opened.
   *
   * @param {object} input
   * @param {number} input.equity - combined portfolio equity, not per-symbol balance
   * @param {number} input.timestamp - milliseconds since epoch
   * @param {Array<object>} input.positions - all currently open positions
   * @param {object} input.candidate - {symbol, side, estimatedStopRisk}
   */
  canOpen({ equity, timestamp, positions = [], candidate } = {}) {
    const stateCheck = this._updateEquityState(Number(equity), Number(timestamp));
    if (!stateCheck.allowed) return stateCheck;

    if (!candidate || !candidate.symbol ||
        !["LONG", "SHORT"].includes(String(candidate.side || "").toUpperCase())) {
      return { allowed: false, reason: "invalid candidate" };
    }

    const normalizedPositions = positions.map(normalizePosition);
    if (normalizedPositions.some((position) => position === null)) {
      return { allowed: false, reason: "invalid existing position data; fail-closed" };
    }
    const open = normalizedPositions;
    const symbol = String(candidate.symbol).toUpperCase();
    const side = String(candidate.side).toUpperCase();

    if (open.some((p) => p.symbol === symbol)) {
      return { allowed: false, reason: `${symbol} already has an open position` };
    }
    if (open.length >= this.cfg.maxOpenPositions) {
      return { allowed: false, reason: "portfolio max open positions reached" };
    }

    const sameDirection = open.filter((p) => p.side === side).length;
    if (sameDirection >= this.cfg.maxSameDirectionPositions) {
      return { allowed: false, reason: `portfolio max ${side.toLowerCase()} positions reached` };
    }

    const candidateRisk = Number(candidate.estimatedStopRisk);
    if (!Number.isFinite(candidateRisk) || candidateRisk < 0) {
      return { allowed: false, reason: "invalid candidate stop risk estimate" };
    }

    const existingRisk = open.reduce((sum, p) => sum + p.stopRisk, 0);
    const totalRiskPct = (existingRisk + candidateRisk) / Number(equity);
    if (totalRiskPct > this.cfg.maxAggregateStopRiskPct) {
      return {
        allowed: false,
        reason: `aggregate stop risk ${(totalRiskPct * 100).toFixed(2)}% exceeds limit`,
        totalRiskPct,
      };
    }

    return {
      allowed: true,
      reason: null,
      totalRiskPct,
      dailyLossPct: stateCheck.dailyLossPct,
      drawdownPct: stateCheck.drawdownPct,
    };
  }

  /**
   * Emergency halt. This intentionally does not automatically resume at midnight.
   */
  halt(reason = "manual portfolio halt") {
    this.state.halted = true;
    this.state.haltReason = String(reason);
  }

  /**
   * Manual reset only after a human reviews the cause.
   * Pass the verified combined portfolio equity.
   */
  reset({ equity, timestamp } = {}) {
    if (!finitePositive(Number(equity)) || !Number.isFinite(Number(timestamp))) {
      throw new Error("reset requires a valid combined equity and timestamp");
    }
    const time = Number(timestamp);
    this.state = {
      utcDay: new Date(time).toISOString().slice(0, 10),
      dayStartEquity: Number(equity),
      peakEquity: Number(equity),
      halted: false,
      haltReason: null,
      lastEquity: Number(equity),
      updatedAt: time,
    };
    return this.snapshot();
  }

  snapshot() {
    return {
      ...this.state,
      cfg: { ...this.cfg },
    };
  }

  restore(saved = {}) {
    if (!saved || typeof saved !== "object") return;
    const allowedKeys = [
      "utcDay", "dayStartEquity", "peakEquity", "halted",
      "haltReason", "lastEquity", "updatedAt",
    ];
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(saved, key)) {
        this.state[key] = saved[key];
      }
    }
  }
}

module.exports = { PortfolioRiskManager, PORTFOLIO_RISK_DEFAULTS: DEFAULTS };
