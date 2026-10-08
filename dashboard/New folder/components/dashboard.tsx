"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bot, Gauge, LayoutDashboard, Menu, Pause, Play, Radar, Settings, ShieldCheck, SlidersHorizontal, Wallet, X, CircleDollarSign, RefreshCw, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";
const nav = [["Overview", LayoutDashboard], ["Markets", Radar], ["Positions", Wallet], ["Trades", Activity], ["Backtests", BarChart3], ["Strategies", SlidersHorizontal], ["Risk", ShieldCheck]] as const;

type Runner = { symbol: string; price: number; equity: number; returnPct: number; lastProcessed: number | null; lastNote: string; position: any; metrics: any; risk: any };
type Status = { mode: string; running: boolean; strategy: string; interval: string; updatedAt: number; portfolio: { startingBalance: number; equity: number; returnPct: number }; metrics: any; runners: Runner[] };
type Market = { symbol: string; price: number; change: number; signal: string; score: number; maxScore: number; rsi: number | null; adx: number | null };
type Trade = { symbol: string; entryTime: number; exitTime: number; entryPrice: number; exitPrice: number; quantity: number; reason: string; netPnL: number; fees: number; rMultiple: number };

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const price = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 4 : 2 })}`;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const time = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Stat({ label, value, sub, positive, icon: Icon }: { label: string; value: string; sub: string; positive?: boolean; icon: any }) {
  return <div className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><span className="text-sm text-zinc-400">{label}</span><span className="rounded-lg bg-white/5 p-2 text-zinc-400"><Icon size={17}/></span></div><div className="mt-4 text-2xl font-semibold tracking-tight">{value}</div><div className={`mt-1 flex items-center gap-1 text-xs ${positive === false ? "text-red-400" : "text-emerald-400"}`}>{positive === false ? <ArrowDownRight size={13}/> : <ArrowUpRight size={13}/>} {sub}</div></div>;
}

export default function Dashboard() {
  const [active, setActive] = useState("Overview");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, m, t] = await Promise.all([
        fetch(`${API}/api/status`, { cache: "no-store" }).then(r => r.json()),
        fetch(`${API}/api/markets`, { cache: "no-store" }).then(r => r.json()),
        fetch(`${API}/api/trades`, { cache: "no-store" }).then(r => r.json()),
      ]);
      if (s.error) throw new Error(s.error);
      setStatus(s); setMarkets(m.markets || []); setTrades(t || []); setError("");
    } catch (e: any) { setError(e.message || "Backend API unavailable"); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);

  const command = async (path: string) => { setBusy(true); try { await fetch(`${API}${path}`, { method: "POST" }); await load(); } finally { setBusy(false); } };

  const runners = status?.runners || [];
  const positions = runners.filter(r => r.position);
  const equity = useMemo(() => {
    let value = status?.portfolio.startingBalance || 0;
    const sorted = [...trades].sort((a,b) => a.exitTime - b.exitTime);
    return [{ t: "Start", v: value }, ...sorted.slice(-30).map(t => { value += t.netPnL; return { t: time(t.exitTime), v: value }; })];
  }, [status, trades]);

  const drawdown = Math.max(...runners.map(r => r.risk.drawdownPct || 0), 0);
  const dailyLoss = Math.min(...runners.map(r => r.risk.dailyPnlPct || 0), 0);
  const maxTrades = Math.max(...runners.map(r => r.risk.tradesToday || 0), 0);
  const maxLosses = Math.max(...runners.map(r => r.risk.consecutiveLosses || 0), 0);
  const m = status?.metrics;

  return <div className="min-h-screen bg-[#080b12] text-zinc-100">
    <aside className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-white/7 bg-[#0b0f17]/95 p-4 backdrop-blur-xl transition-transform lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-12 items-center justify-between px-2"><div className="flex items-center gap-2.5"><div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400"><Bot size={19}/></div><div><div className="font-semibold">TradeLab</div><div className="text-[10px] uppercase tracking-[.18em] text-zinc-500">Personal Bot</div></div></div><button className="lg:hidden text-zinc-500" onClick={() => setOpen(false)}><X size={19}/></button></div>
      <div className="mt-8 space-y-1">{nav.map(([label, Icon]) => <button key={label} onClick={() => {setActive(label); setOpen(false)}} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active === label ? "bg-white/7 text-white" : "text-zinc-500 hover:bg-white/4 hover:text-zinc-200"}`}><Icon size={17}/>{label}{label === "Risk" && <span className={`ml-auto h-2 w-2 rounded-full ${drawdown < 10 ? "bg-emerald-400" : "bg-red-400"}`}/>}</button>)}</div>
      <div className="mt-8 border-t border-white/6 pt-5"><div className="px-3 text-[10px] font-medium uppercase tracking-[.18em] text-zinc-600">System</div><button className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-500 hover:bg-white/4 hover:text-zinc-200"><Settings size={17}/>Settings</button></div>
      <div className="absolute bottom-5 left-4 right-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4"><div className="flex items-center gap-2 text-xs font-medium text-emerald-300"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"/> {status?.running ? "Paper engine running" : "Paper engine stopped"}</div><div className="mt-2 text-[11px] leading-5 text-zinc-500">No real orders can be placed from this dashboard.</div></div>
    </aside>

    <main className="lg:pl-64">
      <header className="sticky top-0 z-20 border-b border-white/6 bg-[#080b12]/80 backdrop-blur-xl"><div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8"><div className="flex items-center gap-3"><button className="lg:hidden rounded-lg p-2 text-zinc-400 hover:bg-white/5" onClick={() => setOpen(true)}><Menu size={20}/></button><div><div className="text-sm font-medium">{active}</div><div className="text-xs text-zinc-500">{status ? `Updated ${time(status.updatedAt)}` : "Connecting to backend…"}</div></div></div><div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-xs text-amber-300 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-amber-400"/> PAPER MODE</div><button onClick={load} className="rounded-xl border border-white/7 bg-white/3 p-2 text-zinc-400 hover:text-white"><RefreshCw size={17}/></button><button disabled={busy || !status} onClick={() => command(status?.running ? "/api/bot/stop" : "/api/bot/start")} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${status?.running ? "bg-indigo-500 text-white" : "bg-white/7 text-zinc-300"}`}>{status?.running ? <Pause size={14}/> : <Play size={14}/>}<span className="hidden sm:inline">{status?.running ? "Bot running" : "Start bot"}</span></button></div></div></header>

      <div className="grid-bg min-h-[calc(100vh-64px)] p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1500px] space-y-6">
        {error && <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">Backend connection error: {error}. Start the API with <code className="rounded bg-black/30 px-1.5 py-0.5">npm run api</code> in your backend folder.</div>}
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-400/15 bg-indigo-400/5 px-3 py-1 text-[11px] text-indigo-300"><Activity size={12}/> {status?.strategy || "Strategy"} · {status?.interval || "—"}</div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trading overview</h1><p className="mt-1 text-sm text-zinc-500">Live paper account state from your Node trading engine.</p></div></section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Paper equity" value={money(status?.portfolio.equity || 0)} sub={`${pct(status?.portfolio.returnPct || 0)} all time`} positive={(status?.portfolio.returnPct || 0) >= 0} icon={Wallet}/><Stat label="Total P&L" value={money((status?.portfolio.equity || 0) - (status?.portfolio.startingBalance || 0))} sub={`${m?.trades || 0} closed trades`} positive={(status?.portfolio.returnPct || 0) >= 0} icon={CircleDollarSign}/><Stat label="Daily P&L" value={pct(dailyLoss)} sub={`Worst account today`} positive={dailyLoss >= 0} icon={TrendingUp}/><Stat label="Max drawdown" value={`${drawdown.toFixed(2)}%`} sub={`Limit ${runners[0]?.risk.limits.maxDrawdownPct ?? 10}%`} positive={drawdown < (runners[0]?.risk.limits.maxDrawdownPct ?? 10)} icon={ShieldCheck}/><Stat label="Profit factor" value={m?.profitFactor === Infinity ? "∞" : (m?.profitFactor || 0).toFixed(2)} sub={`${m?.winRate?.toFixed(1) || "0.0"}% win rate`} positive={(m?.profitFactor || 0) >= 1} icon={Gauge}/></div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,.8fr)]"><section className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><div><h2 className="font-medium">Equity curve</h2><p className="mt-1 text-xs text-zinc-500">Realized paper equity · {money(status?.portfolio.startingBalance || 0)} starting</p></div><div className="rounded-lg bg-emerald-400/8 px-2.5 py-1.5 text-xs text-emerald-300">{pct(status?.portfolio.returnPct || 0)}</div></div><div className="mt-5 h-[300px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={equity}><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="100%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#ffffff08" vertical={false}/><XAxis dataKey="t" axisLine={false} tickLine={false} tick={{fill:"#71717a",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"#71717a",fontSize:11}} tickFormatter={(v) => `$${Number(v).toFixed(0)}`}/><Tooltip contentStyle={{background:"#111620",border:"1px solid #ffffff12",borderRadius:12,fontSize:12}} formatter={(v) => [`$${Number(v).toFixed(2)}`, "Equity"]}/><Area type="monotone" dataKey="v" stroke="#818cf8" strokeWidth={2} fill="url(#equityFill)"/></AreaChart></ResponsiveContainer></div></section>

        <section className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><div><h2 className="font-medium">Risk monitor</h2><p className="mt-1 text-xs text-zinc-500">Across paper accounts</p></div><ShieldCheck className={drawdown < 10 ? "text-emerald-400" : "text-red-400"} size={19}/></div><div className="mt-6 space-y-5">{[["Daily loss",`${dailyLoss.toFixed(2)}%`,`Limit ${runners[0]?.risk.limits.maxDailyLossPct ?? 3}%`,Math.min(Math.abs(dailyLoss)/(runners[0]?.risk.limits.maxDailyLossPct || 3)*100,100)],["Drawdown",`${drawdown.toFixed(2)}%`,`Limit ${runners[0]?.risk.limits.maxDrawdownPct ?? 10}%`,Math.min(drawdown/(runners[0]?.risk.limits.maxDrawdownPct || 10)*100,100)],["Consecutive losses",String(maxLosses),`Limit ${runners[0]?.risk.limits.maxConsecutiveLosses ?? 3}`,Math.min(maxLosses/(runners[0]?.risk.limits.maxConsecutiveLosses || 3)*100,100)],["Trades today",String(maxTrades),`Limit ${runners[0]?.risk.limits.maxTradesPerDay ?? 6}`,Math.min(maxTrades/(runners[0]?.risk.limits.maxTradesPerDay || 6)*100,100)]].map(([a,b,c,w]) => <div key={String(a)}><div className="flex justify-between text-xs"><span className="text-zinc-400">{a}</span><span className="text-zinc-300">{b} <span className="text-zinc-600">· {c}</span></span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-indigo-400" style={{width:`${Number(w)}%`}}/></div></div>)}</div><div className={`mt-6 flex items-center gap-2 rounded-xl border p-3 text-xs ${runners.some(r => r.risk.halted) ? "border-red-400/10 bg-red-400/5 text-red-300" : "border-emerald-400/10 bg-emerald-400/5 text-emerald-300"}`}><ShieldCheck size={15}/>{runners.some(r => r.risk.halted) ? "One or more accounts are HALTED." : "All risk guards are clear."}</div></section></div>

        <section className="glass overflow-hidden rounded-2xl"><div className="border-b border-white/6 p-5"><h2 className="font-medium">Market scanner</h2><p className="mt-1 text-xs text-zinc-500">Same strategy logic used by the paper engine</p></div><div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="text-[11px] uppercase tracking-wider text-zinc-600"><tr className="border-b border-white/5"><th className="px-5 py-3 font-medium">Market</th><th className="px-5 py-3 font-medium">Price</th><th className="px-5 py-3 font-medium">24h</th><th className="px-5 py-3 font-medium">Signal</th><th className="px-5 py-3 font-medium">Score</th><th className="px-5 py-3 font-medium">RSI</th><th className="px-5 py-3 font-medium">ADX</th></tr></thead><tbody>{markets.map(x => <tr key={x.symbol} className="border-b border-white/4 last:border-0 hover:bg-white/[.025]"><td className="px-5 py-4 font-medium">{x.symbol}</td><td className="px-5 py-4 text-zinc-300">{price(x.price)}</td><td className={`px-5 py-4 ${x.change >= 0 ? "text-emerald-400":"text-red-400"}`}>{pct(x.change)}</td><td className="px-5 py-4"><span className={`rounded-md px-2 py-1 text-[11px] font-medium ${x.signal === "BUY" ? "bg-emerald-400/10 text-emerald-300" : x.signal === "SELL" ? "bg-red-400/10 text-red-300" : "bg-white/6 text-zinc-400"}`}>{x.signal}</span></td><td className="px-5 py-4 text-zinc-300">{x.score}/{x.maxScore}</td><td className="px-5 py-4 text-zinc-400">{x.rsi?.toFixed(1) ?? "—"}</td><td className="px-5 py-4 text-zinc-400">{x.adx?.toFixed(1) ?? "—"}</td></tr>)}</tbody></table></div></section>

        <div className="grid gap-6 xl:grid-cols-2"><section className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><div><h2 className="font-medium">Open positions</h2><p className="mt-1 text-xs text-zinc-500">Live paper positions</p></div><span className="rounded-lg bg-white/5 px-2 py-1 text-xs text-zinc-400">{positions.length} open</span></div><div className="mt-5 space-y-3">{positions.length ? positions.map(p => <div key={p.symbol} className="rounded-xl border border-white/6 bg-white/[.02] p-4"><div className="flex items-center justify-between"><div><div className="font-medium">{p.symbol}</div><div className="mt-1 text-xs text-emerald-400">LONG</div></div><div className={`text-right ${p.position.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}><div className="font-medium">{money(p.position.unrealizedPnl)}</div><div className="text-xs text-zinc-600">unrealized</div></div></div><div className="mt-4 grid grid-cols-4 gap-3 text-xs"><div><div className="text-zinc-600">Entry</div><div className="mt-1 text-zinc-300">{price(p.position.entryPrice)}</div></div><div><div className="text-zinc-600">Current</div><div className="mt-1 text-zinc-300">{price(p.position.currentPrice)}</div></div><div><div className="text-zinc-600">Stop</div><div className="mt-1 text-red-300">{price(p.position.stopPrice)}</div></div><div><div className="text-zinc-600">Target</div><div className="mt-1 text-emerald-300">{price(p.position.targetPrice)}</div></div></div></div>) : <div className="rounded-xl border border-dashed border-white/8 p-8 text-center text-sm text-zinc-600">No open paper positions.</div>}</div></section>

        <section className="glass rounded-2xl p-5"><div className="flex items-center justify-between"><div><h2 className="font-medium">Recent trades</h2><p className="mt-1 text-xs text-zinc-500">Completed paper executions from the engine</p></div></div><div className="mt-5 space-y-1">{trades.slice(0,6).map(t => <div key={`${t.symbol}-${t.exitTime}`} className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-white/[.025]"><div className="flex items-center gap-3"><div className={`grid h-9 w-9 place-items-center rounded-lg ${t.netPnL >= 0 ? "bg-emerald-400/8 text-emerald-400":"bg-red-400/8 text-red-400"}`}>{t.netPnL >= 0 ? <ArrowUpRight size={16}/>:<ArrowDownRight size={16}/>}</div><div><div className="text-sm font-medium">{t.symbol} <span className="ml-1 text-[10px] text-zinc-600">LONG</span></div><div className="mt-0.5 text-xs text-zinc-600">{time(t.exitTime)} · {t.reason}</div></div></div><div className="text-right"><div className={`text-sm font-medium ${t.netPnL >= 0 ? "text-emerald-400":"text-red-400"}`}>{t.netPnL >= 0 ? "+":""}{money(t.netPnL)}</div><div className="text-xs text-zinc-600">{t.rMultiple >= 0 ? "+":""}{t.rMultiple.toFixed(2)}R</div></div></div>)}</div></section></div>

        <footer className="flex flex-col justify-between gap-2 border-t border-white/5 py-5 text-xs text-zinc-600 sm:flex-row"><span>TradeLab · personal research & paper trading</span><span>Engine: {status?.running ? "running" : "stopped"} · Binance data · PAPER</span></footer>
      </div></div>
    </main>
  </div>;
}
