"use client";
import {useState} from "react";
import {Status} from "../types";
import {money} from "../format";
import {API} from "../config";
export function DemoCard({status}:{status:Status}) {
  const demo=status.demo;
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  if(!demo)return null;
  return <section className="rounded-2xl border border-amber-400/30 bg-amber-400/5 p-5">
    <h2 className="font-semibold text-amber-200">BINANCE DEMO · Virtual funds only</h2>
    <p className="mt-2 text-sm text-zinc-400">SOLUSDT LONG · 1x isolated · {demo.endpoint}. New entries: {demo.allowEntries?"enabled":"disabled"}. Stops and exits for owned positions are managed while polling runs.</p>
    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div>Demo account wallet: <strong>{demo.accountWallet==null?"—":money(demo.accountWallet)}</strong></div>
      <div>Allocated bot budget: <strong>{money(demo.budget)}</strong></div>
      <div>Entry notional cap: <strong>{money(demo.notionalCap)}</strong></div>
      <div>Protection: <strong>{demo.protection}</strong></div>
    </div>
    <p className="mt-3 text-xs text-zinc-400">Allocated equity is the starting budget plus exchange wallet changes and position P/L. Use a dedicated demo account; manual trades, balance resets and deposits affect this measurement. Last sync: {demo.lastSyncAt?new Date(demo.lastSyncAt).toLocaleString():"not connected"}.</p>
    {demo.fault && <p role="alert" className="mt-3 text-sm text-red-300">Entries blocked: {demo.fault}</p>}
    {(demo.pendingEntry||demo.pendingClose||demo.pendingAccounting) && <p className="mt-3 text-sm text-amber-200">Exchange order/accounting reconciliation pending. New entries are blocked.</p>}
    <button className="mt-4 rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-200 disabled:opacity-40" disabled={busy || (!status.runners.some(r=>r.position)&&!demo.pendingEntry&&!demo.pendingClose&&!demo.pendingAccounting)} onClick={async()=>{
      setBusy(true);setMessage("");
      try {const response=await fetch(`${API}/api/demo/close`,{method:"POST"});const body=await response.json();if(!response.ok)throw Error(body.error||"Close failed");setMessage("Close/reconciliation requested. Check the position and order status on the next refresh.");}
      catch(error){setMessage(error instanceof Error?error.message:"Unable to close demo position");}
      finally{setBusy(false);}
    }}>{busy?"Reconciling…":"Close bot’s demo position"}</button>
    <p className="mt-3 text-xs text-zinc-400">Stop bot pauses polling and new entries; it does not flatten the exchange position. Existing exchange-held stops remain.</p>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
