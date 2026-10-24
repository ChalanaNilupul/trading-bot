"use client";

import { SlidersHorizontal, Zap } from "lucide-react";
import { ConfigRow, HealthRow, PageTitle, SectionHeader } from "../ui";
import { Market, Runner, Status } from "../types";
import { money, pct, price } from "../format";

export function StrategiesPage({ status, runners, markets, equity }: {
  status: Status | null;
  runners: Runner[];
  markets: Market[];
  equity: { t: string; v: number }[];
}) {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Strategies"
        description="Inspect the strategy currently powering your paper engine."
        icon={SlidersHorizontal}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <SectionHeader
            title="Active strategy"
            description="Current strategy configuration."
          />

          <div className="mt-6 rounded-2xl border border-indigo-400/10 bg-indigo-400/5 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-indigo-300">
                  Running strategy
                </div>

                <div className="mt-2 text-2xl font-semibold">
                  {status?.strategy || "Unknown strategy"}
                </div>

                <div className="mt-2 text-sm text-zinc-500">
                  {status?.interval || "Unknown interval"} candle timeframe
                </div>
              </div>

              <div className="rounded-xl bg-indigo-400/10 p-3 text-indigo-400">
                <Zap size={22} />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ConfigRow label="Mode" value={status?.mode || "PAPER"} />

            <ConfigRow label="Interval" value={status?.interval || "—"} />

            <ConfigRow label="Markets" value={`${markets.length} scanned`} />

            <ConfigRow label="Runner count" value={String(runners.length)} />

            <ConfigRow
              label="Engine"
              value={status?.running ? "Running" : "Stopped"}
            />

            <ConfigRow label="Data source" value="Binance" />
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Strategy health"
            description="Current execution status."
          />

          <div className="mt-6 space-y-4">
            <HealthRow label="Engine" ok={!!status?.running} />

            <HealthRow label="Market data" ok={markets.length > 0} />

            <HealthRow
              label="Risk guard"
              ok={!runners.some((r) => r.risk?.halted)}
            />

            <HealthRow label="Paper mode" ok={true} />
          </div>
        </section>
      </div>

      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Strategy runners"
          description="Individual market workers."
        />

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runners.map((runner) => (
            <div
              key={runner.symbol}
              className="rounded-xl border border-white/6 bg-white/[.02] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{runner.symbol}</span>

                <span
                  className={`h-2 w-2 rounded-full ${
                    runner.risk?.halted ? "bg-red-400" : "bg-emerald-400"
                  }`}
                />
              </div>

              <div className="mt-4 space-y-2 text-xs">
                <ConfigRow label="Price" value={price(runner.price)} />

                <ConfigRow label="Equity" value={money(runner.equity)} />

                <ConfigRow label="Return" value={pct(runner.returnPct)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
