const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getFuturesHistoricalCandles, getFuturesSymbolFilters } = require('./binance');
const { runFuturesBacktest } = require('./futuresBacktester');
const { BASE_MS, MTF_NAME, validateBars } = require('./multiTimeframe');
const { RETEST_NAME, RETEST_BARS } = require('./breakoutRetest');
const sha256 = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const WARMUP_BARS = 3360; // 35 days, covering 200 completed UTC 4h candles.
const SCENARIOS = Object.freeze([
  Object.freeze({label:'Current',strategy:MTF_NAME,feeRate:0.0005,slippage:0.0005}),
  Object.freeze({label:'Current: 2x costs',strategy:MTF_NAME,feeRate:0.001,slippage:0.001}),
  Object.freeze({label:'Retest v1',strategy:RETEST_NAME,feeRate:0.0005,slippage:0.0005}),
  Object.freeze({label:'Retest v1: 2x costs',strategy:RETEST_NAME,feeRate:0.001,slippage:0.001}),
]);
const WINDOWS = Object.freeze(Array.from({length:7},(_,i)=>{
  const year=2025+Math.floor(i/4),quarter=i%4+1,startTime=Date.UTC(year,(quarter-1)*3,1),endTime=Date.UTC(year,quarter*3,1)-1;
  const dataStartTime=startTime-WARMUP_BARS*BASE_MS;
  return Object.freeze({id:`${year}-Q${quarter}`,startTime,endTime,dataStartTime,
    candles:(endTime+1-dataStartTime)/BASE_MS,
    overlapsPreviouslyUsed15mData:endTime>=1775332800000 && startTime<=1793332799999});
}));
const COMMON = Object.freeze({symbol:'SOLUSDT',interval:'15m',direction:'LONG',startingBalance:1000,leverage:1,
  riskPercent:0.0025,maxPositionPercent:0.1,fundingRatePer8h:0.0001,
  maxDailyLossPct:0.03,maxDrawdownPct:0.1,maxConsecutiveLosses:3,cooldownMs:14400000,maxTradesPerDay:6,haltResumeDays:0});

