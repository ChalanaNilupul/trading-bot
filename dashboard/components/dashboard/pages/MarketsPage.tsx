"use client";

import { ArrowDownRight, ArrowUpRight, Radar, Search, ChevronRight } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart, Bar, Cell } from "recharts";
import { PageTitle, SectionHeader, SignalBadge, Stat } from "../ui";
import { Market, Runner, Status } from "../types";
import { pct, price, time } from "../format";

export function MarketsPage({ status, runners, markets, m, filteredMarkets, marketSearch, setMarketSearch, signalCounts, setActive }: {
  status: Status | null;
  runners: Runner[];
  markets: Market[];
  m: Status["metrics"] | undefined;
  filteredMarkets: Market[];
  marketSearch: string;
  setMarketSearch: (v: string) => void;
  signalCounts: { name: string; value: number }[];
  setActive: (v: string) => void;
}) {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Markets"
        description="Live market scanner and strategy signals."
        icon={Radar}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Markets scanned"
          value={String(markets.length)}
          sub="Live Binance markets"
          icon={Radar}
        />

        <Stat
          label="Buy signals"
          value={String(markets.filter((m) => m.signal === "BUY").length)}
          sub="Current strategy signals"
          positive
          icon={ArrowUpRight}
        />

        <Stat
          label="Sell signals"
          value={String(markets.filter((m) => m.signal === "SELL").length)}
          sub="Current strategy signals"
          positive={false}
          icon={ArrowDownRight}
        />
      </div>

      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-4 border-b border-white/6 p-5 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            title="Market scanner"
            description="Live indicators from the trading engine."
          />

          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />

            <input
              value={marketSearch}
              onChange={(e) => setMarketSearch(e.target.value)}
              placeholder="Search market..."
              className="rounded-xl border border-white/7 bg-white/[.03] py-2 pl-9 pr-3 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-indigo-400/30"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-zinc-600">
              <tr className="border-b border-white/5">
                <th className="px-5 py-3">Market</th>

                <th className="px-5 py-3">Price</th>

                <th className="px-5 py-3">24h</th>

                <th className="px-5 py-3">Signal</th>

                <th className="px-5 py-3">Score</th>

                <th className="px-5 py-3">RSI</th>

                <th className="px-5 py-3">ADX</th>

                <th className="px-5 py-3">Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredMarkets.map((x) => (
                <tr
                  key={x.symbol}
                  className="border-b border-white/4 last:border-0 hover:bg-white/[.025]"
                >
                  <td className="px-5 py-4 font-medium">{x.symbol}</td>

                  <td className="px-5 py-4 text-zinc-300">{price(x.price)}</td>

                  <td
                    className={`px-5 py-4 ${
                      x.change >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {pct(x.change)}
                  </td>

                  <td className="px-5 py-4">
                    <SignalBadge signal={x.signal} />
                  </td>

                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-indigo-400"
                          style={{
                            width: `${
                              (x.score / Math.max(x.maxScore, 1)) * 100
                            }%`,
                          }}
                        />
                      </div>

                      <span className="text-zinc-400">
                        {x.score}/{x.maxScore}
                      </span>
                    </div>
                  </td>

                  <td className="px-5 py-4 text-zinc-400">
                    {x.rsi?.toFixed(1) ?? "—"}
                  </td>

                  <td className="px-5 py-4 text-zinc-400">
                    {x.adx?.toFixed(1) ?? "—"}
                  </td>

                  <td className="px-5 py-4">
                    <button
                      onClick={() => {
                        setActive("Positions");
                      }}
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-white"
                    >
                      Details
                      <ChevronRight size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Signal distribution"
            description="Current strategy output."
          />

          <div className="mt-5 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signalCounts}>
                <CartesianGrid stroke="#ffffff08" vertical={false} />

                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#71717a",
                    fontSize: 11,
                  }}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#71717a",
                    fontSize: 11,
                  }}
                />

                <Tooltip
                  contentStyle={{
                    background: "#111620",
                    border: "1px solid #ffffff12",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />

                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {signalCounts.map((_, index) => (
                    <Cell key={index} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Scanner status"
            description="Engine processing state."
          />

          <div className="mt-5 space-y-3">
            {runners.map((runner) => (
              <div
                key={runner.symbol}
                className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[.02] p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-400/10 text-indigo-400">
                    <Radar size={17} />
                  </div>

                  <div>
                    <div className="text-sm font-medium">{runner.symbol}</div>

                    <div className="mt-1 text-xs text-zinc-600">
                      {runner.lastNote || "Waiting for signal"}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm text-zinc-300">
                    {price(runner.price)}
                  </div>

                  <div className="mt-1 text-xs text-zinc-600">
                    {runner.lastProcessed
                      ? time(runner.lastProcessed)
                      : "Not processed"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
