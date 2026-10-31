function mode(value=process.env.BOT_MODE||'FUTURES_PAPER') {
  if(!['FUTURES_PAPER','FUTURES_DEMO'].includes(value))throw Error('BOT_MODE must be FUTURES_PAPER or FUTURES_DEMO; live execution is not implemented');
  return value;
}
function demoConfig({symbol,direction,leverage,budget,strategy,interval}) {
  if(symbol!=='SOLUSDT'||direction!=='LONG'||leverage!==1)throw Error('Demo requires exactly SOLUSDT, DIRECTION=LONG and LEVERAGE=1');
  if(strategy.requiredInterval&&strategy.requiredInterval!==interval)throw Error(`${strategy.name} requires ${strategy.requiredInterval}`);
  if(strategy.engine?.trailing!==false || strategy.engine?.rewardRiskRatio!==null)throw Error('Demo supports fixed-ATR-stop strategies without trailing or a profit target');
  const risk=Number(process.env.RISK_PERCENT||.0025),margin=Number(process.env.MAX_MARGIN_PERCENT||.1),maxNotional=Number(process.env.DEMO_MAX_NOTIONAL_USDT||25);
  if(!Number.isFinite(budget)||budget<=0||!Number.isFinite(risk)||risk<=0||risk>.01||!Number.isFinite(margin)||margin<=0||margin>.25||!Number.isFinite(maxNotional)||maxNotional<=0||maxNotional>budget*margin)throw Error('Invalid demo budget/risk/cap: risk <= 1%, margin <= 25%, notional <= budget × margin');
  return {symbol,direction,leverage,budget,strategy,interval,risk,margin,maxNotional,allowEntries:process.env.DEMO_ALLOW_ENTRIES==='1'};
}
module.exports={mode,demoConfig};