function validateFilters(filters) {
  if (!filters || typeof filters!=='object' || !['stepSize','minQty','minNotional','tickSize'].every(k=>Number.isFinite(filters[k]) && filters[k]>=0) || filters.stepSize<=0 || filters.tickSize<=0)
    throw new Error('Complete exchange quantity/price filters are required');
}
function validateDataset(dataset, window) {
  if (dataset.schemaVersion!==1 || dataset.symbol!=='SOLUSDT' || dataset.interval!=='15m' || dataset.windowId!==window.id)
    throw new Error('Cache metadata does not match the fixed validation window');
  validateFilters(dataset.filters);
  validateBars(dataset.candles,BASE_MS);
  if (dataset.candles.length!==window.candles || dataset.candles[0]?.openTime!==window.dataStartTime || dataset.candles.at(-1)?.closeTime!==window.endTime)
    throw new Error('Candle count/dates do not cover the exact warmup and evaluation window');
  if (dataset.sha256!==sha256({windowId:dataset.windowId,candles:dataset.candles,filters:dataset.filters}))
    throw new Error('Validation cache checksum mismatch; preserve the file and investigate before replacing it');
}
function sourceFingerprint() {
  const files=['validateRetest.js','breakoutRetest.js','multiTimeframe.js','futuresBacktester.js','futuresEngine.js','direction.js','strategies.js','indicators.js','metrics.js','riskGuard.js','riskManager.js','tradeDiagnostics.js','binance.js'];
  const hashes=Object.fromEntries(files.map(file=>[file,sha256(fs.readFileSync(path.join(__dirname,file),'utf8'))]));
  return {sha256:sha256(hashes),files:hashes};
}
function finiteMetrics(metrics) {
  return {...metrics,profitFactor:Number.isFinite(metrics.profitFactor)?metrics.profitFactor:null,
    profitFactorStatus:metrics.profitFactor===Infinity?'NO_LOSSES':Number.isFinite(metrics.profitFactor)?'FINITE':'UNDEFINED'};
}
const median = values => {if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
function summarize(windows, plannedWindows = windows.length) {
  return SCENARIOS.map(scenario=>{
    const rows=windows.flatMap(w=>w.results.filter(r=>r.label===scenario.label && r.status==='ok'));
    const net=rows.reduce((n,r)=>n+r.diagnostics.netPnL,0),trades=rows.reduce((n,r)=>n+r.metrics.trades,0);
    return {label:scenario.label,completedWindows:rows.length,plannedWindows,
      profitableWindows:rows.filter(r=>r.diagnostics.netPnL>0).length,
      totalTrades:trades,sumNetIndependentWallets:net,tradeWeightedExpectancy:trades?net/trades:null,
      medianQuarterReturnPct:median(rows.map(r=>r.metrics.returnPct)),
      worstQuarterDrawdownPct:rows.length?Math.max(...rows.map(r=>r.metrics.maxDrawdownPct)):null,
      maximumQuarterLossStreak:rows.length?Math.max(...rows.map(r=>r.metrics.maxLossStreak)):null,
      totalFees:rows.reduce((n,r)=>n+r.diagnostics.fees,0),totalFunding:rows.reduce((n,r)=>n+r.diagnostics.funding,0),
      note:'Quarter wallets reset independently. Net sums are not a compounded portfolio return. Failed/missing windows are excluded from these descriptive totals and remain visible in the report.'};
  });
}

async function runValidation({directory=path.join(__dirname,'../data/sol-retest-validation'),offline=false,quiet=false}={},dependencies={}) {
  const fetchCandles=dependencies.fetchCandles || getFuturesHistoricalCandles;
  const getFilters=dependencies.getFilters || getFuturesSymbolFilters;
  const backtest=dependencies.backtest || runFuturesBacktest;
  const windows=dependencies.windows || WINDOWS;
  fs.mkdirSync(path.join(directory,'datasets'),{recursive:true});
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),mode:'FIXED_WINDOW_HISTORICAL_RESEARCH',liveOrdersEnabled:false,aiIncluded:false,
    experiment:{name:'breakout-retest-v1',retestWindowBars:RETEST_BARS,training:false,parameterSearch:false,automaticActivation:false},
    plan:{windows,warmupBars:WARMUP_BARS,scenarios:SCENARIOS,common:COMMON},source:sourceFingerprint(),
    assumptions:['Frozen fixed-rule historical robustness checks, not proof of profitability or an untouched holdout.',
      'Prior office 4h reports covered some of these market dates. Overlap flags only identify the previously used 15m dataset; a false flag does not guarantee unseen data.',
      'Each quarter uses a fresh wallet with no carried position. Warmup bars cannot open trades; positions are closed at quarter end.',
      'Exchange filters are captured with each dataset, not reconstructed historically. Funding is a fixed-rate estimate; slippage is simulated, not actual fills.',
      'Comparison uses full quarterly evaluation metrics. Internal inSample/outSample splits in detailed diagnostics are descriptive only.',
      'No strategy is selected automatically. Include every failed, empty, losing and profitable window.'],windows:[]};
  let filtersPromise;
  for(const window of windows) {
    const record={...window,status:'error',results:[]};report.windows.push(record);
    if(!quiet) console.log(`${window.id}: ${offline?'checking cache':'loading/checking data'} (${window.candles} candles including warmup)`);
    try {
      const cacheFile=path.join(directory,'datasets',`${window.id}.json`);
      let dataset;
      if(fs.existsSync(cacheFile)) dataset=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
      else {
        if(offline)throw new Error('Cached dataset missing; offline mode makes no requests');
        // Fetch sequentially so rate-limit pressure is bounded. Never substitute mock prices on failure.
        const candles=await fetchCandles('SOLUSDT','15m',window.candles,window.endTime);
        if(!filtersPromise)filtersPromise=Promise.resolve().then(()=>getFilters('SOLUSDT'));
        const filters=await filtersPromise;
        dataset={schemaVersion:1,symbol:'SOLUSDT',interval:'15m',windowId:window.id,downloadedAt:new Date().toISOString(),candles,filters};
        dataset.sha256=sha256({windowId:window.id,candles,filters});
        validateDataset(dataset,window); // Invalid/incomplete downloads are never archived as valid caches.
        fs.writeFileSync(cacheFile,JSON.stringify(dataset));
      }
      validateDataset(dataset,window);
      record.dataset={file:path.relative(directory,cacheFile),sha256:dataset.sha256,filters:dataset.filters,downloadedAt:dataset.downloadedAt};
      const details=[],diagnosticScenarios=[];
      for(const scenario of SCENARIOS) {
        try {
          const {label,...settings}=scenario;
          const result=await backtest({...COMMON,...settings,filters:dataset.filters,candles:window.candles,candlesData:dataset.candles,
            evaluationStartTime:window.startTime,splitTime:window.startTime+Math.floor((window.endTime+1-window.startTime)/BASE_MS/2)*BASE_MS});
          if(result.period.evaluationStartTime!==window.startTime || result.period.endTime!==window.endTime)throw new Error('Engine returned mismatched evaluation dates');
          const diagnostics=result.full.diagnostics;
          record.results.push({label,status:'ok',metrics:finiteMetrics(result.full.metrics),diagnostics:diagnostics.summary,risk:result.risk.full});
          details.push({label,config:result.config,period:result.period,metrics:finiteMetrics(result.full.metrics),trades:result.full.trades,diagnostics,risk:result.risk.full});
          diagnosticScenarios.push({label:`${window.id}: ${label}`,symbol:'SOLUSDT',interval:'15m',segments:Object.fromEntries(['full','inSample','outSample'].map(key=>[key,result[key].diagnostics]))});
        } catch(error) {record.results.push({label:scenario.label,status:'error',error:error.message});}
      }
      const detailDir=path.join(directory,'windows',window.id);fs.mkdirSync(detailDir,{recursive:true});
      fs.writeFileSync(path.join(detailDir,'report.json'),JSON.stringify({window,dataset:record.dataset,source:report.source,results:details},null,2));
      fs.writeFileSync(path.join(detailDir,'diagnostics.json'),JSON.stringify({schemaVersion:1,symbol:'SOLUSDT',candleSHA256:sha256(dataset.candles),sourceSHA256:report.source.sha256,
        evaluationStartTime:window.startTime,splitTime:details[0]?.period.splitTime,scenarios:diagnosticScenarios},null,2));
      record.detailsFile=path.relative(directory,path.join(detailDir,'report.json'));
      record.status=record.results.every(r=>r.status==='ok')?'ok':'error';
    } catch(error) {record.error=error.message;}
    // Checkpoint every window so a later interruption does not erase completed research.
    report.complete=report.windows.length===windows.length && report.windows.every(w=>w.status==='ok');
    report.summary=summarize(report.windows, windows.length);
    fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));
  }
  if(!quiet) {
    console.table(report.windows.flatMap(w=>w.results.length?w.results.map(r=>r.status==='ok'?{
      Window:w.id,Scenario:r.label,Trades:r.metrics.trades,Net:r.diagnostics.netPnL.toFixed(2),PF:r.metrics.profitFactor?.toFixed(2)??r.metrics.profitFactorStatus,
      DD:r.metrics.maxDrawdownPct.toFixed(2),LossStreak:r.metrics.maxLossStreak,WithoutBest:r.diagnostics.netWithoutLargestWinner.toFixed(2)}:
      {Window:w.id,Scenario:r.label,Status:'ERROR',Error:r.error}):[{Window:w.id,Scenario:'ALL',Status:'ERROR',Error:w.error}]));
    console.table(report.summary.map(s=>({Scenario:s.label,Completed:`${s.completedWindows}/${s.plannedWindows}`,Positive:s.profitableWindows,Trades:s.totalTrades,
      SumNet:s.sumNetIndependentWallets.toFixed(2),MedianQuarter:s.medianQuarterReturnPct?.toFixed(2),WorstQuarterDD:s.worstQuarterDrawdownPct?.toFixed(2)})));
    console.log(`Historical robustness checks only. No orders, AI calls or bot state/settings changes.\nData/execution complete (not a profitability verdict): ${report.complete}\nReport: ${path.join(directory,'report.json')}`);
  }
  return report;
}
if(require.main===module)runValidation({offline:process.argv.includes('--offline')}).then(r=>{if(!r.complete)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={WINDOWS,SCENARIOS,COMMON,WARMUP_BARS,validateDataset,summarize,runValidation};
