const crypto=require('crypto');
const fs=require('fs');
const path=require('path');
const store=require('./store');
const {BinanceDemoClient,step,DEMO_URL}=require('./binanceDemo');
const {demoConfig}=require('./demoConfig');
const {RiskGuard}=require('./riskGuard');
const {AIEntryFilter}=require('./aiFilter');
const {buildSeries,WARMUP}=require('./indicators');
const {intervalMs}=require('./data');
const {validateBars}=require('./multiTimeframe');
const {createSingleFlight}=require('./singleFlight');
const TERMINAL=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH','REJECTED']);
const ACTIVE_STOP=new Set(['NEW']);
const id=()=>`tbD-${crypto.randomBytes(12).toString('hex')}`;
const num=v=>Number(v);
const bool=v=>v===true||v==='true';

class DemoRunner {
  constructor(symbol,options={}) {
    this.config=demoConfig({symbol,...options});this.symbol=symbol;this.direction='LONG';this.strategy=this.config.strategy;
    this.client=options.client||new BinanceDemoClient();this.aiFilter=options.aiFilter||new AIEntryFilter();this.portfolioGate=options.portfolioGate||(()=>({allowed:false,reason:'Portfolio gate unavailable'}));this.portfolioUpdate=options.portfolioUpdate||(()=>({allowed:true}));
    this.stateFile=options.stateFile||`data/state_demo_${symbol}_${this.config.interval}_${this.strategy.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.json`;
    this.tradeLog=`${this.stateFile}.trades.jsonl`;this.lockFile=options.lockFile===false?null:path.join(path.dirname(this.stateFile),'binance-demo.lock');
    this.profile=crypto.createHash('sha256').update(JSON.stringify({symbol,strategy:this.strategy.name,interval:this.config.interval,budget:this.config.budget,risk:this.config.risk,margin:this.config.margin,maxNotional:this.config.maxNotional})).digest('hex');
    this.state={schemaVersion:1,profile:this.profile,keyFingerprint:this.client.keyFingerprint,lastProcessed:null,initialWallet:null,entryOperation:null,closeOperation:null,owned:null,fault:null,trades:[],peak:this.config.budget,guard:null};
    this.maxEntryAgeMs=120000;this.lastPrice=null;this.lastProcessed=null;this.lastNote='Demo not connected';this.errors=0;this.initialized=false;this.accountView=null;
    const guard=new RiskGuard({maxDailyLossPct:.01,maxDrawdownPct:.05,maxConsecutiveLosses:3,cooldownMs:14400000,maxTradesPerDay:6,haltCooldownMs:null});
    const self=this;
    this.engine={cfg:{startingBalance:this.config.budget,riskPercent:this.config.risk,maxPositionPercent:this.config.margin,leverage:1},guard,trades:this.state.trades,position:null,pending:null,cash:this.config.budget,peak:this.config.budget,
      equity:()=>self.allocatedEquity(),unrealized:()=>self.engine.position?.unrealizedPnl||0,
      usedMargin:()=>self.engine.position?.margin||0,freeCollateral:()=>Math.max(0,Math.min(self.accountView?.available||0,self.allocatedEquity()-(self.engine.position?.margin||0)))};
    this.queue=Promise.resolve();
    this.tick=createSingleFlight(()=>this.serial(()=>this._tick()));this.reconcile=createSingleFlight(manage=>this._reconcile(manage));
  }
  serial(task){const next=this.queue.catch(()=>{}).then(task);this.queue=next;return next;}
  onEvent(event){if(event.type==='EXIT')store.appendLine(this.tradeLog,{symbol:this.symbol,...event.trade});console.log(`[${new Date().toISOString()}] DEMO ${this.symbol} ${event.type}: ${event.message}`);}
  emit(type,message,data={}){this.lastNote=message;this.onEvent({type,message,...data});}
  allocatedEquity(){return this.config.budget+(this.accountView&&this.state.initialWallet!==null?this.accountView.wallet-this.state.initialWallet:0)+(this.engine.position?.unrealizedPnl||0);}
  persist(){this.state.lastProcessed=this.lastProcessed;this.state.guard=this.engine.guard.toJSON();this.state.peak=this.engine.peak;store.save(this.stateFile,this.state);}
  acquireLock(){
    if(!this.lockFile)return;
    fs.mkdirSync(path.dirname(this.lockFile),{recursive:true});
    try{const fd=fs.openSync(this.lockFile,'wx');fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const pid=Number(fs.readFileSync(this.lockFile,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid demo process lock; inspect it manually');
      try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH'){fs.unlinkSync(this.lockFile);return this.acquireLock();}throw e;}
      throw Error('Another demo process owns this data directory; use only npm run api OR npm run demo');
    }
    this.exitListener=()=>this.release();process.once('exit',this.exitListener);
  }
  release(){if(this.lockFile&&this.exitListener){if(fs.existsSync(this.lockFile)&&fs.readFileSync(this.lockFile,'utf8')===String(process.pid))fs.unlinkSync(this.lockFile);process.removeListener('exit',this.exitListener);this.exitListener=null;}}
  async init(){
    if(this.initialized)return;
    this.acquireLock();
    try{
      const saved=store.load(this.stateFile);
      if(saved){if(saved.schemaVersion!==1||saved.profile!==this.profile||saved.keyFingerprint!==this.client.keyFingerprint)throw Error('Demo state profile/key differs; restore the original settings and reconcile before switching profiles');this.state=saved;}
      this.lastProcessed=this.state.lastProcessed;this.engine.trades=this.state.trades;
      if(this.state.guard)this.engine.guard.restore(this.state.guard);this.engine.peak=this.state.peak;
      await this.client.syncTime();this.filters=await this.client.filters();await this.reconcile(false);
      this.initialized=true;this.firstTick=true;
    }catch(error){this.release();throw error;}
  }
  async queryEntry(manage){
    const op=this.state.entryOperation;if(!op)return;
    const order=await this.client.request('GET','/fapi/v1/order',{symbol:this.symbol,origClientOrderId:op.id});
    if(order.clientOrderId!==op.id||order.side!=='BUY'||order.symbol!==this.symbol)throw Error('Entry order identity mismatch');
    const qty=num(order.executedQty),price=num(order.avgPrice)||num(order.cumQuote)/qty;
    if(!Number.isFinite(qty)||qty<0||qty>op.quantity+1e-8)throw Error('Invalid demo entry fill quantity');
    if(qty>0){
      if(!Number.isFinite(price)||price<=0)throw Error('Entry filled without a valid exchange average price');
      const owned=this.state.owned||{entryId:op.id,entryTime:num(order.time||order.updateTime),entryOrderId:order.orderId,stopDistance:op.stopDistance,stopId:id(),stopSubmitted:false,closeOrderIds:[],stopPrice:step(price-op.stopDistance,this.filters.tickSize,'ceil')};
      owned.entryPrice=price;owned.quantity=qty;this.state.owned=owned;
      if(!owned.guardRecorded){this.engine.guard.recordEntry();owned.guardRecorded=true;this.emit('ENTRY',`Exchange filled LONG ${qty} SOL at ${price}; awaiting stop verification`);}
    }
    if(!TERMINAL.has(order.status)){
      if(qty>0){this.state.exitReason='PARTIAL FILL';this.state.fault='Partial entry: cancel remainder and flatten received quantity';}
      if(manage&&!op.cancelRequested){op.cancelRequested=true;this.persist();try{await this.client.request('DELETE','/fapi/v1/order',{symbol:this.symbol,origClientOrderId:op.id});}catch(error){this.emit('GUARD',error.message);}}
    }else{
      this.state.entryOperation=null;
      if(!qty)this.state.fault='Entry ended without a fill; inspect before resetting the halt';
    }
    this.persist();
  }
  async queryClose(){
    const op=this.state.closeOperation;if(!op)return;
    const order=await this.client.request('GET','/fapi/v1/order',{symbol:this.symbol,origClientOrderId:op.id});
    if(order.clientOrderId!==op.id||order.side!=='SELL'||order.symbol!==this.symbol||!bool(order.reduceOnly))throw Error('Close order identity/reduce-only mismatch');
    if(!this.state.owned.closeOrderIds.some(v=>String(v)===String(order.orderId)))this.state.owned.closeOrderIds.push(order.orderId);
    if(TERMINAL.has(order.status))this.state.closeOperation=null;
    this.persist();
  }
  async stopInfo(){
    const p=this.state.owned;if(!p||!p.stopSubmitted||p.stopRejected)return null;
    const order=await this.client.request('GET','/fapi/v1/algoOrder',{clientAlgoId:p.stopId});
    if(order.clientAlgoId!==p.stopId||order.symbol!==this.symbol||order.side!=='SELL'||order.orderType!=='STOP_MARKET'||order.positionSide!=='BOTH'||!bool(order.closePosition)||order.workingType!=='MARK_PRICE'||Math.abs(num(order.triggerPrice)-p.stopPrice)>this.filters.tickSize/10)throw Error('Protective stop identity/settings mismatch');
    if(order.actualOrderId)p.stopActualOrderId=order.actualOrderId;
    return order;
  }
  validateOwnership(account){
    const known=new Set([this.state.entryOperation?.id,this.state.closeOperation?.id,this.state.owned?.entryId]);
    if(account.orders.some(o=>o.symbol!==this.symbol||!known.has(o.clientOrderId)))throw Error('Foreign open order detected; use a dedicated demo account and reconcile manually');
    if(account.algos.some(o=>o.symbol!==this.symbol||o.clientAlgoId!==this.state.owned?.stopId))throw Error('Foreign conditional order detected; refusing to modify it');
    const positions=account.positions.filter(p=>num(p.positionAmt)!==0);
    if(positions.some(p=>p.symbol!==this.symbol||p.positionSide!=='BOTH'||num(p.positionAmt)<0)||positions.length>1)throw Error('Unsupported/foreign position detected; demo is SOLUSDT LONG only');
    const position=positions[0]||null;
    if(position&&!this.state.owned)throw Error('Unowned SOLUSDT position detected; it will not be adopted or closed');
    if(position&&(!Number.isFinite(num(position.positionAmt))||num(position.positionAmt)>this.state.owned.quantity+1e-8))throw Error('Exchange quantity exceeds this bot’s recorded fills; reconcile manually');
    return position;
  }
  async _reconcile(manage=false){
    await this.queryEntry(manage);await this.queryClose();
    const account=await this.client.account();const remote=this.validateOwnership(account);this.accountView=account;
    if(this.state.initialWallet===null){if(remote||account.orders.length||account.algos.length)throw Error('First demo connection requires a flat account with no orders');this.state.initialWallet=account.wallet;}
    const p=this.state.owned;
    if(remote&&(account.symbolConfig.marginType!=="ISOLATED"||num(account.symbolConfig.leverage)!==1)){this.state.fault="Owned position configuration is no longer 1x isolated";this.state.exitReason="ACCOUNT CONFIGURATION CHANGED";}
    this.protection=remote?'UNVERIFIED':'FLAT';
    this.engine.position=remote?{...p,side:'LONG',entryTime:p.entryTime,entryPrice:num(remote.entryPrice),quantity:num(remote.positionAmt),margin:num(remote.positionInitialMargin)||num(remote.notional),leverage:num(account.symbolConfig.leverage),stopPrice:p.stopPrice,initialStop:p.stopPrice,targetPrice:null,fundingPaid:null,liquidationPrice:num(remote.liquidationPrice),unrealizedPnl:num(remote.unRealizedProfit),notional:Math.abs(num(remote.notional))}:null;
    if(remote){
      this.lastPrice=num(remote.markPrice);
      if(![this.lastPrice,num(remote.entryPrice),num(remote.unRealizedProfit)].every(Number.isFinite)||this.lastPrice<=0)throw Error('Invalid exchange position/mark price');
    }
    this.engine.cash=this.allocatedEquity()-(this.engine.position?.unrealizedPnl||0)-(this.engine.position?.margin||0);
    this.engine.pending=this.state.entryOperation||this.state.closeOperation;
    this.engine.peak=Math.max(this.engine.peak,this.allocatedEquity());
    for(const event of this.engine.guard.update(this.allocatedEquity(),Date.now()))this.emit('GUARD',event.message);
    const portfolioStatus=this.portfolioUpdate(this.allocatedEquity());
    if(remote&&portfolioStatus.allowed===false){this.state.exitReason="PORTFOLIO RISK HALT";this.emit("GUARD",portfolioStatus.reason||this.state.exitReason);}
    if(remote&&manage){
      if(this.state.owned.quantity*this.state.owned.entryPrice>this.config.maxNotional*1.01){this.state.fault="Exchange fill exceeds demo cap";this.state.exitReason="CAP EXCEEDED";}
      try{await this.ensureStop();}catch(error){this.state.fault=`Protection unverified: ${error.message}`;this.state.exitReason='PROTECTION FAILURE';this.persist();this.emit('GUARD',this.state.fault);}
      if(this.engine.guard.state.halted){this.state.exitReason='RISK HALT';this.persist();}
      if(this.state.exitReason)await this.closePosition(this.state.exitReason);
    } else if (!remote && p && manage) {
      // A confirmed fill may precede the position endpoint. Protect known filled quantity
      // without waiting for that snapshot, and never cancel protection merely because
      // one position snapshot says flat. Settlement requires matching SELL fills below.
      if (!p.stopSubmitted && !p.stopRejected) {
        this.lastPrice = await this.client.price();
        this.engine.position = { ...p, side:'LONG', quantity:p.quantity, margin:p.quantity*p.entryPrice, unrealizedPnl:0 };
        try { await this.ensureStop(); }
        catch (error) { this.state.fault=`Protection unverified: ${error.message}`; this.state.exitReason='PROTECTION FAILURE'; }
        if (this.state.exitReason) await this.closePosition(this.state.exitReason);
        this.engine.position = null;
      }
      if (!this.state.entryOperation && !this.state.closeOperation) await this.finalize();
    }
    this.lastSyncAt=Date.now();this.persist();return account;
  }
  async ensureStop(){
    const p=this.state.owned;if(!p||!this.engine.position)return;
    if(p.stopPrice<=0||p.stopPrice<this.filters.minPrice||p.stopPrice>this.filters.maxPrice||p.stopPrice>=this.lastPrice)throw Error('Rounded stop would trigger immediately or is outside exchange limits');
    if(!p.stopSubmitted){
      p.stopSubmitted=true;this.persist();
      // Never retry this mutation blindly. Future polls query the same saved clientAlgoId.
      try { await this.client.request('POST','/fapi/v1/algoOrder',{symbol:this.symbol,algoType:'CONDITIONAL',side:'SELL',positionSide:'BOTH',type:'STOP_MARKET',triggerPrice:p.stopPrice,closePosition:'true',workingType:'MARK_PRICE',clientAlgoId:p.stopId}); }
      catch(error) { if(error.uncertain===false && Number(error.code)<0){p.stopRejected=true;this.persist();} throw error; }
    }
    const info=await this.stopInfo();
    if(!info||!ACTIVE_STOP.has(info.algoStatus))throw Error(`Protective stop is not active (${info?.algoStatus||'unknown'})`);
    this.protection='VERIFIED';
  }
  async closePosition(reason){
    if(!this.engine.position||this.state.closeOperation)return;
    const op={id:id(),reason,createdAt:Date.now()};this.state.closeOperation=op;this.state.exitReason=reason;this.persist();
    try{await this.client.request('POST','/fapi/v1/order',{symbol:this.symbol,side:'SELL',positionSide:'BOTH',type:'MARKET',quantity:this.engine.position.quantity,reduceOnly:'true',newClientOrderId:op.id,newOrderRespType:'RESULT'});}catch(error){if(error.uncertain===false && Number(error.code)<0){this.state.closeOperation=null;this.state.fault=`Close rejected: ${error.message}`;this.persist();}this.emit('GUARD',`Close awaiting reconciliation: ${error.message}`);}
  }
  async history(route,params,start,end){
    const rows=[];
    if(end-start>89*86400000)throw Error('Trade exceeds supported 89-day reconciliation history; manual review required');
    for(let cursor=start;cursor<=end;cursor+=86400000){
      const batch=await this.client.request('GET',route,{...params,symbol:this.symbol,startTime:cursor,endTime:Math.min(end,cursor+86400000-1),limit:1000});
      if(!Array.isArray(batch)||batch.length>=1000)throw Error('Exchange history is invalid or truncated; accounting is blocked');
      rows.push(...batch);
    }
    return rows;
  }
  async finalize(){
    const p=this.state.owned;let stop=await this.stopInfo();
    const end=Date.now(),fills=await this.history('/fapi/v1/userTrades',{},p.entryTime,end);
    const known=new Set([p.entryOrderId,...p.closeOrderIds,p.stopActualOrderId].filter(v=>v!==undefined).map(String));
    if(fills.some(f=>!known.has(String(f.orderId))))throw Error('Unowned fills exist in the trade interval; accounting requires manual review');
    const buys=fills.filter(f=>f.side==='BUY'),sells=fills.filter(f=>f.side==='SELL');
    const qty=rows=>rows.reduce((n,f)=>n+num(f.qty),0);
    if(!buys.length||!sells.length||Math.abs(qty(buys)-p.quantity)>1e-8||Math.abs(qty(sells)-p.quantity)>1e-8)throw Error('Waiting for complete exchange fills before recording a closed trade');
    if(fills.some(f=>f.commissionAsset!=='USDT'||![f.price,f.qty,f.commission,f.realizedPnl,f.time].every(v=>Number.isFinite(num(v)))))throw Error('Only complete USDT commission/fill accounting is supported');
    if(stop&&ACTIVE_STOP.has(stop.algoStatus)){
      // Keep ownership state until cancellation is confirmed; never cancel unknown/manual orders.
      if(!p.stopCancelRequested){p.stopCancelRequested=true;this.persist();await this.client.request('DELETE','/fapi/v1/algoOrder',{clientAlgoId:p.stopId});}
      stop=await this.stopInfo();if(ACTIVE_STOP.has(stop.algoStatus))throw Error('Waiting for protective-stop cancellation');
    }
    if(stop&&['TRIGGERING','TRIGGERED'].includes(stop.algoStatus))throw Error('Stop settlement is still pending');
    const exitTime=Math.max(...sells.map(f=>num(f.time))),entryTime=Math.min(...buys.map(f=>num(f.time)));
    const income=await this.history('/fapi/v1/income',{incomeType:'FUNDING_FEE'},entryTime,exitTime);
    if(income.some(f=>f.asset!=='USDT'||!Number.isFinite(num(f.income))))throw Error('Unsupported funding currency/data');
    const gross=fills.reduce((n,f)=>n+num(f.realizedPnl),0),fees=fills.reduce((n,f)=>n+num(f.commission),0),funding=-income.reduce((n,f)=>n+num(f.income),0);
    const trade={side:'LONG',entryTime,exitTime,entryPrice:buys.reduce((n,f)=>n+num(f.price)*num(f.qty),0)/p.quantity,exitPrice:sells.reduce((n,f)=>n+num(f.price)*num(f.qty),0)/p.quantity,quantity:p.quantity,leverage:1,margin:p.quantity*p.entryPrice,reason:p.stopActualOrderId&&!p.closeOrderIds.length?'STOP LOSS':this.state.exitReason||'EXCHANGE CLOSE',grossPnL:gross,fees,funding,netPnL:gross-fees-funding,initialStop:p.stopPrice,initialStopDistance:p.stopDistance,rMultiple:(gross-fees-funding)/(p.stopDistance*p.quantity),entryOrderId:p.entryOrderId,closeOrderIds:p.closeOrderIds,stopOrderId:p.stopActualOrderId};
    if(!this.state.trades.some(t=>String(t.entryOrderId)===String(p.entryOrderId))){this.state.trades.push(trade);this.engine.guard.recordExit(trade.netPnL,exitTime);}
    this.state.owned=null;this.state.exitReason=null;this.engine.position=null;this.protection='FLAT';this.persist();this.emit('EXIT',`Exchange close confirmed; net ${trade.netPnL.toFixed(4)} USDT`,{trade});
  }
  async configureSymbol(){
    const cfg=await this.client.request('GET','/fapi/v1/symbolConfig',{symbol:this.symbol});const current=cfg.find?.(c=>c.symbol===this.symbol);
    if(!current)throw Error('SOLUSDT demo configuration unavailable');
    if(current.marginType!=='ISOLATED')await this.client.request('POST','/fapi/v1/marginType',{symbol:this.symbol,marginType:'ISOLATED'});
    if(num(current.leverage)!==1)await this.client.request('POST','/fapi/v1/leverage',{symbol:this.symbol,leverage:1});
    const confirmed=(await this.client.request('GET','/fapi/v1/symbolConfig',{symbol:this.symbol})).find(c=>c.symbol===this.symbol);
    if(confirmed?.marginType!=='ISOLATED'||num(confirmed?.leverage)!==1)throw Error('Demo symbol must be 1x isolated');
  }
  async openPosition(analysis){
    if(this.entryPaused){this.emit("SKIP","Demo entries paused");return;}
    if(!this.config.allowEntries){this.emit('SKIP','Demo connected; set DEMO_ALLOW_ENTRIES=1 to permit new entries');return;}
    if(this.state.fault||this.state.owned||this.state.entryOperation||this.state.closeOperation)throw Error(this.state.fault||'Demo is awaiting position/order reconciliation');
    const gate=this.engine.guard.canOpen(Date.now());if(!gate.allowed){this.emit('SKIP',gate.reason);return;}
    const equity=Math.min(this.config.budget,this.allocatedEquity());const distance=2*num(analysis.indicators?.atr14);
    if(!Number.isFinite(distance)||distance<=0||equity<=0)throw Error('Invalid demo entry risk inputs');
    const portfolio=this.portfolioGate(this,equity*this.config.risk);if(!portfolio.allowed){this.emit('SKIP',portfolio.reason);return;}
    await this.configureSymbol();const price=await this.client.price();if(!Number.isFinite(price)||price<=distance)throw Error('Invalid/current demo price for ATR stop');
    const cap=Math.min(this.config.maxNotional,equity*this.config.margin,this.accountView.available*.95);
    let quantity=step(Math.min(equity*this.config.risk*this.engine.guard.riskMultiplier(equity)/distance,cap/(price*1.002),this.filters.maxQty),this.filters.quantityStep);
    if(quantity<this.filters.minQty||quantity*price<this.filters.minNotional)throw Error('Demo cap/risk is below SOLUSDT exchange minimum; no order was sent');
    if(this.entryPaused) { this.emit("SKIP","Demo stopped before order submission"); return; }
    const operation={id:id(),quantity,stopDistance:distance,createdAt:Date.now()};this.state.entryOperation=operation;this.persist();
    try{await this.client.request('POST','/fapi/v1/order',{symbol:this.symbol,side:'BUY',positionSide:'BOTH',type:'MARKET',quantity,newClientOrderId:operation.id,newOrderRespType:'RESULT'});}catch(error){if(error.uncertain===false && Number(error.code)<0){this.state.entryOperation=null;this.state.fault=`Entry rejected: ${error.message}`;this.persist();}this.emit('GUARD',`Entry awaiting reconciliation: ${error.message}`);}
    await this.reconcile(true);
    if(this.engine.position&&this.state.owned.quantity*this.state.owned.entryPrice>this.config.maxNotional*1.01){this.state.fault='Actual fill exceeded demo notional cap tolerance';await this.closePosition('CAP EXCEEDED');this.persist();}
  }
  async _tick(){
    await this.init();await this.client.syncTime();await this.reconcile(true);
    const [candles,trendCandles]=await Promise.all([this.client.candles(this.symbol,this.config.interval,500),this.strategy.trendInterval?this.client.candles(this.symbol,this.strategy.trendInterval,this.strategy.trendLimit):undefined]);
    if(candles.length<WARMUP+1)throw Error('Insufficient closed demo candles');validateBars(candles,intervalMs(this.config.interval));
    const latest=candles.at(-1);this.lastPrice=await this.client.price();
    if(this.lastProcessed===null || (this.firstTick && !this.engine.position)){this.firstTick=false;this.lastProcessed=latest.closeTime;this.persist();this.emit('SCAN','Demo startup checkpointed the latest candle; waiting for a new close');return false;}
    this.firstTick=false;
    if(latest.closeTime<=this.lastProcessed)return false;
    if(Date.now()-latest.closeTime>intervalMs(this.config.interval)+120000)throw Error('Demo candle feed is stale; entry blocked');
    // Consume before any AI/network mutation so restart cannot duplicate a signal.
    this.lastProcessed=latest.closeTime;this.persist();
    const series=buildSeries(candles),context=this.strategy.prepare(candles,series,{trendCandles}),analysis=this.strategy.analyze(context,candles,series,candles.length-1);
    this.emit('SCAN',`${analysis.signal} | ${analysis.reasons?.[0]||this.strategy.name}`);
    if(this.engine.position&&(analysis.signal==='SELL'||analysis.closeLong)){await this.closePosition('SIGNAL');await this.reconcile(true);}
    else if(!this.engine.position&&analysis.signal==='BUY'){
      if(Date.now()-latest.closeTime>this.maxEntryAgeMs){this.emit('SKIP','Entry signal is older than the two-minute demo freshness window');return true;}
      if(this.aiFilter.enabled){const decision=await this.aiFilter.evaluate({symbol:this.symbol,interval:this.config.interval,strategy:this.strategy.name,direction:'LONG',signal:'BUY',indicators:analysis.indicators,candles:candles.slice(-60)});store.appendLine('data/ai_SOLUSDT.jsonl',{at:Date.now(),mode:'FUTURES_DEMO',signal:'BUY',candleTime:latest.closeTime,provider:this.aiFilter.provider,model:this.aiFilter.model,...decision});if(!decision.allowed){this.emit('AI',`Entry veto: ${decision.reason}`);return true;}}
      await this.reconcile(true);if(Date.now()-latest.closeTime>this.maxEntryAgeMs){this.emit('SKIP','Entry expired while awaiting AI/account checks');return true;}await this.openPosition(analysis);
    }
    this.persist();return true;
  }
  async closeDemo(){return this.serial(async()=>{await this.init();await this.reconcile(true);if(this.engine.position)await this.closePosition("MANUAL DEMO CLOSE");await this.reconcile(true);});}
  async resetHalt(){return this.serial(async()=>{await this.reconcile(false);if(this.engine.position||this.state.owned||this.state.entryOperation||this.state.closeOperation)throw Error('Cannot reset demo fault while a position/order remains unresolved');this.state.fault=null;this.engine.guard.resetHalt(this.allocatedEquity());this.persist();});}
  demoSnapshot(){return {environment:'BINANCE_DEMO',endpoint:DEMO_URL,allowEntries:this.config.allowEntries,notionalCap:this.config.maxNotional,budget:this.config.budget,accountWallet:this.accountView?.wallet??null,accountAvailable:this.accountView?.available??null,allocatedEquity:this.allocatedEquity(),protection:this.engine.position?(this.protection||'UNVERIFIED'):'FLAT',fault:this.state.fault,pendingEntry:this.state.entryOperation?.id||null,pendingClose:this.state.closeOperation?.id||null,pendingAccounting:!!this.state.owned&&!this.engine.position,connected:this.initialized,lastSyncAt:this.lastSyncAt||null};}
  summaryRow(){return `SOLUSDT DEMO | ${this.engine.position?'LONG':'flat'} | allocated equity ${this.allocatedEquity().toFixed(2)} | ${this.lastNote}`;}
}
module.exports={DemoRunner};
