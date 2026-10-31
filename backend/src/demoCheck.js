const {BinanceDemoClient,DEMO_URL}=require('./binanceDemo');
async function check(client=new BinanceDemoClient()) {
  await client.syncTime();const [account,filters]=await Promise.all([client.account(),client.filters()]);
  return {mode:'FUTURES_DEMO',endpoint:DEMO_URL,readOnlyCheck:true,productionOrdersEnabled:false,
    wallet:account.wallet,available:account.available,openPositions:account.positions.filter(p=>Number(p.positionAmt)!==0).map(p=>({symbol:p.symbol,quantity:Number(p.positionAmt),positionSide:p.positionSide})),openOrders:account.orders.length,openConditionalOrders:account.algos.length,filters};
}
if(require.main===module)check().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={check};
