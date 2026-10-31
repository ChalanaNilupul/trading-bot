const {test}=require('node:test');
const assert=require('node:assert/strict');
const {BASE_MS,TREND_MS,MTF_NAME,aggregate4h,multiTimeframeStrategy:st}=require('../src/multiTimeframe');
const {buildSeries}=require('../src/indicators');
const {directedStrategy}=require('../src/direction');
const {runFuturesBacktest}=require('../src/futuresBacktester');
const {compare}=require('../src/compareMtf');
function bars(n=6700){return Array.from({length:n},(_,i)=>{const c=100+i*.01;return {openTime:i*BASE_MS,closeTime:(i+1)*BASE_MS-1,open:c,close:c+.005,high:c+.008,low:c-.008,volume:1};});}
test('only complete UTC 4h groups are included; gaps and misalignment are rejected',()=>{
 const c=bars(50);assert.equal(aggregate4h(c).length,3);assert.equal(aggregate4h(c.slice(1)).length,2);
 assert.throws(()=>aggregate4h([...c.slice(0,20),...c.slice(21)]),/missing/);
 assert.throws(()=>aggregate4h([{...c[0],openTime:1}]),/misaligned/);
});
test('signals and indicators use only completed 4h candles at every boundary',()=>{
 const c=bars(3400),s=buildSeries(c),ctx=st.prepare(c,s);
 for(const i of [3198,3199,3200,3214,3215,3399]){
  const part=c.slice(0,i+1),ps=buildSeries(part);
  const a=st.analyze(ctx,c,s,i);
  assert.deepEqual(a,st.analyze(st.prepare(part,ps),part,ps,i));
  if(a.indicators.trendCloseTime!==null)assert.ok(a.indicators.trendCloseTime<=c[i].closeTime);
 }
 assert.equal(st.analyze(ctx,c,s,3198).signal,'HOLD');
 assert.equal(st.analyze(ctx,c,s,3200).signal,'BUY');
 const altered=c.map((b,i)=>i>3200?{...b,close:b.close+1000,high:b.high+1000}:b),as=buildSeries(altered);
 assert.deepEqual(st.analyze(ctx,c,s,3200),st.analyze(st.prepare(altered,as),altered,as,3200));
});
test('separate live 4h data agrees with aggregation and stale trend inputs cannot enter',()=>{
 const c=bars(4000),recent=c.slice(-500),s=buildSeries(recent),trend=aggregate4h(c);
 const live=st.analyze(st.prepare(recent,s,{trendCandles:trend}),recent,s,499);
 const full=st.analyze(st.prepare(c,buildSeries(c)),c,buildSeries(c),3999);
 assert.equal(live.signal,full.signal);assert.equal(live.indicators.trendSMA200,full.indicators.trendSMA200);
 assert.equal(st.analyze(st.prepare(recent,s,{trendCandles:trend.slice(0,-1)}),recent,s,499).signal,'HOLD');
});
test('candidate rejects SHORT, BOTH, incorrect interval and insufficient warmup',async()=>{
 for(const d of ['SHORT','BOTH'])assert.throws(()=>directedStrategy(MTF_NAME,d),/LONG only/);
 await assert.rejects(runFuturesBacktest({strategy:MTF_NAME,interval:'4h'}),/requires interval/);
 await assert.rejects(runFuturesBacktest({strategy:MTF_NAME,interval:'15m',candlesData:bars(1000),filters:{}}),/warmup/);
});
test('comparison shares calendar evaluation and split timestamps across both intervals',async()=>{
 const r=await compare(bars(),{});
 assert.equal(r.results.length,4);
 for(const {result} of r.results){assert.equal(result.period.evaluationStartTime,r.evaluationStartTime);assert.equal(result.period.splitTime,r.splitTime);assert.equal(result.liveOrdersEnabled,false);}
 assert.equal(r.results[3].result.config.feeRate,0.001);
 await assert.rejects(compare(bars(1000),{}),/400/);
});
test('matched date options reject invalid windows instead of silently comparing different dates',async()=>{
 const common={strategy:'Pure Breakout 40/20',interval:'15m',candlesData:bars(1000),filters:{}};
 await assert.rejects(runFuturesBacktest({...common,evaluationStartTime:NaN}),/timestamp/);
 await assert.rejects(runFuturesBacktest({...common,evaluationStartTime:300*BASE_MS,splitTime:200*BASE_MS}),/Split/);
 await assert.rejects(runFuturesBacktest({...common,splitTime:2000*BASE_MS}),/outside/);
});
test('paper runner fetches separate 4h history and passes trend context to execution',()=>{
 const {execFileSync}=require('node:child_process');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mtf-runner-'));
 try {
  const modulePath=path.resolve(__dirname,'../src/index.js');
  const binancePath=path.resolve(__dirname,'../src/binance.js');
  const mtfPath=path.resolve(__dirname,'../src/multiTimeframe.js');
  const script=`const assert=require('node:assert/strict');
   const {aggregate4h}=require(${JSON.stringify(mtfPath)});
   const bars=${bars.toString()}; const BASE_MS=900000;const all=bars(4000),calls=[];
   const api=require(${JSON.stringify(binancePath)});
   api.getFuturesCandles=async(s,i,n)=>{calls.push([i,n]);return i==='4h'?aggregate4h(all).slice(-n):all.slice(-n)};
   api.getFuturesTickerPrice=async()=>140;
   const {Runner}=require(${JSON.stringify(modulePath)});
   const runner=new Runner('SOLUSDT',{aiFilter:{enabled:false}});
   runner.tick().then(()=>{assert.deepEqual(calls,[['15m',500],['4h',250]]);assert.match(runner.lastNote,/Bullish|breakout/);assert.equal(runner.lastProcessed,all.at(-1).closeTime);}).catch(e=>{console.error(e);process.exitCode=1});`;
  execFileSync(process.execPath,['-e',script],{cwd:dir,env:{...process.env,STRATEGY:MTF_NAME,INTERVAL:'15m',DIRECTION:'LONG',BOT_SYMBOL:'SOLUSDT',AI_ENABLED:'0'},stdio:'pipe'});
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('channel breaks and a bearish completed 4h trend produce LONG exit signals',()=>{
 const c=bars(3400);c[3200]={...c[3200],close:100,low:99};
 const s=buildSeries(c);const a=st.analyze(st.prepare(c,s),c,s,3200);
 assert.equal(a.signal,'SELL');assert.match(a.reasons[0],/20-candle/);
 const down=bars(3400).map(c=>({...c,open:300-c.open,high:300-c.low,low:300-c.high,close:300-c.close}));
 const ds=buildSeries(down),b=st.analyze(st.prepare(down,ds),down,ds,3399);
 assert.equal(b.signal,'SELL');assert.match(b.reasons[0],/trend filter is off/);
});
