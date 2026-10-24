const { buildSeries, snapshotAt, WARMUP } = require("./indicators");

const CONFIG = {
    minScore: 6,
    rsiBuyMin: 50,
    rsiBuyMax: 70,
    rsiSellMax: 45,
    volumeMultiplier: 1.0,
    useRegimeFilter: true, // only buy when the market is actually trending
    adxMin: 20,
};

const MAX_SCORE = 9;

/**
 * Pure decision function: indicator snapshot in, signal out.
 * Used identically by the live bot and the backtester.
 */
function evaluate(ind, prev, candle, config = CONFIG) {
    const base = { signal: "HOLD", score: 0, maxScore: MAX_SCORE, reasons: [], warnings: [], blockers: [], indicators: ind, price: candle.close };

    const needed = [ind?.sma20, ind?.sma50, ind?.sma200, ind?.ema20, ind?.rsi14, ind?.atr14, ind?.adx14];
    if (!ind || needed.some(v => v === null || v === undefined) || !ind.macd) {
        base.reasons.push("Indicators not ready");
        return base;
    }

    let score = 0;
    const reasons = [];
    const warnings = [];
    const blockers = [];

    // Trend
    if (ind.sma20 > ind.sma50) { score += 2; reasons.push("SMA20 > SMA50"); }
    if (ind.sma50 > ind.sma200) { score += 2; reasons.push("SMA50 > SMA200"); }
    else warnings.push("Long-term trend not bullish");
    if (candle.close > ind.ema20) { score += 1; reasons.push("Price > EMA20"); }

    // Momentum
    if (ind.rsi14 >= config.rsiBuyMin && ind.rsi14 <= config.rsiBuyMax) {
        score += 1;
        reasons.push(`RSI healthy (${ind.rsi14.toFixed(1)})`);
    }
    if (ind.macd.macd > ind.macd.signal && ind.macd.histogram > 0) { score += 2; reasons.push("MACD bullish"); }

    // Volume
    if (ind.volumeSMA20 && candle.volume >= ind.volumeSMA20 * config.volumeMultiplier) {
        score += 1;
        reasons.push("Volume confirms");
    }

    // Hard blockers: these veto a BUY no matter the score.
    if (ind.rsi14 > config.rsiBuyMax) blockers.push("RSI overbought");
    if (config.useRegimeFilter && ind.adx14 < config.adxMin) blockers.push(`Ranging market (ADX ${ind.adx14.toFixed(1)})`);

    // Exit logic
    const bearishTrend = ind.sma20 < ind.sma50;
    const bearishMACD = ind.macd.macd < ind.macd.signal;
    const bearishMomentum = ind.rsi14 < config.rsiSellMax;

    let signal = "HOLD";
    if (score >= config.minScore && blockers.length === 0) signal = "BUY";
    else if (bearishTrend && bearishMACD && bearishMomentum) signal = "SELL";

    const bullishCross = !!prev && prev.sma20 !== null && prev.sma20 <= prev.sma50 && ind.sma20 > ind.sma50;
    const bearishCross = !!prev && prev.sma20 !== null && prev.sma20 >= prev.sma50 && ind.sma20 < ind.sma50;
    if (bullishCross) reasons.push("Fresh SMA bullish crossover");
    if (bearishCross) reasons.push("Fresh SMA bearish crossover");

    return { signal, score, maxScore: MAX_SCORE, reasons, warnings: [...warnings, ...blockers], blockers, indicators: ind, price: candle.close, bullishCross, bearishCross };
}

// Evaluate at candle index i using precomputed series (backtest / live replay).
function analysisAt(candles, series, i, config = CONFIG) {
    return evaluate(snapshotAt(series, i), snapshotAt(series, i - 1), candles[i], config);
}

// Evaluate the most recent candle from a raw candle array.
function getStrategyAnalysis(candles, config = CONFIG) {
    if (!candles || candles.length < WARMUP) {
        return { signal: "HOLD", score: 0, maxScore: MAX_SCORE, reasons: ["Not enough candles"], warnings: [], blockers: [], indicators: null };
    }
    const series = buildSeries(candles);
    return analysisAt(candles, series, candles.length - 1, config);
}

const getSignal = candles => getStrategyAnalysis(candles).signal;

module.exports = { CONFIG, MAX_SCORE, evaluate, analysisAt, getStrategyAnalysis, getSignal };
