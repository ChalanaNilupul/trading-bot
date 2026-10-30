/**
 * Account-level loss protection. Sizing limits risk PER TRADE; this limits
 * risk across trades. It is time-driven by candle timestamps, so it behaves
 * identically in a backtest and live.
 *
 *  - Daily loss limit      : no new entries for the rest of the UTC day
 *  - Max drawdown breaker  : halts everything (and flattens) until reset manually
 *  - Consecutive losses    : cooldown after N losers in a row
 *  - Max trades per day    : stops overtrading
 *  - Drawdown throttle     : halves position risk once drawdown gets deep
 */
const DEFAULTS = {
  maxDailyLossPct: 0.03,
  maxDrawdownPct: 0.1,
  throttleDrawdownPct: 0.05,
  throttleMultiplier: 0.5,
  maxConsecutiveLosses: 3,
  cooldownMs: 4 * 60 * 60 * 1000,
  maxTradesPerDay: 6,
  haltCooldownMs: null, // null = stay halted until resetHalt() (live default). Backtests may set an auto-resume.
};

class RiskGuard {
  constructor(cfg = {}) {
    this.cfg = { ...DEFAULTS, ...cfg };
    this.state = {
      peakEquity: null,
      dayKey: null,
      dayStartEquity: null,
      dayBlocked: false,
      tradesToday: 0,
      consecutiveLosses: 0,
      cooldownUntil: 0,
      halted: false,
      haltReason: null,
      haltedAt: null,
    };
  }

  /** Call once per candle with current equity. Returns messages for newly triggered limits. */
  update(equity, time) {
    const s = this.state;
    const events = [];

    if (s.peakEquity === null) s.peakEquity = equity;

    const dayKey = new Date(time).toISOString().slice(0, 10);
    if (s.dayKey !== dayKey) {
      s.dayKey = dayKey;
      s.dayStartEquity = equity;
      s.dayBlocked = false;
      s.tradesToday = 0;
    }

    if (
      s.halted &&
      this.cfg.haltCooldownMs &&
      time - s.haltedAt >= this.cfg.haltCooldownMs
    ) {
      this.resetHalt(equity);
      s.dayStartEquity = equity;
      events.push(
        "Kill switch auto-resumed after cooldown (backtest setting).",
      );
    }

    s.peakEquity = Math.max(s.peakEquity, equity);

    const drawdown = (s.peakEquity - equity) / s.peakEquity;
    if (!s.halted && drawdown >= this.cfg.maxDrawdownPct) {
      s.halted = true;
      s.haltedAt = time;
      s.haltReason = `Max drawdown ${(drawdown * 100).toFixed(1)}% reached`;
      events.push(
        `KILL SWITCH: ${s.haltReason}. Trading halted until manual reset.`,
      );
    }

    const dayPnl = (equity - s.dayStartEquity) / s.dayStartEquity;
    if (!s.dayBlocked && dayPnl <= -this.cfg.maxDailyLossPct) {
      s.dayBlocked = true;
      events.push(
        `Daily loss limit hit (${(dayPnl * 100).toFixed(1)}%). No new entries until next UTC day.`,
      );
    }

    return events;
  }

  canOpen(time) {
    const s = this.state;
    if (s.halted) return { allowed: false, reason: s.haltReason };
    if (s.dayBlocked) return { allowed: false, reason: "daily loss limit" };
    if (time < s.cooldownUntil)
      return { allowed: false, reason: "cooldown after consecutive losses" };
    if (s.tradesToday >= this.cfg.maxTradesPerDay)
      return { allowed: false, reason: "max trades per day" };
    return { allowed: true, reason: null };
  }

  /** Multiplier applied to per-trade risk: reduced while in a deep drawdown. */
  riskMultiplier(equity) {
    const s = this.state;
    if (s.peakEquity === null) return 1;
    const drawdown = (s.peakEquity - equity) / s.peakEquity;
    return drawdown >= this.cfg.throttleDrawdownPct
      ? this.cfg.throttleMultiplier
      : 1;
  }

  recordEntry() {
    this.state.tradesToday += 1;
  }

  recordExit(netPnL, time) {
    const s = this.state;
    if (netPnL < 0) {
      s.consecutiveLosses += 1;
      if (s.consecutiveLosses >= this.cfg.maxConsecutiveLosses) {
        s.cooldownUntil = time + this.cfg.cooldownMs;
        s.consecutiveLosses = 0;

        return {
          type: "GUARD",
          message: `Consecutive loss cooldown activated for ${this.cfg.cooldownMs / 3600000} hours.`,
        };
      }
    } else {
      s.consecutiveLosses = 0;
    }
    return null;
  }

  /** Manual resume after the kill switch. Resets the peak so it doesn't re-trigger instantly. */
  resetHalt(currentEquity) {
    this.state.halted = false;
    this.state.haltReason = null;
    this.state.haltedAt = null;
    this.state.peakEquity = currentEquity;
  }

  toJSON() {
    return { ...this.state };
  }

  restore(saved) {
    if (saved) this.state = { ...this.state, ...saved };
  }
}

module.exports = { RiskGuard, DEFAULTS };
