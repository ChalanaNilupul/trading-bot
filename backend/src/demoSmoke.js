// Explicit virtual-fund execution test; does not represent a strategy signal or call AI.
process.env.BOT_MODE='FUTURES_DEMO';
const {Runner,restorePortfolioRisk}=require('./index');
const {buildSeries}=require('./indicators');
async function main(){
  restorePortfolioRisk();const runner=new Runner('SOLUSDT');runner.allRunners=[runner];
  try {
    if(!runner.config.allowEntries)throw Error('Smoke test places demo orders. Set DEMO_ALLOW_ENTRIES=1 locally before running it.');
    await runner.init();
    if(runner.state.owned||runner.state.entryOperation||runner.state.closeOperation||runner.state.fault)throw Error('Smoke test requires a flat, reconciled bot with no fault');
    runner.lastPrice=await runner.client.price();
    const candles=await runner.client.candles('SOLUSDT',runner.config.interval,500);
    const atr=buildSeries(candles).atr14.at(-1);
    console.log('DEMO ONLY: testing capped market entry, exchange-held stop and reduce-only close. AI is excluded.');
    await runner.openPosition({indicators:{atr14:atr}});
    await runner.closeDemo();
    for(let i=0;i<3&&(runner.state.owned||runner.state.entryOperation||runner.state.closeOperation);i++){
      await new Promise(resolve=>setTimeout(resolve,1000));await runner.closeDemo();
    }
    if(runner.state.owned||runner.state.entryOperation||runner.state.closeOperation)throw Error('Reconciliation remains pending. Start the demo API to continue recovery; do not delete its state.');
    const trade=runner.state.trades.at(-1);
    if(!trade)throw Error('No complete demo round trip was recorded');
    console.log(JSON.stringify({mode:'FUTURES_DEMO',completed:true,trade},null,2));
  }catch(error){
    if(runner.initialized && runner.state.owned){try{await runner.closeDemo();}catch{console.error('Recovery is still pending; preserve demo state and restart the demo API.');}}
    throw error;
  }finally{runner.release();}
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
