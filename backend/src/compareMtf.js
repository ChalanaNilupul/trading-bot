const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getFuturesHistoricalCandles, getFuturesSymbolFilters } = require('./binance');
const { runFuturesBacktest } = require('./futuresBacktester');
const { aggregate4h, MTF_NAME } = require('./multiTimeframe');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

async function compare(candles, filters) {
  const four = aggregate4h(candles);
  if (four.length < 400) throw new Error('Need at least 400 complete 4h candles (6,400 aligned 15m candles)');
  const evaluationStartTime = four[210].openTime;
  const splitTime = four[210 + Math.floor((four.length - 210) * 0.7)].openTime;
  const common = { symbol:'SOLUSDT', direction:'LONG', startingBalance:1000, leverage:1,
    riskPercent:0.0025, maxPositionPercent:0.1, feeRate:0.0005, slippage:0.0005,
    fundingRatePer8h:0.0001, haltResumeDays:0, evaluationStartTime, splitTime, filters };
  const scenarios = [
    {label:'Original 4h breakout', strategy:'Pure Breakout 40/20', interval:'4h', candlesData:four},
    {label:'15m breakout control', strategy:'Pure Breakout 40/20', interval:'15m', candlesData:candles},
    {label:'4h trend / 15m entry', strategy:MTF_NAME, interval:'15m', candlesData:candles},
    {label:'Candidate: 2x fees/slippage', strategy:MTF_NAME, interval:'15m', candlesData:candles,feeRate:0.001,slippage:0.001},
  ];
  const results=[];
  for (const scenario of scenarios) {
    const {label,...options}=scenario;
    results.push({label,result:await runFuturesBacktest({...common,...options,candles:options.candlesData.length})});
  }
  return {schemaVersion:1,symbol:'SOLUSDT',evaluationStartTime,splitTime,
    candleSHA256:hash(JSON.stringify(candles)),filters,
    note:'Diagnostic historical comparison, not an untouched holdout or proof of profitability. AI excluded. No settings, state or orders changed.',results};
}
async function main({ directory, offline = process.argv.includes('--offline') } = {}) {
  const dir=directory || path.join(__dirname,'../data/sol-mtf-comparison');
  const cache=path.join(dir,'dataset.json');
  let dataset;
  if (offline) dataset=JSON.parse(fs.readFileSync(cache,'utf8'));
  else {
    const [candles,filters]=await Promise.all([
      getFuturesHistoricalCandles('SOLUSDT','15m',20000,1793332799999),
      getFuturesSymbolFilters('SOLUSDT'),
    ]);
    // Validate before persisting a download.
    aggregate4h(candles);
    if (candles.at(-1)?.closeTime !== 1793332799999) throw new Error('Download did not reach the frozen comparison end date');
    dataset={candles,filters,candleSHA256:hash(JSON.stringify(candles))};
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(cache,JSON.stringify(dataset));
  }
  if (dataset.candleSHA256 !== hash(JSON.stringify(dataset.candles))) throw new Error('Dataset checksum mismatch; rerun without --offline');
  const report=await compare(dataset.candles,dataset.filters);
  report.sourceSHA256=hash(['compareMtf.js','multiTimeframe.js','futuresBacktester.js','futuresEngine.js','direction.js','strategies.js','indicators.js','metrics.js','riskGuard.js','riskManager.js','tradeDiagnostics.js'].filter(f=>fs.existsSync(path.join(__dirname,f))).map(f=>f+'\n'+fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n'));
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
  const diagnostics = { schemaVersion: 1, symbol: report.symbol, candleSHA256: report.candleSHA256,
    sourceSHA256: report.sourceSHA256, evaluationStartTime: report.evaluationStartTime, splitTime: report.splitTime,
    scenarios: report.results.map(({ label, result }) => ({ label, symbol: result.config.symbol, interval: result.config.interval,
      segments: Object.fromEntries(['full', 'inSample', 'outSample'].map(key => [key, result[key].diagnostics])) })) };
  fs.writeFileSync(path.join(dir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
  console.table(diagnostics.scenarios.map(s => { const d = s.segments.outSample.summary; return {
    Scenario: s.label, OOSNet: d.netPnL.toFixed(2), Fees: d.fees.toFixed(2), Funding: d.funding.toFixed(2),
    Stops: d.stopExits, MedianHours: d.medianHoldingHours?.toFixed(2), WithoutBest: d.netWithoutLargestWinner.toFixed(2),
    Recovery: `${d.recoveriesInCompleteWindows}/${d.completeRecoveryWindows}` }; }));
  console.table(report.results.map(({label,result:r})=>({Scenario:label,FullReturn:r.full.metrics.returnPct.toFixed(2),OOSReturn:r.outSample.metrics.returnPct.toFixed(2),OOSTrades:r.outSample.metrics.trades,OOSPF:r.outSample.metrics.profitFactor,OOSDrawdown:r.outSample.metrics.maxDrawdownPct.toFixed(2)})));
  console.log(report.note+'\nReport: '+path.join(dir,'report.json')+'\nDashboard diagnostics: '+path.join(dir,'diagnostics.json'));
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={compare,main};
