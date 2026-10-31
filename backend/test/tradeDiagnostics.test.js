const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTradeDiagnostics } = require('../src/tradeDiagnostics');
const hour = 3600000;
const candle = (i, high = 110, low = 90) => ({ openTime:i*hour, closeTime:(i+1)*hour-1, open:100, close:100, high, low, volume:1 });
const trade = overrides => ({side:'LONG',entryTime:0,exitTime:2*hour-1,entryPrice:100,exitPrice:95,quantity:2,initialStop:95,initialStopDistance:5,reason:'STOP LOSS',grossPnL:-10,fees:1,funding:0.2,netPnL:-11.2,...overrides});

test('excursions exclude the exit-bar wick and include known execution prices',()=>{
 const d=buildTradeDiagnostics([trade({})],[candle(0,108,96),candle(1,150,20),candle(2)]);
 const r=d.trades[0];assert.equal(r.observedMfePct,8);assert.equal(r.observedMaePct,5);
 assert.equal(r.observedMfeR,1.6);assert.equal(r.observedMaeR,1);assert.equal(r.fullyHeldBars,1);
 assert.equal(r.initialRiskCash,10);assert.equal(d.summary.netPnL,-11.2);
 assert.equal(d.summary.grossPnL-d.summary.fees-d.summary.funding,d.summary.netPnL);
});
test('SHORT excursions reverse price direction and partial entry bars are excluded',()=>{
 const r=buildTradeDiagnostics([trade({side:'SHORT',entryTime:hour/2,exitTime:3*hour-1,exitPrice:105})],[candle(0,500,1),candle(1,103,92),candle(2,400,1)]).trades[0];
 assert.equal(r.observedMfePct,8);assert.equal(r.observedMaePct,5);assert.equal(r.fullyHeldBars,1);
});
test('same-bar exits have no reliable wick coverage and legacy stop metadata stays unknown',()=>{
 const r=buildTradeDiagnostics([trade({exitTime:hour-1,initialStop:undefined,initialStopDistance:undefined})],[candle(0,500,1)]).trades[0];
 assert.equal(r.fullyHeldBars,0);assert.equal(r.observedMfePct,0);assert.equal(r.observedMaePct,5);
 assert.equal(r.observedMaeR,null);assert.equal(r.initialStopPct,null);
});
test('post-stop recovery distinguishes complete and censored windows without using exit-bar wicks',()=>{
 const c=[candle(0),candle(1,500,1),candle(2,99,90),candle(3,99,90)];
 const d=buildTradeDiagnostics([trade({})],c,{recoveryBars:4});
 assert.equal(d.trades[0].recovery.entryPriceTouched,null);assert.equal(d.summary.incompleteRecoveryWindows,1);
 assert.equal(d.summary.completeRecoveryWindows,0);
 c.push(candle(4,101,90),candle(5,99,90));
 const complete=buildTradeDiagnostics([trade({})],c);
 assert.equal(complete.trades[0].recovery.entryPriceTouched,true);assert.equal(complete.summary.recoveriesInCompleteWindows,1);
 const notTouched=buildTradeDiagnostics([trade({})],c.slice(0,4),{recoveryBars:2});
 assert.equal(notTouched.trades[0].recovery.entryPriceTouched,false);
});
test('SHORT recovery uses lows and normal exits do not enter recovery counts',()=>{
 const d=buildTradeDiagnostics([trade({side:'SHORT'}),trade({reason:'SIGNAL'})],[candle(0),candle(1),...Array.from({length:4},(_,i)=>candle(i+2,110,99))]);
 assert.equal(d.summary.completeRecoveryWindows,1);assert.equal(d.summary.recoveriesInCompleteWindows,1);assert.equal(d.trades[1].recovery,null);
});
test('concentration, holding groups and costs reconcile for winners and losers',()=>{
 const d=buildTradeDiagnostics([trade({netPnL:20,grossPnL:21.2}),trade({netPnL:-10,grossPnL:-8.8}),trade({netPnL:5,grossPnL:6.2})],[]);
 assert.equal(d.summary.netPnL,15);assert.equal(d.summary.largestWinner,20);assert.equal(d.summary.netWithoutLargestWinner,-5);
 assert.equal(d.summary.netWithoutTopThreeWinners,-10);assert.equal(d.byExit[0].netPnL,15);
 assert.equal(d.byHoldingTime.reduce((n,g)=>n+g.trades,0),3);
});
test('empty diagnostics contain zero counts and null medians, and invalid inputs fail',()=>{
 const d=buildTradeDiagnostics([],[]);assert.equal(d.summary.trades,0);assert.equal(d.summary.medianHoldingHours,null);assert.equal(d.summary.largestWinner,null);
 assert.throws(()=>buildTradeDiagnostics([trade({entryPrice:NaN})],[]),/Invalid/);
 assert.throws(()=>buildTradeDiagnostics([],[],{recoveryBars:0}),/recoveryBars/);
});
test('backtest diagnostics are retrospective only and obey each segment boundary',async()=>{
 const {runFuturesBacktest}=require('../src/futuresBacktester');
 const candles=Array.from({length:700},(_,i)=>{const close=100+i*.05;return {...candle(i,close+.02,close-.02),open:close-.01,close};});
 const result=await runFuturesBacktest({strategy:'Pure Breakout 40/20',interval:'1h',candlesData:candles,filters:{},leverage:1,direction:'LONG'});
 for(const key of ['full','inSample','outSample']) {
  const segment=result[key];assert.equal(segment.diagnostics.summary.trades,segment.trades.length);
  assert.ok(Math.abs(segment.diagnostics.summary.netPnL-(segment.metrics.finalEquity-1000))<1e-8);
  assert.ok(segment.trades.every(t=>t.initialStopDistance>0));
 }
 const is=result.inSample.diagnostics.trades;
 assert.ok(is.length > 0);
 assert.equal(is.at(-1)?.recovery,null); // forced segment-end exit cannot use later OOS prices
});
test('offline comparison writes dashboard diagnostics with provenance and rejects changed cache',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
 const {main}=require('../src/compareMtf');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'diagnostics-report-'));
 try {
  const start=1793332800000-6400*900000;
  const candles=Array.from({length:6400},(_,i)=>{const close=100+i*.01;return {openTime:start+i*900000,closeTime:start+(i+1)*900000-1,open:close,close,high:close+.005,low:close-.005,volume:1};});
  const cache={candles,filters:{},candleSHA256:crypto.createHash('sha256').update(JSON.stringify(candles)).digest('hex')};
  fs.writeFileSync(path.join(dir,'dataset.json'),JSON.stringify(cache));
  await main({directory:dir,offline:true});
  const d=JSON.parse(fs.readFileSync(path.join(dir,'diagnostics.json')));
  const r=JSON.parse(fs.readFileSync(path.join(dir,'report.json')));
  assert.equal(d.scenarios.length,4);assert.equal(d.candleSHA256,r.candleSHA256);assert.equal(d.sourceSHA256,r.sourceSHA256);
  for(let i=0;i<4;i++) for(const key of ['full','inSample','outSample']) assert.deepEqual(d.scenarios[i].segments[key],r.results[i].result[key].diagnostics);
  cache.candles[0].close+=1;fs.writeFileSync(path.join(dir,'dataset.json'),JSON.stringify(cache));
  await assert.rejects(main({directory:dir,offline:true}),/checksum/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
