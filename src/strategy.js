const { calculateIndicators } = require("./indicators");

const CONFIG = {
    minScore: 6,
    rsiBuyMin: 50,
    rsiBuyMax: 70,
    rsiSellMax: 45,
    volumeMultiplier: 1.0,
};

function getStrategyAnalysis(candles, config = CONFIG) {
    if (!candles || candles.length < 210) {
        return {
            signal: "HOLD",
            score: 0,
            reasons: ["Not enough candles"],
            indicators: null,
        };
    }

    const indicators = calculateIndicators(candles);
    const previousIndicators = calculateIndicators(candles.slice(0, -1));
    const price = candles[candles.length - 1].close;

    let score = 0;
    const reasons = [];
    const warnings = [];

    // Trend: strong bullish structure.
    if (indicators.sma20 > indicators.sma50) {
        score += 2;
        reasons.push("SMA20 > SMA50");
    }

    if (indicators.sma50 > indicators.sma200) {
        score += 2;
        reasons.push("SMA50 > SMA200");
    } else {
        warnings.push("Long-term trend not bullish");
    }

    if (price > indicators.ema20) {
        score += 1;
        reasons.push("Price > EMA20");
    }

    // Momentum.
    if (indicators.rsi14 >= config.rsiBuyMin && indicators.rsi14 <= config.rsiBuyMax) {
        score += 1;
        reasons.push(`RSI healthy (${indicators.rsi14.toFixed(1)})`);
    }

    // MACD confirmation.
    if (indicators.macd && indicators.macd.macd > indicators.macd.signal && indicators.macd.histogram > 0) {
        score += 2;
        reasons.push("MACD bullish");
    }

    // Volume confirmation.
    if (indicators.volumeSMA20 && candles[candles.length - 1].volume >= indicators.volumeSMA20 * config.volumeMultiplier) {
        score += 1;
        reasons.push("Volume confirms");
    }

    // Avoid buying an extremely overextended move.
    if (indicators.rsi14 > 70) {
        warnings.push("RSI overbought");
    }

    // Sell logic is intentionally conservative.
    const bearishTrend = indicators.sma20 < indicators.sma50;
    const bearishMACD = indicators.macd && indicators.macd.macd < indicators.macd.signal;
    const bearishMomentum = indicators.rsi14 < config.rsiSellMax;

    let signal = "HOLD";

    if (score >= config.minScore && !warnings.includes("RSI overbought")) {
        signal = "BUY";
    } else if (bearishTrend && bearishMACD && bearishMomentum) {
        signal = "SELL";
    }

    // Detect a fresh SMA crossover for context, but don't require it.
    const bullishCross = previousIndicators.sma20 <= previousIndicators.sma50 && indicators.sma20 > indicators.sma50;
    const bearishCross = previousIndicators.sma20 >= previousIndicators.sma50 && indicators.sma20 < indicators.sma50;

    if (bullishCross) reasons.push("Fresh SMA bullish crossover");
    if (bearishCross) reasons.push("Fresh SMA bearish crossover");

    return {
        signal,
        score,
        maxScore: 9,
        reasons,
        warnings,
        price,
        indicators,
        bullishCross,
        bearishCross,
    };
}

function getSignal(candles) {
    return getStrategyAnalysis(candles).signal;
}

module.exports = {
    CONFIG,
    getStrategyAnalysis,
    getSignal,
};
