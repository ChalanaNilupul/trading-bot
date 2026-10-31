"use client";

import { Terminal } from "lucide-react";
import { SectionHeader } from "../ui";
import { RuntimeEvent, Status } from "../types";
import { API } from "../config";

export function OperationsMonitor({
  status,
  events,
}: {
  status: Status | null;
  events: RuntimeEvent[];
}) {
  const telemetry = status?.telemetry;
  const lastSuccess = telemetry?.lastSuccessfulBinanceAt;
  const lastCandle = telemetry?.lastCandleAt;
  const error = telemetry?.lastBinanceError;
  const formatTime = (value?: number | null) =>
    value ? new Date(value).toLocaleString() : "No successful update yet";

  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/6 p-5">
        <div>
          <SectionHeader
            title="Live backend operations"
            description={status?.mode === "FUTURES_DEMO" ? "Binance demo events and virtual-fund orders. Production trading is disabled." : "Timestamped paper-engine events; exchange orders are disabled."}
          />
        </div>
        <span
          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${status?.running ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-300"}`}
        >
          {`${status?.mode === "FUTURES_DEMO" ? "DEMO" : "PAPER"} ENGINE ${status?.running ? "RUNNING" : "STOPPED"}`}
        </span>
      </div>

      <div className="grid gap-3 border-b border-white/6 p-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Last Binance data success
          </div>
          <div className="mt-2 text-xs text-zinc-200">
            {formatTime(lastSuccess)}
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Last processed candle
          </div>
          <div className="mt-2 text-xs text-zinc-200">
            {formatTime(lastCandle)}
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Latest API/data error
          </div>
          <div
            className={`mt-2 line-clamp-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}
          >
            {error
              ? `${formatTime(error.at)} — ${error.message}`
              : "No recorded data errors"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Terminal size={14} /> Runtime event feed
        </div>
        <div className="text-[10px] text-zinc-600">
          Refreshes with dashboard · newest first
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="p-8 text-center text-xs leading-5 text-zinc-500">
            No backend events recorded yet. Start the engine to see
            fetches, candle evaluations, signals, risk decisions and trade
            events here.
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex gap-3 border-b border-white/[.035] px-5 py-3 last:border-0"
            >
              <div
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${event.level === "error" ? "bg-red-400" : event.level === "warn" ? "bg-amber-400" : event.level === "trade" ? "bg-indigo-400" : "bg-emerald-400"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wider text-zinc-400">
                    {event.category}
                  </span>
                  {event.symbol && (
                    <span className="text-[10px] text-zinc-600">
                      {event.symbol}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] tabular-nums text-zinc-600">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs leading-5 text-zinc-300">
                  {event.message}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
