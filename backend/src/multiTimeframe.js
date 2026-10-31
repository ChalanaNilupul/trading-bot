const { smaSeries } = require('./indicators');
const BASE_MS = 15 * 60 * 1000;
const TREND_MS = 4 * 60 * 60 * 1000;
const MTF_NAME = '4h trend + 15m breakout';

function validateBars(candles, duration) {
  if (!Array.isArray(candles)) throw new Error('Candle array is required');
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!['openTime','closeTime','open','high','low','close','volume'].every(k => Number.isFinite(c[k])) || c.openTime % duration !== 0 || c.closeTime !== c.openTime + duration - 1 || c.low <= 0 || c.high < Math.max(c.open,c.close) || c.low > Math.min(c.open,c.close) || c.volume < 0 || (i && c.openTime !== candles[i-1].openTime + duration)) throw new Error(`Invalid, missing or misaligned candle at index ${i}; expected ${duration / 60000}m bars`);
  }
}

// UTC-aligned complete groups only. Partial first/last buckets cannot become 4h inputs.
function aggregate4h(candles) {
  validateBars(candles, BASE_MS);
  const groups = [];
  let bucket = [];
  const flush = () => {
    if (bucket.length !== 16 || bucket[0].openTime % TREND_MS !== 0) return;
    const first=bucket[0], last=bucket.at(-1);
    groups.push({openTime:first.openTime,closeTime:last.closeTime,open:first.open,high:Math.max(...bucket.map(c=>c.high)),low:Math.min(...bucket.map(c=>c.low)),close:last.close,volume:bucket.reduce((s,c)=>s+c.volume,0)});
  };
  for (const c of candles) {
    if (bucket.length && Math.floor(c.openTime / TREND_MS) !== Math.floor(bucket[0].openTime / TREND_MS)) { flush(); bucket=[]; }
    bucket.push(c);
  }
  flush();
  return groups;
}

function priorChannel(candles, count, field, max) {
  const out = new Array(candles.length).fill(null);
  for (let i=count;i<candles.length;i++) {
    let value=max?-Infinity:Infinity;
    for (let j=i-count;j<i;j++) value=max?Math.max(value,candles[j][field]):Math.min(value,candles[j][field]);
    out[i]=value;
  }
  return out;
}

const multiTimeframeStrategy = {
  name: MTF_NAME,
  description: 'Experimental LONG candidate: closed 4h close>SMA200 and SMA50>SMA200; 15m breakout 40 entry, channel 20 or trend-off exit.',
  requiredInterval: '15m', supportedDirections: ['LONG'],
  trendInterval: '4h', trendLimit: 250, warmupBars: 3200,
  engine: { rewardRiskRatio: null, trailing: false },
  prepare(candles, _series, options = {}) {
    validateBars(candles, BASE_MS);
    const trend = options.trendCandles === undefined ? aggregate4h(candles) : options.trendCandles;
    validateBars(trend, TREND_MS);
    const closes=trend.map(c=>c.close), sma50=smaSeries(closes,50), sma200=smaSeries(closes,200);
    const trendIndex = new Array(candles.length).fill(-1);
    let j=-1;
    for(let i=0;i<candles.length;i++) {
      while(j+1<trend.length && trend[j+1].closeTime<=candles[i].closeTime)j++;
      trendIndex[i]=j;
    }
    return {trend,sma50,sma200,trendIndex,entryHigh:priorChannel(candles,40,'high',true),exitLow:priorChannel(candles,20,'low',false)};
  },
  analyze(ctx,candles,series,i) {
    const j=ctx.trendIndex[i],trend=j>=0?ctx.trend[j]:null;
    const s50=j>=0?ctx.sma50[j]:null,s200=j>=0?ctx.sma200[j]:null,atr=series.atr14[i];
    const ready=trend && trend.closeTime === Math.floor((candles[i].closeTime + 1) / TREND_MS) * TREND_MS - 1 && s50!=null && s200!=null && Number.isFinite(atr) && atr>0 && ctx.entryHigh[i]!=null && ctx.exitLow[i]!=null;
    const bullish=!!ready && trend.close>s200 && s50>s200;
    let signal='HOLD',reason='Waiting for 200 completed 4h candles';
    if(ready) {
      if(!bullish) {signal='SELL';reason='Closed 4h trend filter is off';}
      else if(candles[i].close<ctx.exitLow[i]) {signal='SELL';reason='15m close below prior 20-candle low';}
      else if(candles[i].close>ctx.entryHigh[i]) {signal='BUY';reason='15m breakout with closed 4h trend confirmation';}
      else reason='Bullish 4h filter; waiting for a 15m breakout';
    }
    return {signal,score:0,maxScore:0,price:candles[i].close,reasons:[reason],warnings:[],blockers:ready&&!bullish?['4h trend filter off']:[],
      indicators:{atr14:atr,trendCloseTime:trend?.closeTime??null,trendClose:trend?.close??null,trendSMA50:s50,trendSMA200:s200,entryHigh:ctx.entryHigh[i],exitLow:ctx.exitLow[i]}};
  },
  describe(ctx,candles,series,i) {return this.analyze(ctx,candles,series,i).reasons[0];},
};
module.exports={BASE_MS,TREND_MS,MTF_NAME,validateBars,aggregate4h,multiTimeframeStrategy};
