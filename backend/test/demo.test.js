const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {BinanceDemoClient,DEMO_URL,step}=require('../src/binanceDemo');
const {DemoRunner}=require('../src/demoRunner');
const {mode,demoConfig}=require('../src/demoConfig');
const {check}=require('../src/demoCheck');
const strategy={name:'Demo test',engine:{trailing:false,rewardRiskRatio:null},prepare:()=>null,analyze:(_ctx,c,s,i)=>({signal:'BUY',indicators:{atr14:s.atr14[i]},reasons:['fixture']})};
function fakeExchange(){
 const e={wallet:10000,price:100,qty:0,orders:new Map(),algos:new Map(),fills:[],income:[],requests:[],leverage:20,marginType:'CROSSED',next:10,closed:Math.floor(Date.now()/900000)*900000-900001,foreignOrders:[],foreignAlgos:[],hedge:false,multi:false,badStop:false,lostEntry:false,lagEntry:false,partial:false};
 const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
 e.fetch=async(raw,options)=>{
  const u=new URL(raw),p=Object.fromEntries(u.searchParams);e.requests.push({method:options.method,path:u.pathname,p,headers:options.headers});
  assert.equal(u.origin,DEMO_URL);assert.equal(options.redirect,'error');
  if(!['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/klines','/fapi/v1/ticker/price','/fapi/v1/ticker/24hr'].includes(u.pathname)){
   const q=new URLSearchParams(u.search);q.delete('signature');assert.equal(p.signature,crypto.createHmac('sha256','demo-secret').update(q.toString()).digest('hex'));assert.equal(options.headers['X-MBX-APIKEY'],'demo-key');
  }
  const key=`${options.method} ${u.pathname}`;
  if(key==='GET /fapi/v1/time')return response({serverTime:Date.now()});
  if(key==='GET /fapi/v1/exchangeInfo')return response({symbols:[{symbol:'SOLUSDT',status:'TRADING',contractType:'PERPETUAL',filters:[{filterType:'LOT_SIZE',stepSize:'0.01',minQty:'0.01',maxQty:'1000'},{filterType:'MARKET_LOT_SIZE',stepSize:'0.01',minQty:'0.01',maxQty:'500'},{filterType:'PRICE_FILTER',tickSize:'0.01',minPrice:'0.01',maxPrice:'100000'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]});
  if(key==='GET /fapi/v1/klines')return response(Array.from({length:501},(_,i)=>{const start=e.closed-((501-i)*900000)+1;return [start,'100','101','99','100','1',start+899999];}));
  if(key==='GET /fapi/v1/ticker/price')return response({price:String(e.price)});
  if(key==='GET /fapi/v1/ticker/24hr')return response([{symbol:'SOLUSDT',lastPrice:String(e.price),priceChangePercent:'0',quoteVolume:'100000'}]);
  if(key==='GET /fapi/v1/positionSide/dual')return response({dualSidePosition:e.hedge});
  if(key==='GET /fapi/v1/multiAssetsMargin')return response({multiAssetsMargin:e.multi});
  if(key==='GET /fapi/v2/account')return response({canTrade:true,totalWalletBalance:String(e.wallet),availableBalance:String(e.wallet-e.qty*e.price)});
  if(key==='GET /fapi/v3/positionRisk')return response(e.qty?[{symbol:'SOLUSDT',positionSide:'BOTH',positionAmt:String(e.qty),entryPrice:String(e.entryPrice||100),markPrice:String(e.price),notional:String(e.qty*e.price),positionInitialMargin:String(e.qty*e.price),unRealizedProfit:String((e.price-(e.entryPrice||100))*e.qty),liquidationPrice:'0'}]:[]);
  if(key==='GET /fapi/v1/openOrders')return response([...e.orders.values()].filter(o=>['NEW','PARTIALLY_FILLED'].includes(o.status)).concat(e.foreignOrders));
  if(key==='GET /fapi/v1/openAlgoOrders')return response([...e.algos.values()].filter(o=>o.algoStatus==='NEW').concat(e.foreignAlgos));
  if(key==='GET /fapi/v1/symbolConfig')return response([{symbol:'SOLUSDT',marginType:e.marginType,leverage:e.leverage}]);
  if(key==='POST /fapi/v1/marginType'){e.marginType=p.marginType;return response({code:200});}
  if(key==='POST /fapi/v1/leverage'){e.leverage=+p.leverage;return response({leverage:e.leverage});}
  if(key==='POST /fapi/v1/order'){
   if(p.side==='SELL'&&!e.qty)return response({code:-2022,msg:'ReduceOnly order rejected'},400);
   const orderId=e.next++,qty=p.side==='BUY'?(e.partial?+.1:+p.quantity):Math.min(+p.quantity,e.qty),price=e.price,fee=qty*price*.0005;
   const order={symbol:'SOLUSDT',side:p.side,clientOrderId:p.newClientOrderId,orderId,executedQty:String(qty),avgPrice:String(price),cumQuote:String(qty*price),time:Date.now(),updateTime:Date.now(),status:e.partial&&p.side==='BUY'?'PARTIALLY_FILLED':'FILLED',reduceOnly:p.reduceOnly==='true'};
   e.orders.set(p.newClientOrderId,order);
   const gross=p.side==='SELL'?(price-e.entryPrice)*qty:0;
   e.wallet+=gross-fee;e.qty=p.side==='BUY'?e.qty+qty:Math.max(0,e.qty-qty);if(p.side==='BUY')e.entryPrice=price;
   e.fills.push({symbol:'SOLUSDT',orderId,id:e.next++,side:p.side,price:String(price),qty:String(qty),realizedPnl:String(gross),commission:String(fee),commissionAsset:'USDT',time:order.time});
   if(e.lostEntry&&p.side==='BUY'){e.lostEntry=false;return response({msg:'Unknown error'},503);}
   return response(order);
  }
  if(key==='GET /fapi/v1/order'){
   if(e.lagEntry&&e.orders.get(p.origClientOrderId)?.side==='BUY')return response({code:-2013,msg:'Order does not exist'},400);
   return e.orders.has(p.origClientOrderId)?response(e.orders.get(p.origClientOrderId)):response({code:-2013,msg:'Order does not exist'},400);
  }
  if(key==='DELETE /fapi/v1/order'){const o=e.orders.get(p.origClientOrderId);o.status='CANCELED';return response(o);}
  if(key==='POST /fapi/v1/algoOrder'){
   if(e.badStop)return response({code:-2021,msg:'Order would immediately trigger'},400);
   const o={symbol:'SOLUSDT',clientAlgoId:p.clientAlgoId,side:p.side,orderType:p.type,positionSide:p.positionSide,closePosition:true,workingType:p.workingType,triggerPrice:p.triggerPrice,algoStatus:'NEW',algoId:e.next++};e.algos.set(p.clientAlgoId,o);return response(o);
  }
  if(key==='GET /fapi/v1/algoOrder')return e.algos.has(p.clientAlgoId)?response(e.algos.get(p.clientAlgoId)):response({code:-2013,msg:'Algo does not exist'},400);
  if(key==='DELETE /fapi/v1/algoOrder'){const o=e.algos.get(p.clientAlgoId);o.algoStatus='CANCELED';return response(o);}
  if(key==='GET /fapi/v1/userTrades')return response(e.fills.filter(f=>f.time>=+p.startTime&&f.time<=+p.endTime));
  if(key==='GET /fapi/v1/income')return response(e.income.filter(f=>f.time>=+p.startTime&&f.time<=+p.endTime));
  throw Error('Unexpected request '+key);
 };
 e.client=new BinanceDemoClient({apiKey:'demo-key',apiSecret:'demo-secret',fetchImpl:e.fetch});return e;
}
async function fixture(t,{entries=true,exchange=fakeExchange()}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-runner-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const r=new DemoRunner('SOLUSDT',{direction:'LONG',leverage:1,budget:1000,strategy,interval:'15m',client:exchange.client,stateFile:path.join(dir,'state.json'),lockFile:false,aiFilter:{enabled:false},portfolioGate:()=>({allowed:true})});
 r.onEvent=()=>{};r.maxEntryAgeMs=1200000;r.config.allowEntries=entries;await r.init();return {r,e:exchange,dir};
}
test('mode rejects live values; demo profile rejects shorts, wrong symbols, leverage and unsupported exits',()=>{
 assert.equal(mode(), 'FUTURES_PAPER');assert.throws(()=>mode('LIVE'),/live/);
 const base={symbol:'SOLUSDT',direction:'LONG',leverage:1,budget:1000,strategy,interval:'15m'};
 for(const change of [{symbol:'BTCUSDT'},{direction:'SHORT'},{leverage:5},{strategy:{engine:{trailing:true}}}])assert.throws(()=>demoConfig({...base,...change}));
});
test('client uses only demo host, signs private calls, rejects unsafe paths and redacts credentials',async()=>{
 assert.throws(()=>new BinanceDemoClient({baseUrl:'https://fapi.binance.com'}),/fixed/);
 const e=fakeExchange();await e.client.syncTime();await e.client.account();
 await assert.rejects(e.client.request('GET','https://fapi.binance.com'),/Unsupported/);
 await assert.rejects(e.client.request('POST','/fapi/v1/order',{symbol:'SOLUSDT',side:'SELL',type:'MARKET'}),/Only identified/);
 await assert.rejects(e.client.request('POST','/fapi/v1/leverage',{symbol:'SOLUSDT',leverage:2}),/1x/);
 const client=new BinanceDemoClient({apiKey:'sensitive-key',apiSecret:'sensitive-secret',fetchImpl:async()=>({ok:false,status:400,json:async()=>({code:-1,msg:'sensitive-key sensitive-secret'})})});
 await assert.rejects(client.request('GET','/fapi/v2/account'),error=>!error.message.includes('sensitive-key')&&!error.message.includes('sensitive-secret'));
 await assert.rejects(new BinanceDemoClient().account(),/BINANCE_DEMO/);
});
test('clock and connection check make no mutations and expose no credentials',async()=>{
 const e=fakeExchange(),view=await check(e.client);assert.equal(view.readOnlyCheck,true);assert.equal(view.endpoint,DEMO_URL);
 assert.ok(e.requests.every(r=>r.method==='GET'));assert.ok(!JSON.stringify(view).includes('demo-secret'));
 e.hedge=true;await assert.rejects(check(e.client),/One-way/);
});
test('rounding supports non-power-of-ten steps and tightens long stop upward',()=>{
 assert.equal(step(1.239,.05),1.2);assert.equal(step(96.001,.01,'ceil'),96.01);assert.equal(step(.123456,.0001),.1234);
});
test('default entry-disabled runner connects without orders or paper-state changes',async t=>{
 const {r,e,dir}=await fixture(t,{entries:false});await r.openPosition({indicators:{atr14:2}});
 assert.equal(e.qty,0);assert.ok(e.requests.every(r=>r.method==='GET'));assert.equal(r.engine.cfg.startingBalance,1000);
 const saved=fs.readFileSync(path.join(dir,'state.json'),'utf8');assert.ok(!saved.includes('demo-secret'));assert.ok(!saved.includes('demo-key'));
});
test('market entry uses actual fill, creates verified rounded stop, and exchange close reconciles fees once',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});
 assert.equal(e.leverage,1);assert.equal(e.marginType,'ISOLATED');assert.equal(r.engine.position.quantity,.24);assert.equal(r.engine.position.entryPrice,100);
 assert.equal(r.demoSnapshot().protection,'VERIFIED');assert.equal([...e.algos.values()][0].triggerPrice,'96');
 e.price=110;await r.closeDemo();assert.equal(e.qty,0);assert.equal(r.state.trades.length,1);
 const trade=r.state.trades[0];assert.equal(trade.grossPnL,2.4);assert.ok(Math.abs(trade.netPnL-(2.4-.012-.0132))<1e-10);
 await r.reconcile(true);assert.equal(r.state.trades.length,1);assert.equal([...e.algos.values()][0].algoStatus,'CANCELED');
});
test('lost entry response and temporarily missing query remain journaled and never resubmit on restart',async t=>{
 const e=fakeExchange(),{r}=await fixture(t,{exchange:e});e.lostEntry=true;e.lagEntry=true;
 await assert.rejects(r.openPosition({indicators:{atr14:2}}),/does not exist/);assert.ok(r.state.entryOperation);
 const saved=JSON.parse(fs.readFileSync(r.stateFile));assert.ok(saved.entryOperation.id);
 e.lagEntry=false;
 const restored=new DemoRunner('SOLUSDT',{direction:'LONG',leverage:1,budget:1000,strategy,interval:'15m',client:e.client,stateFile:r.stateFile,lockFile:false,aiFilter:{enabled:false},portfolioGate:()=>({allowed:true})});restored.onEvent=()=>{};
 await restored.init();await restored.reconcile(true);
 assert.equal(e.requests.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.side==='BUY').length,1);
 assert.equal(restored.demoSnapshot().protection,'VERIFIED');
});
test('rejected protective stop triggers reduce-only flatten and blocks subsequent entries',async t=>{
 const {r,e}=await fixture(t);e.badStop=true;await r.openPosition({indicators:{atr14:2}});await r.reconcile(true);
 assert.equal(e.qty,0);assert.ok(r.state.fault);assert.equal(r.state.trades.length,1);
 assert.ok(e.requests.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.side==='SELL').every(x=>x.p.reduceOnly==='true'));
 await assert.rejects(r.openPosition({indicators:{atr14:2}}),/Protection/);
});
test('partial entry cancels remainder, protects/flatttens received quantity and never opens a short',async t=>{
 const {r,e}=await fixture(t);e.partial=true;await r.openPosition({indicators:{atr14:2}});await r.reconcile(true);
 assert.equal(e.qty,0);assert.ok(r.state.fault);assert.equal(r.state.trades.length,1);
 assert.ok(e.requests.some(x=>x.method==='DELETE'&&x.path==='/fapi/v1/order'));
});
test('foreign positions/orders and corrupt state fail closed without adoption or cancellation',async t=>{
 const e=fakeExchange();e.qty=.2;await assert.rejects(fixture(t,{exchange:e}),/Unowned/);assert.ok(e.requests.every(r=>r.method==='GET'));
 const e2=fakeExchange();e2.foreignOrders=[{symbol:'SOLUSDT',clientOrderId:'manual'}];await assert.rejects(fixture(t,{exchange:e2}),/Foreign/);
 const {r}=await fixture(t);fs.writeFileSync(r.stateFile,'{broken');r.initialized=false;await assert.rejects(r.init(),/Cannot safely load/);
});
test('below-minimum sizing and missing portfolio gate never send an entry',async t=>{
 const {r,e}=await fixture(t);r.config.maxNotional=1;await assert.rejects(r.openPosition({indicators:{atr14:2}}),/exchange minimum/);
 assert.equal(e.qty,0);r.config.maxNotional=25;r.portfolioGate=()=>({allowed:false,reason:'Blocked'});await r.openPosition({indicators:{atr14:2}});assert.equal(e.qty,0);
});
test('first candle checkpoints; overlapping ticks process a later candle once and AI veto does not block exit management',async t=>{
 const {r,e}=await fixture(t);await r.tick();assert.equal(e.qty,0);const first=r.lastProcessed;
 e.closed+=900000;await Promise.all([r.tick(),r.tick()]);assert.ok(r.lastProcessed>first);
 assert.equal(e.requests.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.side==='BUY').length,1);
 r.aiFilter={enabled:true,evaluate:async()=>({allowed:false,reason:'fixture veto'})};e.price=110;await r.closeDemo();assert.equal(e.qty,0);
});
test('profits do not trip the entry-notional cap as mark price rises',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});e.price=110;
 await r.reconcile(true);assert.ok(e.qty>0);assert.equal(r.state.closeOperation,null);assert.equal(r.state.fault,null);
});
test('fixed notional cap limits a large demo wallet; completed round trip uses exchange funding',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});assert.ok(e.qty*100<=25);
 const fundingTime=Date.now();e.income.push({symbol:'SOLUSDT',incomeType:'FUNDING_FEE',income:'-0.03',asset:'USDT',time:fundingTime});e.wallet-=.03;
 await r.closeDemo();const t0=r.state.trades[0];assert.equal(t0.funding,.03);assert.ok(Math.abs(t0.netPnL-(t0.grossPnL-t0.fees-.03))<1e-10);
});
test('process lock blocks a second owner and key/profile mismatches cannot adopt state',async t=>{
 const {r,e}=await fixture(t);r.lockFile=path.join(path.dirname(r.stateFile),'demo.lock');r.initialized=false;await r.init();
 const other=new DemoRunner('SOLUSDT',{direction:'LONG',leverage:1,budget:1000,strategy,interval:'15m',client:e.client,stateFile:r.stateFile,lockFile:true,aiFilter:{enabled:false}});
 other.lockFile=r.lockFile;await assert.rejects(other.init(),/Another demo process/);r.release();
 const saved=JSON.parse(fs.readFileSync(r.stateFile));saved.keyFingerprint='different';fs.writeFileSync(r.stateFile,JSON.stringify(saved));
 other.lockFile=null;await assert.rejects(other.init(),/profile\/key/);
});
test('shared quantity step respects both lot filters',()=>{
 const {commonStep}=require('../src/binanceDemo');assert.equal(commonStep(.25,.1),.5);assert.equal(commonStep(.01,0),.01);assert.equal(step(1.24,commonStep(.25,.1)),1);
});
test('history truncation and non-USDT commissions cannot silently finalize an inaccurate trade',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});e.fills[0].commissionAsset='BNB';
 await assert.rejects(r.closeDemo(),/USDT commission/);assert.ok(r.state.owned);assert.equal(r.state.trades.length,0);
});
test('stop execution is reconciled by its actual exchange order ID',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});const stop=[...e.algos.values()][0];
 const qty=e.qty,price=96,orderId=e.next++;const gross=(price-100)*qty,fee=price*qty*.0005;
 e.fills.push({symbol:'SOLUSDT',orderId,id:e.next++,side:'SELL',price:String(price),qty:String(qty),realizedPnl:String(gross),commission:String(fee),commissionAsset:'USDT',time:Date.now()});
 e.wallet+=gross-fee;e.qty=0;stop.algoStatus='FINISHED';stop.actualOrderId=String(orderId);
 await r.reconcile(true);assert.equal(r.state.trades[0].reason,'STOP LOSS');assert.equal(r.state.trades[0].stopOrderId,String(orderId));
});
test('authenticated API exposes demo mode/budget, serializes init and never exposes demo credentials',async t=>{
 const {spawn}=require('node:child_process'),net=require('node:net');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-api-'));let child;
 t.after(async()=>{if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(dir,{recursive:true,force:true});});
 const reserved=net.createServer();await new Promise(resolve=>reserved.listen(0,'127.0.0.1',resolve));const port=reserved.address().port;await new Promise(resolve=>reserved.close(resolve));
 const modulePath=path.resolve(__dirname,'../src/binanceDemo.js');
 fs.writeFileSync(path.join(dir,'mock.cjs'),`const crypto=require('crypto'),assert=require('node:assert/strict');const {BinanceDemoClient,DEMO_URL}=require(${JSON.stringify(modulePath)});const fakeExchange=${fakeExchange.toString()};const exchange=fakeExchange();global.fetch=exchange.fetch;`);
 child=spawn(process.execPath,['-r',path.join(dir,'mock.cjs'),path.resolve(__dirname,'../src/api.js')],{cwd:dir,env:{...process.env,API_HOST:'127.0.0.1',API_PORT:String(port),API_KEY:'local-demo-test-api-key',BOT_MODE:'FUTURES_DEMO',BOT_SYMBOL:'SOLUSDT',DIRECTION:'LONG',LEVERAGE:'1',STRATEGY:'Pure Breakout 40/20',INTERVAL:'4h',START_BALANCE:'1000',RISK_PERCENT:'.0025',MAX_MARGIN_PERCENT:'.1',BINANCE_DEMO_API_KEY:'demo-key',BINANCE_DEMO_API_SECRET:'demo-secret',DEMO_ALLOW_ENTRIES:'0',AUTOSTART:'0',AI_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>{logs+=d});child.stderr.on('data',d=>{logs+=d});
 const headers={'X-API-Key':'local-demo-test-api-key'};const url=`http://127.0.0.1:${port}`;
 let ready=false;for(let i=0;i<80;i++){try{const r=await fetch(url+'/api/health');if(r.ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}
 assert.ok(ready,logs);
 const statuses=await Promise.all([fetch(url+'/api/status',{headers}).then(r=>r.json()),fetch(url+'/api/status',{headers}).then(r=>r.json())]);
 const s=statuses[0];assert.equal(s.mode,'FUTURES_DEMO');assert.equal(s.liveOrdersEnabled,false);assert.equal(s.demo.accountWallet,10000);assert.equal(s.portfolio.startingBalance,1000);assert.equal(s.demo.allowEntries,false);
 assert.ok(!JSON.stringify(s).includes('demo-secret'));assert.ok(!JSON.stringify(s).includes('demo-key'));
 const unauth=await fetch(url+'/api/demo/close',{method:'POST'});assert.equal(unauth.status,401);
 const close=await fetch(url+'/api/demo/close',{method:'POST',headers});assert.equal(close.status,200);
});
test('explicit smoke-test command completes a capped round trip using only demo requests',t=>{
 const {execFileSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-smoke-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const modulePath=path.resolve(__dirname,'../src/binanceDemo.js'),smoke=path.resolve(__dirname,'../src/demoSmoke.js');
 fs.writeFileSync(path.join(dir,'mock.cjs'),`const crypto=require('crypto'),assert=require('node:assert/strict');const {BinanceDemoClient,DEMO_URL}=require(${JSON.stringify(modulePath)});const fakeExchange=${fakeExchange.toString()};const exchange=fakeExchange();global.fetch=exchange.fetch;`);
 const output=execFileSync(process.execPath,['-r',path.join(dir,'mock.cjs'),smoke],{cwd:dir,env:{...process.env,BOT_SYMBOL:'SOLUSDT',DIRECTION:'LONG',LEVERAGE:'1',STRATEGY:'Pure Breakout 40/20',INTERVAL:'4h',START_BALANCE:'1000',RISK_PERCENT:'.0025',MAX_MARGIN_PERCENT:'.1',BINANCE_DEMO_API_KEY:'demo-key',BINANCE_DEMO_API_SECRET:'demo-secret',DEMO_ALLOW_ENTRIES:'1',AI_ENABLED:'0'},encoding:'utf8'});
 assert.match(output,/"completed": true/);assert.match(output,/"reason": "MANUAL DEMO CLOSE"/);assert.ok(!output.includes('demo-secret'));
 const stateName=fs.readdirSync(path.join(dir,'data')).find(f=>f.endsWith('.json')&&f.startsWith('state_demo'));
 const state=JSON.parse(fs.readFileSync(path.join(dir,'data',stateName)));assert.equal(state.owned,null);assert.equal(state.trades.length,1);
});
test('a portfolio halt closes an owned demo position even when new entries are disabled',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});r.config.allowEntries=false;
 r.portfolioUpdate=()=>({allowed:false,reason:'fixture portfolio halt'});
 await r.reconcile(true);await r.reconcile(true);assert.equal(e.qty,0);assert.equal(r.state.trades[0].reason,'PORTFOLIO RISK HALT');
});
test('stale entry signals are consumed without submitting a new order',async t=>{
 const {r,e}=await fixture(t);await r.tick();e.closed+=900000;r.maxEntryAgeMs=0;
 await r.tick();assert.equal(e.qty,0);assert.match(r.lastNote,/older than/);
});
test('a temporarily flat position snapshot cannot cancel the only stop before SELL fills prove closure',async t=>{
 const {r,e}=await fixture(t);await r.openPosition({indicators:{atr14:2}});const stop=[...e.algos.values()][0];
 const qty=e.qty;e.qty=0;
 await assert.rejects(r.reconcile(true),/complete exchange fills/);
 assert.equal(stop.algoStatus,'NEW');assert.equal(r.state.trades.length,0);e.qty=qty;
 await r.reconcile(true);assert.equal(r.demoSnapshot().protection,'VERIFIED');
});
test('confirmed entry fills receive a stop even when position snapshots lag',async t=>{
 const {r,e}=await fixture(t);const original=e.fetch;e.hidePosition=true;
 e.client.fetch=async(raw,options)=>{const response=await original(raw,options);if(new URL(raw).pathname==='/fapi/v3/positionRisk'&&e.hidePosition)return {ok:true,status:200,json:async()=>[]};return response;};
 await assert.rejects(r.openPosition({indicators:{atr14:2}}),/complete exchange fills/);
 assert.equal([...e.algos.values()][0].algoStatus,'NEW');assert.ok(e.qty>0);assert.equal(r.state.trades.length,0);
 e.hidePosition=false;await r.reconcile(true);assert.equal(r.demoSnapshot().protection,'VERIFIED');
});
test('transient read network failures and 5xx responses retry once with a fresh signature',async()=>{
 let count=0,time=100000;const signed=[];
 const client=new BinanceDemoClient({apiKey:'demo-key',apiSecret:'demo-secret',now:()=>++time,wait:async()=>{},fetchImpl:async raw=>{
  signed.push(new URL(raw).searchParams.get('timestamp'));if(++count===1)throw Error('connection reset');return {ok:true,status:200,json:async()=>({ok:true})};
 }});
 assert.deepEqual(await client.request('GET','/fapi/v2/account'),{ok:true});assert.equal(count,2);assert.notEqual(signed[0],signed[1]);
 count=0;client.fetch=async()=>++count===1?{ok:false,status:503,json:async()=>({msg:'Unavailable'})}:{ok:true,status:200,json:async()=>({ok:true})};
 await client.request('GET','/fapi/v2/account');assert.equal(count,2);
});
test('persistent read failures stop after two attempts and never claim an uncertain submitted order',async()=>{
 let count=0;
 const client=new BinanceDemoClient({wait:async()=>{},fetchImpl:async()=>{count++;throw Error('private detail must not leak');}});
 await assert.rejects(client.request('GET','/fapi/v1/time'),e=>e.uncertain===false&&e.message.includes('GET /fapi/v1/time')&&!e.message.includes('saved client ID')&&!e.message.includes('private detail'));
 assert.equal(count,2);
});
test('mutations never retry after network or server failures',async()=>{
 let count=0;const client=new BinanceDemoClient({apiKey:'demo-key',apiSecret:'demo-secret',wait:async()=>{},fetchImpl:async()=>{count++;throw Error('timeout');}});
 const order={symbol:'SOLUSDT',side:'BUY',type:'MARKET',positionSide:'BOTH',quantity:.1,newClientOrderId:'tbD-fixture'};
 await assert.rejects(client.request('POST','/fapi/v1/order',order),e=>e.uncertain===true&&e.message.includes('saved client ID'));assert.equal(count,1);
 count=0;client.fetch=async()=>{count++;return {ok:false,status:503,json:async()=>({msg:'Unknown error'})};};
 await assert.rejects(client.request('POST','/fapi/v1/order',order),e=>e.uncertain===true);assert.equal(count,1);
});
test('authentication, missing orders, bans and rate limits are not retried',async()=>{
 for(const status of [400,401,403,418,429]){
  let count=0;const client=new BinanceDemoClient({apiKey:'demo-key',apiSecret:'demo-secret',wait:async()=>{},fetchImpl:async()=>{count++;return {ok:false,status,json:async()=>({code:-2013,msg:'Request rejected'})};}});
  await assert.rejects(client.request('GET','/fapi/v1/order',{symbol:'SOLUSDT',origClientOrderId:'tbD-fixture'}));assert.equal(count,1);
 }
});
test('demo ticker fetch scopes to SOLUSDT and normalizes its single-object response',async()=>{
 let query;
 const client=new BinanceDemoClient({fetchImpl:async raw=>{query=new URL(raw);return {ok:true,status:200,json:async()=>({symbol:'SOLUSDT',lastPrice:'96',priceChangePercent:'1',quoteVolume:'1000'})};}});
 const rows=await client.tickers();assert.equal(query.searchParams.get('symbol'),'SOLUSDT');assert.equal(rows.length,1);assert.equal(rows[0].symbol,'SOLUSDT');
});
test('concurrent market scans share a single in-flight demo ticker request',async t=>{
 const {spawn}=require('node:child_process'),net=require('node:net');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'demo-ticker-api-'));let child;
 t.after(async()=>{if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(dir,{recursive:true,force:true});});
 const reserved=net.createServer();await new Promise(resolve=>reserved.listen(0,'127.0.0.1',resolve));const port=reserved.address().port;await new Promise(resolve=>reserved.close(resolve));
 const modulePath=path.resolve(__dirname,'../src/binanceDemo.js'),counter=path.join(dir,'counter.txt');
 fs.writeFileSync(path.join(dir,'mock.cjs'),`const crypto=require('crypto'),assert=require('node:assert/strict'),fs=require('fs');const {BinanceDemoClient,DEMO_URL}=require(${JSON.stringify(modulePath)});const fakeExchange=${fakeExchange.toString()};const exchange=fakeExchange();let count=0;global.fetch=async(raw,options)=>{if(new URL(raw).pathname==='/fapi/v1/ticker/24hr'){assert.equal(new URL(raw).searchParams.get('symbol'),'SOLUSDT');fs.writeFileSync(${JSON.stringify(counter)},String(++count));await new Promise(r=>setTimeout(r,100));}return exchange.fetch(raw,options);};`);
 child=spawn(process.execPath,['-r',path.join(dir,'mock.cjs'),path.resolve(__dirname,'../src/api.js')],{cwd:dir,env:{...process.env,API_HOST:'127.0.0.1',API_PORT:String(port),API_KEY:'local-demo-test-api-key',BOT_MODE:'FUTURES_DEMO',BOT_SYMBOL:'SOLUSDT',DIRECTION:'LONG',LEVERAGE:'1',STRATEGY:'Pure Breakout 40/20',INTERVAL:'4h',START_BALANCE:'1000',RISK_PERCENT:'.0025',MAX_MARGIN_PERCENT:'.1',BINANCE_DEMO_API_KEY:'demo-key',BINANCE_DEMO_API_SECRET:'demo-secret',DEMO_ALLOW_ENTRIES:'0',AUTOSTART:'0',AI_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>{logs+=d});child.stderr.on('data',d=>{logs+=d});const url=`http://127.0.0.1:${port}`;
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(url+'/api/health')).ok){ready=true;break;}}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,50));}assert.ok(ready,logs);
 const replies=await Promise.all(Array.from({length:5},()=>fetch(url+'/api/markets',{headers:{'X-API-Key':'local-demo-test-api-key'}})));
 assert.ok(replies.every(r=>r.ok),logs);assert.equal(fs.readFileSync(counter,'utf8'),'1');
});
