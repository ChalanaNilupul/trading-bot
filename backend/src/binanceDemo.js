const crypto = require('crypto');
const DEMO_URL = 'https://demo-fapi.binance.com';
const READ = new Set(['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/klines','/fapi/v1/ticker/24hr','/fapi/v1/ticker/price','/fapi/v1/premiumIndex','/fapi/v2/account','/fapi/v3/positionRisk','/fapi/v1/positionSide/dual','/fapi/v1/multiAssetsMargin','/fapi/v1/symbolConfig','/fapi/v1/openOrders','/fapi/v1/openAlgoOrders','/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/userTrades','/fapi/v1/income']);
const WRITE = new Set(['POST /fapi/v1/order','DELETE /fapi/v1/order','POST /fapi/v1/algoOrder','DELETE /fapi/v1/algoOrder','POST /fapi/v1/leverage','POST /fapi/v1/marginType']);
const PUBLIC = new Set(['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/klines','/fapi/v1/ticker/24hr','/fapi/v1/ticker/price','/fapi/v1/premiumIndex']);
class DemoAPIError extends Error {
  constructor(message, code, uncertain=false, retryableRead=false) { super(message); this.code=code; this.uncertain=uncertain; this.retryableRead=retryableRead; }
}
class BinanceDemoClient {
  constructor({apiKey=process.env.BINANCE_DEMO_API_KEY,apiSecret=process.env.BINANCE_DEMO_API_SECRET,fetchImpl=global.fetch,now=Date.now,baseUrl,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
    if(baseUrl && baseUrl!==DEMO_URL) throw new Error('Demo client only permits the fixed Binance demo host');
    this.key=apiKey||'';this.secret=apiSecret||'';this.fetch=fetchImpl;this.now=now;this.offset=0;this.wait=wait;
    this.keyFingerprint=crypto.createHash('sha256').update(this.key).digest('hex').slice(0,16);
  }
  credentials() {if(!this.key || !this.secret)throw new Error('Set BINANCE_DEMO_API_KEY and BINANCE_DEMO_API_SECRET in backend/.env');}
  async request(method,route,params={}) {
    // Only reads may be repeated. Rebuild/sign every attempt with a fresh timestamp.
    for(let attempt=0;attempt<2;attempt++) {
      try{return await this.requestOnce(method,route,params);}
      catch(error){if(method!=='GET'||!error.retryableRead||attempt===1)throw error;await this.wait(300);}
    }
  }
  async requestOnce(method,route,params={}) {
    if((method==='GET'?!READ.has(route):!WRITE.has(`${method} ${route}`)))throw new Error('Unsupported demo API operation');
    if(params.symbol && params.symbol!=='SOLUSDT')throw new Error('Demo execution is restricted to SOLUSDT');
    if(method !== 'GET') {
      if(params.symbol !== 'SOLUSDT' && route !== '/fapi/v1/algoOrder') throw Error('Demo mutations require SOLUSDT');
      if(route === '/fapi/v1/order' && method === 'POST' && (params.type !== 'MARKET' || params.positionSide !== 'BOTH' || !String(params.newClientOrderId||'').startsWith('tbD-') || !Number.isFinite(Number(params.quantity)) || Number(params.quantity)<=0 || !(['BUY','SELL'].includes(params.side)) || (params.side==='SELL' && String(params.reduceOnly)!=='true'))) throw Error('Only identified LONG entries and reduce-only demo market exits are allowed');
      if(route === '/fapi/v1/algoOrder' && method === 'POST' && (params.symbol!=='SOLUSDT' || params.side!=='SELL' || params.type!=='STOP_MARKET' || params.positionSide!=='BOTH' || params.algoType!=='CONDITIONAL' || String(params.closePosition)!=='true' || params.workingType!=='MARK_PRICE' || params.quantity!==undefined || params.reduceOnly!==undefined || !String(params.clientAlgoId||'').startsWith('tbD-') || !(Number(params.triggerPrice)>0))) throw Error('Only identified close-long demo protective stops are allowed');
      if(method==='DELETE' && !String(params.origClientOrderId||params.clientAlgoId||'').startsWith('tbD-')) throw Error('Refusing to cancel an unidentified order');
      if(route==='/fapi/v1/leverage' && Number(params.leverage)!==1) throw Error('Demo leverage is restricted to 1x');
      if(route==='/fapi/v1/marginType' && params.marginType!=='ISOLATED') throw Error('Demo margin must be isolated');
    }
    const signed=!PUBLIC.has(route);if(signed)this.credentials();
    const query=new URLSearchParams();for(const [k,v]of Object.entries(params))if(v!==undefined)query.set(k,String(v));
    if(signed){query.set('recvWindow','5000');query.set('timestamp',String(this.now()+this.offset));query.set('signature',crypto.createHmac('sha256',this.secret).update(query.toString()).digest('hex'));}
    const headers={};if(signed)headers['X-MBX-APIKEY']=this.key;
    let response,data;
    try {
      response=await this.fetch(`${DEMO_URL}${route}?${query}`,{method,headers,redirect:'error',signal:AbortSignal.timeout(method==='GET'?5000:8000)});
      data=await response.json();
    } catch {
      const read=method==='GET',transient=!response||response.ok||response.status>=500||response.status===408;
      throw new DemoAPIError(read?`Binance demo GET ${route} failed (network/timeout or invalid response); this read did not submit an order`:'Binance demo mutation failed or timed out; query saved client ID before any retry',null,!read,read&&transient);
    }
    if(!response.ok || (Number.isFinite(data?.code)&&data.code<0)) {
      let message=String(data?.msg||'Request rejected').slice(0,250);
      for(const value of [this.key,this.secret,query.get('signature')])if(value)message=message.split(value).join('[redacted]');
      throw new DemoAPIError(`Binance demo ${response.status}: ${message}`,data?.code,method!=='GET'&&(response.status>=500||response.status===408||[-1006,-1007].includes(data?.code)),method==='GET'&&(response.status>=500||response.status===408));
    }
    return data;
  }
  async syncTime(){const r=await this.request('GET','/fapi/v1/time');if(!Number.isFinite(r.serverTime))throw Error('Invalid demo server time');this.offset=r.serverTime-this.now();}
  async candles(symbol,interval,limit=500){const rows=await this.request('GET','/fapi/v1/klines',{symbol,interval,limit:Math.min(limit+1,1000)});return rows.map(c=>({openTime:c[0],open:+c[1],high:+c[2],low:+c[3],close:+c[4],volume:+c[5],closeTime:c[6]})).filter(c=>c.closeTime+2000<=this.now()+this.offset).slice(-limit);}
  async tickers(){
    const data=await this.request('GET','/fapi/v1/ticker/24hr',{symbol:'SOLUSDT'});
    const rows=Array.isArray(data)?data.filter(r=>r.symbol==='SOLUSDT'):[data];
    if(rows.length!==1||rows[0]?.symbol!=='SOLUSDT'||!(Number(rows[0].lastPrice)>0))throw Error('Invalid SOLUSDT demo ticker response');
    return rows;
  }
  async price(){return Number((await this.request('GET','/fapi/v1/ticker/price',{symbol:'SOLUSDT'})).price);}
  async filters(){
    const info=await this.request('GET','/fapi/v1/exchangeInfo');const s=info.symbols?.find(s=>s.symbol==='SOLUSDT');
    if(!s || s.status!=='TRADING' || s.contractType!=='PERPETUAL')throw Error('SOLUSDT perpetual is unavailable on Binance demo');
    const lot=s.filters.find(f=>f.filterType==='LOT_SIZE'),market=s.filters.find(f=>f.filterType==='MARKET_LOT_SIZE'),price=s.filters.find(f=>f.filterType==='PRICE_FILTER'),notional=s.filters.find(f=>f.filterType==='MIN_NOTIONAL');
    const filters={stepSize:Number(lot?.stepSize),marketStep:Number(market?.stepSize)||0,minQty:Math.max(Number(lot?.minQty)||0,Number(market?.minQty)||0),maxQty:Math.min(...[lot?.maxQty,market?.maxQty].map(Number).filter(n=>n>0)),tickSize:Number(price?.tickSize),minPrice:Number(price?.minPrice),maxPrice:Number(price?.maxPrice),minNotional:Number(notional?.notional)};
    if(![filters.stepSize,filters.tickSize,filters.maxQty,filters.maxPrice].every(n=>Number.isFinite(n)&&n>0)||![filters.minQty,filters.minNotional,filters.minPrice].every(n=>Number.isFinite(n)&&n>=0))throw Error('Incomplete SOLUSDT demo exchange filters');
    filters.quantityStep=commonStep(filters.stepSize,filters.marketStep);
    return filters;
  }
  async account(){
    const [account,positions,orders,algos,modes,assets,symbolConfig]=await Promise.all([
      this.request('GET','/fapi/v2/account'),this.request('GET','/fapi/v3/positionRisk'),this.request('GET','/fapi/v1/openOrders'),this.request('GET','/fapi/v1/openAlgoOrders'),this.request('GET','/fapi/v1/positionSide/dual'),this.request('GET','/fapi/v1/multiAssetsMargin'),this.request('GET','/fapi/v1/symbolConfig',{symbol:'SOLUSDT'})]);
    if(modes.dualSidePosition!==false || assets.multiAssetsMargin!==false)throw Error('Demo requires One-way and Single-Asset modes; change these manually while flat');
    if(account.canTrade!==true||![account.totalWalletBalance,account.availableBalance].every(v=>v!==undefined && Number.isFinite(Number(v))))throw Error('Demo account is not trade-enabled or returned invalid balances');
    if(![positions,orders,algos].every(Array.isArray))throw Error('Invalid demo account/order response');
    if(!Array.isArray(symbolConfig)||!symbolConfig.some(c=>c.symbol==='SOLUSDT'))throw Error('Missing SOLUSDT demo account configuration');
    return {wallet:Number(account.totalWalletBalance),available:Number(account.availableBalance),positions,orders,algos,symbolConfig:symbolConfig.find(c=>c.symbol==='SOLUSDT')};
  }
}
function step(value,increment,round='floor') {
  if(!Number.isFinite(value)||!Number.isFinite(increment)||increment<=0)throw Error('Invalid exchange rounding');
  const text=increment.toFixed(12).replace(/0+$/,'');const places=(text.split('.')[1]||'').length;
  return Number((Math[round](value/increment+(round==='floor'?1e-9:-1e-9))*increment).toFixed(places));
}
function commonStep(...steps) {
  const values=steps.filter(n=>n>0);
  const places=Math.max(...values.map(n=>(n.toFixed(12).replace(/0+$/,'').split('.')[1]||'').length));
  const scale=10**places, ints=values.map(n=>Math.round(n*scale));
  if(ints.some(n=>!Number.isSafeInteger(n)))throw Error('Unsupported quantity step precision');
  const gcd=(a,b)=>b?gcd(b,a%b):a;
  const lcm=ints.reduce((a,b)=>a/gcd(a,b)*b);
  if(!Number.isSafeInteger(lcm))throw Error('Unsupported combined quantity step');
  return lcm/scale;
}
module.exports={BinanceDemoClient,DemoAPIError,DEMO_URL,step,commonStep};
