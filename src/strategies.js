/**
 * Candidate strategies for comparison. Each one is a different IDEA, not a tweak of the same one.
 * Parameters are classic textbook values chosen BEFORE testing and deliberately NOT tuned,
 * so a good result can't be blamed on fitting the past.
 *
 * Interface:
 *   prepare(candles, series)            -> context (precomputed arrays), computed once
 *   analyze(ctx, candles, series, i)    -> { signal: BUY|SELL|HOLD, indicators: { atr14 } }
 * analyze(i) may only use data up to and including candle i.
 */
const { analysisAt } = require("./strategy");

const result = (signal, atr, price) => ({
    signal, score: 0, maxScore: 0, reasons: [], warnings: [], blockers: [],
    indicators: { atr14: atr }, price,
});

function rollingMaxPrior(values, n) {
    const out = new Array(values.length).fill(null);
    for (let i = n; i < values.length; i++) {
        let m = -Infinity;
        for (let j = i - n; j < i; j++) if (values[j] > m) m = values[j];
        out[i] = m;
    }
    return out;
}

function rollingMinPrior(values, n) {
    const out = new Array(values.length).fill(null);
    for (let i = n; i < values.length; i++) {
        let m = Infinity;
        for (let j = i - n; j < i; j++) if (values[j] < m) m = values[j];
        out[i] = m;
    }
    return out;
}

const STRATEGIES = [
    {
        name: "Current (score)",
        description: "Your existing SMA/MACD/RSI scoring strategy (the baseline to beat)",
        engine: {},
        prepare: () => null,
        analyze: (ctx, candles, series, i) => analysisAt(candles, series, i),
    },
    {
        name: "Breakout 50/20",
        description: "Buy a close above the 50-candle high in an uptrend (above SMA200); exit below the 20-candle low. Lets winners run.",
        engine: { rewardRiskRatio: 10, trailing: false },
        prepare: candles => ({
            hh: rollingMaxPrior(candles.map(c => c.high), 50),
            ll: rollingMinPrior(candles.map(c => c.low), 20),
        }),
        analyze: (ctx, candles, series, i) => {
            const atr = series.atr14[i], sma200 = series.sma200[i], c = candles[i].close;
            if (atr == null || sma200 == null || ctx.hh[i] == null) return result("HOLD", atr, c);
            if (c > ctx.hh[i] && c > sma200) return result("BUY", atr, c);
            if (c < ctx.ll[i]) return result("SELL", atr, c);
            return result("HOLD", atr, c);
        },
    },
    {
        name: "Dip buy (RSI)",
        description: "Mean reversion: buy RSI<35 dips while above SMA200; exit when RSI>60 or the uptrend breaks.",
        engine: { rewardRiskRatio: 3, trailing: false },
        prepare: () => null,
        analyze: (ctx, candles, series, i) => {
            const atr = series.atr14[i], sma200 = series.sma200[i], rsi = series.rsi14[i], c = candles[i].close;
            if (atr == null || sma200 == null || rsi == null) return result("HOLD", atr, c);
            if (c > sma200 && rsi < 35) return result("BUY", atr, c);
            if (rsi > 60 || c < sma200) return result("SELL", atr, c);
            return result("HOLD", atr, c);
        },
    },
    {
        name: "EMA pullback",
        description: "In a strong uptrend (EMA20>EMA50>SMA200), buy when price reclaims EMA20 after dipping below; exit below EMA50.",
        engine: { rewardRiskRatio: 3, trailing: true },
        prepare: () => null,
        analyze: (ctx, candles, series, i) => {
            const atr = series.atr14[i], e20 = series.ema20[i], e50 = series.ema50[i], s200 = series.sma200[i];
            const c = candles[i].close;
            if (atr == null || e50 == null || s200 == null || i < 1 || series.ema20[i - 1] == null) return result("HOLD", atr, c);
            const uptrend = e20 > e50 && e50 > s200;
            const reclaimed = candles[i - 1].close <= series.ema20[i - 1] && c > e20;
            if (uptrend && reclaimed) return result("BUY", atr, c);
            if (c < e50) return result("SELL", atr, c);
            return result("HOLD", atr, c);
        },
    },
    {
        name: "Trend filter only",
        description: "Simplest possible: be long while price and SMA50 are above SMA200, otherwise flat. The benchmark that fancier ideas must beat.",
        engine: { rewardRiskRatio: 10, trailing: false },
        prepare: () => null,
        analyze: (ctx, candles, series, i) => {
            const atr = series.atr14[i], s50 = series.sma50[i], s200 = series.sma200[i], c = candles[i].close;
            if (atr == null || s200 == null || s50 == null) return result("HOLD", atr, c);
            if (c > s200 && s50 > s200) return result("BUY", atr, c);
            if (c < s200) return result("SELL", atr, c);
            return result("HOLD", atr, c);
        },
    },
];

module.exports = { STRATEGIES };
