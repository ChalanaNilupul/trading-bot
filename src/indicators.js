function calculateSMA(values, period) {
    if (!Array.isArray(values) || values.length < period || period <= 0) return null;
    const slice = values.slice(-period);
    return slice.reduce((sum, value) => sum + value, 0) / period;
}

function calculateEMA(values, period) {
    if (!Array.isArray(values) || values.length < period || period <= 0) return null;

    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

    for (let i = period; i < values.length; i++) {
        ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
}

function calculateRSI(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change >= 0) gains += change;
        else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

function calculateATR(candles, period = 14) {
    if (!Array.isArray(candles) || candles.length < period + 1) return null;

    const trueRanges = [];

    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const tr = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );

        trueRanges.push(tr);
    }

    let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;

    for (let i = period; i < trueRanges.length; i++) {
        atr = ((atr * (period - 1)) + trueRanges[i]) / period;
    }

    return atr;
}

function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (!Array.isArray(closes) || closes.length < slowPeriod + signalPeriod) return null;

    const multiplierFast = 2 / (fastPeriod + 1);
    const multiplierSlow = 2 / (slowPeriod + 1);

    let fastEMA = closes.slice(0, fastPeriod).reduce((s, v) => s + v, 0) / fastPeriod;
    let slowEMA = closes.slice(0, slowPeriod).reduce((s, v) => s + v, 0) / slowPeriod;

    const macdValues = [];

    // Build fast/slow EMA values from the first point where both are valid.
    for (let i = fastPeriod; i < closes.length; i++) {
        fastEMA = (closes[i] - fastEMA) * multiplierFast + fastEMA;

        if (i >= slowPeriod) {
            if (i === slowPeriod) {
                slowEMA = closes.slice(0, slowPeriod).reduce((s, v) => s + v, 0) / slowPeriod;
            } else {
                slowEMA = (closes[i] - slowEMA) * multiplierSlow + slowEMA;
            }
            macdValues.push(fastEMA - slowEMA);
        }
    }

    if (macdValues.length < signalPeriod) return null;

    const signal = calculateEMA(macdValues, signalPeriod);
    const macd = macdValues[macdValues.length - 1];

    return {
        macd,
        signal,
        histogram: macd - signal,
    };
}

function calculateIndicators(candles) {
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    return {
        sma20: calculateSMA(closes, 20),
        sma50: calculateSMA(closes, 50),
        sma200: calculateSMA(closes, 200),
        ema20: calculateEMA(closes, 20),
        ema50: calculateEMA(closes, 50),
        rsi14: calculateRSI(closes, 14),
        atr14: calculateATR(candles, 14),
        macd: calculateMACD(closes),
        volumeSMA20: calculateSMA(volumes, 20),
    };
}

module.exports = {
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateATR,
    calculateMACD,
    calculateIndicators,
};
