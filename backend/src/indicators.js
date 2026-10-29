/**
 * Indicators, computed as full series in O(n).
 * Every value at index i depends only on candles[0..i] (no lookahead),
 * so the backtester and the live bot can share exactly the same numbers.
 */

const WARMUP = 210; // candles needed before every indicator (SMA200 etc.) is valid

function smaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// EMA seeded with the SMA of the first `period` valid values. Leading nulls are skipped.
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  const start = values.findIndex((v) => v !== null && v !== undefined);
  if (start === -1 || values.length - start < period) return out;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i];
  let ema = sum / period;
  out[start + period - 1] = ema;

  for (let i = start + period; i < values.length; i++) {
    ema = (values[i] - ema) * k + ema;
    out[i] = ema;
  }
  return out;
}

const rsiValue = (avgGain, avgLoss) => {
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
};

// Wilder RSI
function rsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = rsiValue(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = rsiValue(avgGain, avgLoss);
  }
  return out;
}

// Wilder ATR
function atrSeries(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n < period + 1) return out;

  const tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - pc),
      Math.abs(c.low - pc),
    );
  }

  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr[i];
  atr /= period;
  out[period] = atr;

  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

function macdSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const f = emaSeries(closes, fast);
  const s = emaSeries(closes, slow);
  const macd = closes.map((_, i) =>
    f[i] !== null && s[i] !== null ? f[i] - s[i] : null,
  );
  const signal = emaSeries(macd, signalPeriod);
  const hist = macd.map((m, i) =>
    m !== null && signal[i] !== null ? m - signal[i] : null,
  );
  return { macd, signal, hist };
}

// Wilder ADX: trend strength (not direction). Low ADX = ranging/choppy market.
function adxSeries(candles, period = 14) {
  const n = candles.length;
  const out = new Array(n).fill(null);
  if (n < period * 2) return out;

  const tr = new Array(n).fill(0);
  const pdm = new Array(n).fill(0);
  const mdm = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const up = c.high - p.high;
    const down = p.low - c.low;
    pdm[i] = up > down && up > 0 ? up : 0;
    mdm[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close),
    );
  }

  let sTR = 0,
    sP = 0,
    sM = 0;
  for (let i = 1; i <= period; i++) {
    sTR += tr[i];
    sP += pdm[i];
    sM += mdm[i];
  }

  const dxAt = () => {
    if (sTR === 0) return 0;
    const pdi = (100 * sP) / sTR;
    const mdi = (100 * sM) / sTR;
    const denom = pdi + mdi;
    return denom === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / denom;
  };

  const dx = new Array(n).fill(null);
  dx[period] = dxAt();
  for (let i = period + 1; i < n; i++) {
    sTR = sTR - sTR / period + tr[i];
    sP = sP - sP / period + pdm[i];
    sM = sM - sM / period + mdm[i];
    dx[i] = dxAt();
  }

  let adx = 0;
  for (let i = period; i <= 2 * period - 1; i++) adx += dx[i];
  adx /= period;
  out[2 * period - 1] = adx;

  for (let i = 2 * period; i < n; i++) {
    adx = (adx * (period - 1) + dx[i]) / period;
    out[i] = adx;
  }
  return out;
}

function buildSeries(candles) {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const macd = macdSeries(closes);

  return {
    sma20: smaSeries(closes, 20),
    sma50: smaSeries(closes, 50),
    sma200: smaSeries(closes, 200),
    ema20: emaSeries(closes, 20),
    ema50: emaSeries(closes, 50),
    rsi14: rsiSeries(closes, 14),
    atr14: atrSeries(candles, 14),
    adx14: adxSeries(candles, 14),
    macdLine: macd.macd,
    macdSignal: macd.signal,
    macdHist: macd.hist,
    volumeSMA20: smaSeries(volumes, 20),
  };
}

// Indicator values as of candle index i.
function snapshotAt(series, i) {
  if (i < 0) return null;
  const hasMacd = series.macdSignal[i] !== null;
  return {
    sma20: series.sma20[i],
    sma50: series.sma50[i],
    sma200: series.sma200[i],
    ema20: series.ema20[i],
    ema50: series.ema50[i],
    rsi14: series.rsi14[i],
    atr14: series.atr14[i],
    adx14: series.adx14[i],
    volumeSMA20: series.volumeSMA20[i],
    macd: hasMacd
      ? {
          macd: series.macdLine[i],
          signal: series.macdSignal[i],
          histogram: series.macdHist[i],
        }
      : null,
  };
}

const last = (arr) => arr[arr.length - 1];

// Convenience wrappers (latest value only), kept for backwards compatibility.
const calculateSMA = (values, period) => last(smaSeries(values, period));
const calculateEMA = (values, period) => last(emaSeries(values, period));
const calculateRSI = (closes, period = 14) => last(rsiSeries(closes, period));
const calculateATR = (candles, period = 14) => last(atrSeries(candles, period));
const calculateADX = (candles, period = 14) => last(adxSeries(candles, period));

function calculateIndicators(candles) {
  return snapshotAt(buildSeries(candles), candles.length - 1);
}

module.exports = {
  WARMUP,
  smaSeries,
  emaSeries,
  rsiSeries,
  atrSeries,
  macdSeries,
  adxSeries,
  buildSeries,
  snapshotAt,
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateADX,
  calculateIndicators,
};
