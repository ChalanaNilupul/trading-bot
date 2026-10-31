const { test } = require('node:test');
const assert = require('node:assert/strict');
const { breakoutRetestStrategy: strategy, RETEST_NAME } = require('../src/breakoutRetest');
const { BASE_MS, aggregate4h } = require('../src/multiTimeframe');
const { buildSeries } = require('../src/indicators');
const { directedStrategy } = require('../src/direction');
const { runFuturesBacktest } = require('../src/futuresBacktester');
const { compare } = require('../src/compareMtf');
function bars(n=3400) {
  return Array.from({length:n},(_,i)=>{const close=100+i*.01;return {openTime:i*BASE_MS,closeTime:(i+1)*BASE_MS-1,open:close,close:close+.005,high:close+.008,low:close-.008,volume:1};});
}
const levelAtFirstBreakout = 100+3198*.01+.008;
function analyze(candles,i,options={}) {
  const series=buildSeries(candles);
  return strategy.analyze(strategy.prepare(candles,series,options),candles,series,i);
}
test('breakout only arms; a later retest confirms once at the frozen prior-40 high',()=>{
 const c=bars();c[3200].low=levelAtFirstBreakout-.01;
 const armed=analyze(c,3199),confirmation=analyze(c,3200);
 assert.equal(armed.signal,'HOLD');assert.equal(armed.indicators.retestState,'ARMED');
 assert.equal(armed.indicators.retestLevel,levelAtFirstBreakout);
 assert.equal(confirmation.signal,'BUY');assert.equal(confirmation.indicators.retestState,'CONFIRMED');
 assert.equal(confirmation.indicators.retestLevel,levelAtFirstBreakout);
 assert.notEqual(analyze(c,3201).signal,'BUY');
 assert.deepEqual(strategy.engine,require('../src/multiTimeframe').multiTimeframeStrategy.engine);
});
test('fourth later candle can confirm; fifth candle cannot confirm an expired level',()=>{
 const c=bars();c[3203].low=levelAtFirstBreakout-.01;
 assert.equal(analyze(c,3203).signal,'BUY');
 const late=bars();late[3204].low=levelAtFirstBreakout-.01;
 assert.equal(analyze(late,3203).indicators.retestState,'EXPIRED');
 assert.equal(analyze(late,3204).signal,'HOLD');
 assert.notEqual(analyze(late,3204).indicators.retestLevel,levelAtFirstBreakout);
});
test('close below frozen level cancels, equality does not confirm',()=>{
 const c=bars();c[3200].close=levelAtFirstBreakout-.005;c[3200].low=levelAtFirstBreakout-.01;
 assert.equal(analyze(c,3200).signal,'HOLD');assert.equal(analyze(c,3200).indicators.retestState,'CANCELLED');
 const equal=bars();equal[3200].close=levelAtFirstBreakout;equal[3200].low=levelAtFirstBreakout-.01;
 assert.equal(analyze(equal,3200).indicators.retestState,'WAITING');
});
test('unchanged exit signals override retest and stale/off higher-timeframe filters cancel setups',()=>{
 const c=bars();c[3200].low=129;c[3200].close=130;
 assert.equal(analyze(c,3200).signal,'SELL');
 const normal=bars(),trend=aggregate4h(normal);
 const stale=analyze(normal,3215,{trendCandles:trend.slice(0,200)});
 assert.equal(stale.signal,'HOLD');assert.equal(stale.indicators.retestState,'CANCELLED');
 trend[200]={...trend[200],close:20,low:19};
 const off=analyze(normal,3215,{trendCandles:trend});
 assert.equal(off.signal,'SELL');assert.equal(off.indicators.retestState,'CANCELLED');
});
test('future confirmations cannot change earlier decisions and truncated histories agree',()=>{
 const c=bars();c[3200].low=levelAtFirstBreakout-.01;
 for(const i of [3198,3199,3200,3203,3215,3399]) assert.deepEqual(analyze(c,i),analyze(c.slice(0,i+1),i));
 const altered=c.map((v,i)=>i>3199?{...v,close:v.close+500,high:v.high+500}:v);
 assert.deepEqual(analyze(c,3199),analyze(altered,3199));
});
test('separate live history reconstructs recent setup after a restart without mutable strategy state',()=>{
 const c=bars();const i=3399;
 // Reconstruct the current frozen setup, then provide a touch only on the last candle.
 const before=analyze(c,i-1);
 if(before.indicators.retestLevel!==null)c[i].low=before.indicators.retestLevel-.01;
 const recent=c.slice(-500),trend=aggregate4h(c);
 const full=analyze(c,i),live=analyze(recent,recent.length-1,{trendCandles:trend});
 assert.equal(live.signal,full.signal);assert.equal(live.indicators.retestState,full.indicators.retestState);
 assert.equal(live.indicators.retestLevel,full.indicators.retestLevel);
 assert.deepEqual(live,analyze(recent,recent.length-1,{trendCandles:trend}));
});
test('retest rejects unsupported direction, interval and insufficient historical warmup',async()=>{
 for(const direction of ['SHORT','BOTH'])assert.throws(()=>directedStrategy(RETEST_NAME,direction),/LONG only/);
 await assert.rejects(runFuturesBacktest({strategy:RETEST_NAME,interval:'4h'}),/requires interval/);
 await assert.rejects(runFuturesBacktest({strategy:RETEST_NAME,interval:'15m',candlesData:bars(1000),filters:{}}),/warmup/);
});
test('retest comparison changes entry strategy only and records fixed development-data rules',async()=>{
 const report=await compare(bars(6700),{},{retest:true});
 assert.equal(report.results.length,4);assert.equal(report.experiment.windowBars,4);
 assert.match(report.experiment.dataUse,/Previously inspected/);
 const [control,controlStress,candidate,candidateStress]=report.results.map(s=>s.result);
 assert.equal(candidate.config.strategy,RETEST_NAME);assert.equal(candidateStress.config.feeRate,.001);
 assert.equal(controlStress.config.slippage,.001);
 for(const r of [control,controlStress,candidate,candidateStress]) {
  assert.equal(r.period.evaluationStartTime,report.evaluationStartTime);assert.equal(r.period.splitTime,report.splitTime);
  for(const key of ['leverage','riskPercent','maxPositionPercent','fundingRatePer8h','maxDailyLossPct','maxDrawdownPct','maxConsecutiveLosses','cooldownMs','haltResumeDays'])assert.equal(r.config[key],control.config[key]);
 }
});
test('offline retest reads original cache, writes separate reports and does not overwrite the baseline',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
 const {main}=require('../src/compareMtf');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retest-comparison-'));
 try {
  const cacheDirectory=path.join(root,'baseline'),directory=path.join(root,'retest');fs.mkdirSync(cacheDirectory);
  const candles=bars(6700),dataset={candles,filters:{},candleSHA256:crypto.createHash('sha256').update(JSON.stringify(candles)).digest('hex')};
  fs.writeFileSync(path.join(cacheDirectory,'dataset.json'),JSON.stringify(dataset));
  fs.writeFileSync(path.join(cacheDirectory,'report.json'),'original baseline report');
  await main({directory,cacheDirectory,offline:true,retest:true,quiet:true});
  const report=JSON.parse(fs.readFileSync(path.join(directory,'report.json'))),diagnostics=JSON.parse(fs.readFileSync(path.join(directory,'diagnostics.json')));
  assert.equal(report.experiment.name,'breakout-retest-v1');assert.deepEqual(report.experiment,diagnostics.experiment);
  assert.equal(diagnostics.scenarios.length,4);assert.equal(report.candleSHA256,dataset.candleSHA256);
  assert.equal(fs.readFileSync(path.join(cacheDirectory,'report.json'),'utf8'),'original baseline report');
  assert.equal(fs.existsSync(path.join(directory,'dataset.json')),false);
  await assert.rejects(main({directory,offline:false,retest:true,quiet:true}),/requires --offline/);
  await assert.rejects(main({directory,cacheDirectory:directory,offline:true,retest:true,quiet:true}),/dataset missing/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
