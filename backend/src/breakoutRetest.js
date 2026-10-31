const { multiTimeframeStrategy, TREND_MS } = require('./multiTimeframe');
const RETEST_NAME = '4h trend + 15m breakout retest';
const RETEST_BARS = 4;

// Fixed research hypothesis. No position, wallet, AI or future-price input.
const breakoutRetestStrategy = {
  ...multiTimeframeStrategy,
  name: RETEST_NAME,
  description: 'Experimental LONG: existing 4h trend filter; breakout above prior 40-bar high, then a retest/close above that frozen level within the next four 15m candles. Existing channel-20 exit and ATR stop.',
  prepare(candles, series, options = {}) {
    const ctx = multiTimeframeStrategy.prepare(candles, series, options);
    const retestAnalysis = [];
    let pending = null;
    for (let i = 0; i < candles.length; i++) {
      const base = multiTimeframeStrategy.analyze(ctx, candles, series, i);
      const c = candles[i], indicators = base.indicators;
      const ready = indicators.trendCloseTime === Math.floor((c.closeTime + 1) / TREND_MS) * TREND_MS - 1
        && indicators.trendSMA200 != null && indicators.trendSMA50 != null
        && Number.isFinite(indicators.atr14) && indicators.atr14 > 0
        && indicators.entryHigh != null && indicators.exitLow != null;
      let signal = 'HOLD', reason = 'Waiting for a breakout to arm a retest', state = 'IDLE';
      let level = pending?.level ?? null, breakoutTime = pending?.time ?? null;
      if (!ready || base.signal === 'SELL') {
        signal = base.signal;
        reason = base.reasons[0];
        state = pending ? 'CANCELLED' : 'IDLE';
        pending = null;
      } else if (pending) {
        const age = i - pending.index;
        if (c.close < pending.level) {
          reason = 'Retest cancelled: 15m close below the frozen breakout level';
          state = 'CANCELLED'; pending = null;
        } else if (age >= 1 && age <= RETEST_BARS && c.low <= pending.level && c.close > pending.level) {
          signal = 'BUY'; reason = 'Retest confirmed: later 15m candle touched the breakout level and closed above it';
          state = 'CONFIRMED'; pending = null;
        } else if (age >= RETEST_BARS) {
          reason = 'Retest expired after four completed 15m candles';
          state = 'EXPIRED'; pending = null;
        } else {
          reason = `Waiting for breakout retest (${age}/${RETEST_BARS} candles)`;
          state = 'WAITING';
        }
      } else if (base.signal === 'BUY') {
        pending = { index: i, level: indicators.entryHigh, time: c.closeTime };
        level = pending.level; breakoutTime = pending.time;
        reason = 'Breakout armed: wait for a later candle to retest the frozen level';
        state = 'ARMED';
      }
      retestAnalysis.push({ ...base, signal, reasons: [reason],
        indicators: { ...indicators, retestState: state, retestLevel: level, breakoutTime, retestWindowBars: RETEST_BARS } });
    }
    return { ...ctx, retestAnalysis };
  },
  analyze(ctx, _candles, _series, i) { return ctx.retestAnalysis[i]; },
};
module.exports = { RETEST_NAME, RETEST_BARS, breakoutRetestStrategy };
