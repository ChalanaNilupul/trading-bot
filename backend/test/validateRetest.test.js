const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WINDOWS,SCENARIOS,COMMON,WARMUP_BARS,runValidation}=require('../src/validateRetest');
const {BASE_MS}=require('../src/multiTimeframe');
const filters={stepSize:.01,minQty:.01,minNotional:5,tickSize:.01};
function candlesFor(w){return Array.from({length:w.candles},(_,i)=>{const c=100+i*.002;return {openTime:w.dataStartTime+i*BASE_MS,closeTime:w.dataStartTime+(i+1)*BASE_MS-1,open:c,close:c,high:c+.001,low:c-.001,volume:1};});}
function mockResult(o){
 const metrics={trades:1,returnPct:-.1,maxDrawdownPct:.2,maxLossStreak:1,profitFactor:0};
 const summary={trades:1,netPnL:-1,fees:.1,funding:.01,netWithoutLargestWinner:-1};
 const diagnostics={schemaVersion:1,summary,trades:[],byExit:[],byHoldingTime:[],method:'fixture',recoveryBars:4};
 const segment={metrics,diagnostics,trades:[]};
 return {config:o,period:{evaluationStartTime:o.evaluationStartTime,endTime:o.candlesData.at(-1).closeTime,splitTime:o.splitTime},full:segment,inSample:segment,outSample:segment,risk:{full:{}}};
}
function temp(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'retest-validation-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
test('fixed plan has seven nonoverlapping quarters with adequate warmup and explicit inspected-data flags',()=>{
 assert.equal(WINDOWS.length,7);assert.equal(WINDOWS[0].id,'2025-Q1');assert.equal(WINDOWS[6].id,'2026-Q3');
 for(let i=0;i<WINDOWS.length;i++){
  const w=WINDOWS[i];assert.equal(w.startTime-w.dataStartTime,WARMUP_BARS*BASE_MS);assert.ok(w.candles<=20000);
  assert.equal(w.startTime%BASE_MS,0);if(i)assert.equal(w.startTime,WINDOWS[i-1].endTime+1);
 }
 assert.equal(WINDOWS[0].overlapsPreviouslyUsed15mData,false);assert.equal(WINDOWS[6].overlapsPreviouslyUsed15mData,true);
 assert.equal(SCENARIOS.length,4);assert.equal(COMMON.leverage,1);assert.equal(COMMON.haltResumeDays,0);
});
test('all windows and cost scenarios run, archive exact dates, and replay offline without requests',async t=>{
 const directory=temp(t),calls=[],fetches=[];
 const report=await runValidation({directory,quiet:true},{fetchCandles:async(symbol,interval,count,end)=>{
  fetches.push({symbol,interval,count,end});return candlesFor(WINDOWS.find(w=>w.endTime===end));
 },getFilters:async()=>filters,backtest:async o=>{calls.push(o);return mockResult(o);}});
 assert.equal(report.complete,true);assert.equal(fetches.length,7);assert.equal(calls.length,28);
 for(let i=0;i<7;i++)for(let s=0;s<4;s++){
  const o=calls[i*4+s];assert.equal(o.evaluationStartTime,WINDOWS[i].startTime);
  assert.equal(o.candlesData[0].openTime,WINDOWS[i].dataStartTime);assert.equal(o.strategy,SCENARIOS[s].strategy);
  assert.equal(o.feeRate,SCENARIOS[s].feeRate);assert.equal(o.startingBalance,1000);assert.equal(o.direction,'LONG');
 }
 assert.ok(report.summary.every(s=>s.completedWindows===7 && s.profitableWindows===0 && s.sumNetIndependentWallets===-7));
 const replay=await runValidation({directory,offline:true,quiet:true},{fetchCandles:()=>{throw Error('Network forbidden');},getFilters:()=>{throw Error('Network forbidden');},backtest:async o=>mockResult(o)});
 assert.deepEqual(replay.summary,report.summary);
 const diagnostic=JSON.parse(fs.readFileSync(path.join(directory,'windows','2025-Q1','diagnostics.json')));
 assert.equal(diagnostic.scenarios.length,4);assert.equal(diagnostic.evaluationStartTime,WINDOWS[0].startTime);
});
test('offline missing windows remain visible and produce an incomplete report',async t=>{
 const directory=temp(t);
 const report=await runValidation({directory,offline:true,quiet:true},{fetchCandles:()=>{throw Error('Network forbidden');}});
 assert.equal(report.complete,false);assert.equal(report.windows.length,7);
 assert.ok(report.windows.every(w=>w.status==='error' && /missing/.test(w.error)));
 assert.ok(report.summary.every(s=>s.completedWindows===0 && s.medianQuarterReturnPct===null));
});
test('one failed download never hides other windows or archives an invalid dataset',async t=>{
 const directory=temp(t);
 const report=await runValidation({directory,quiet:true},{fetchCandles:async(_s,_i,_n,end)=>{
  const w=WINDOWS.find(w=>w.endTime===end);return w.id==='2025-Q2'?candlesFor(w).slice(1):candlesFor(w);
 },getFilters:async()=>filters,backtest:async o=>mockResult(o)});
 assert.equal(report.complete,false);assert.equal(report.windows[1].status,'error');assert.match(report.windows[1].error,/count\/dates/);
 assert.equal(fs.existsSync(path.join(directory,'datasets','2025-Q2.json')),false);
 assert.equal(report.summary[0].completedWindows,6);assert.equal(report.windows[6].status,'ok');
});
test('cache checksum failure blocks that window without silently downloading replacement data',async t=>{
 const directory=temp(t),dependencies={windows:[WINDOWS[0]],fetchCandles:async()=>candlesFor(WINDOWS[0]),getFilters:async()=>filters,backtest:async o=>mockResult(o)};
 await runValidation({directory,quiet:true},dependencies);
 const file=path.join(directory,'datasets','2025-Q1.json'),d=JSON.parse(fs.readFileSync(file));d.candles[0].volume+=1;fs.writeFileSync(file,JSON.stringify(d));
 const report=await runValidation({directory,offline:true,quiet:true},{windows:[WINDOWS[0]],fetchCandles:()=>{throw Error('Network forbidden');},backtest:async o=>mockResult(o)});
 assert.equal(report.complete,false);assert.match(report.windows[0].error,/checksum/);
});
test('scenario failures are reported while remaining comparisons run; mismatched dates are rejected',async t=>{
 const directory=temp(t);let calls=0;
 const report=await runValidation({directory,quiet:true},{windows:[WINDOWS[0]],fetchCandles:async()=>candlesFor(WINDOWS[0]),getFilters:async()=>filters,backtest:async o=>{
  calls++;if(calls===1)throw Error('Simulated engine failure');const r=mockResult(o);if(calls===2)r.period.endTime--;return r;
 }});
 assert.equal(calls,4);assert.equal(report.complete,false);assert.equal(report.windows[0].results.filter(r=>r.status==='error').length,2);
 assert.match(report.windows[0].results[1].error,/mismatched/);
});
test('real engine evaluates the entire quarter only after warmup with diagnostics and unchanged frozen rules',async t=>{
 const directory=temp(t);
 const report=await runValidation({directory,quiet:true},{windows:[WINDOWS[0]],fetchCandles:async()=>candlesFor(WINDOWS[0]),getFilters:async()=>filters});
 assert.equal(report.complete,true);assert.equal(report.windows[0].results.length,4);
 const details=JSON.parse(fs.readFileSync(path.join(directory,'windows','2025-Q1','report.json')));
 for(const r of details.results){assert.equal(r.period.evaluationStartTime,WINDOWS[0].startTime);assert.equal(r.config.startingBalance,1000);assert.ok(r.trades.every(t=>t.entryTime>=WINDOWS[0].startTime));}
});
