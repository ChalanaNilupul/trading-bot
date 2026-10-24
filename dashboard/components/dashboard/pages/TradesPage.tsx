"use client";

import { Activity, ArrowDownRight, ArrowUpRight, Wallet, CircleDollarSign, Search, LineChart } from "lucide-react";
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Line, LineChart as RechartsLineChart } from "recharts";
import { EmptyState, PageTitle, SectionHeader, Stat } from "../ui";
import { Trade } from "../types";
import { money, price, time } from "../format";

export function TradesPage({ trades, filteredTrades, tradeSearch, setTradeSearch, avgTrade, winningTrades, losingTrades, totalFees, tradeChart }: {
  trades: Trade[];
  filteredTrades: Trade[];
  tradeSearch: string;
  setTradeSearch: (v: string) => void;
  avgTrade: number;
  winningTrades: Trade[];
  losingTrades: Trade[];
  totalFees: number;
  tradeChart: { time: string; pnl: number; cumulative: number }[];
}) {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Trades"
        description="Complete paper trading execution history."
        icon={Activity}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Total trades"
          value={String(trades.length)}
          sub="Completed executions"
          icon={Activity}
        />

        <Stat
          label="Winning"
          value={String(winningTrades.length)}
          sub={`${
            trades.length
              ? ((winningTrades.length / trades.length) * 100).toFixed(1)
              : "0.0"
          }% of trades`}
          icon={ArrowUpRight}
          positive
        />

        <Stat
          label="Losing"
          value={String(losingTrades.length)}
          sub="Closed losing trades"
          icon={ArrowDownRight}
          positive={false}
        />

        <Stat
          label="Average trade"
          value={money(avgTrade)}
          sub="Net P&L / trade"
          positive={avgTrade >= 0}
          icon={CircleDollarSign}
        />

        <Stat
          label="Fees"
          value={money(totalFees)}
          sub="Total recorded fees"
          icon={Wallet}
        />
      </div>

      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Cumulative P&L"
          description="Realized performance across completed trades."
        />

        <div className="mt-5 h-[300px]">
          {tradeChart.length === 0 ? (
            <EmptyState
              icon={LineChart}
              title="No trade data"
              description="The P&L chart will populate when the engine completes trades."
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <RechartsLineChart data={tradeChart}>
                <CartesianGrid stroke="#ffffff08" vertical={false} />

                <XAxis
                  dataKey="time"
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#71717a",
                    fontSize: 10,
                  }}
                />

                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{
                    fill: "#71717a",
                    fontSize: 10,
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

                <Line
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#818cf8"
                  strokeWidth={2}
                  dot={false}
                />
              </RechartsLineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-4 border-b border-white/6 p-5 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            title="Trade history"
            description={`${filteredTrades.length} executions`}
          />

          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />

            <input
              value={tradeSearch}
              onChange={(e) => setTradeSearch(e.target.value)}
              placeholder="Search symbol..."
              className="rounded-xl border border-white/7 bg-white/[.03] py-2 pl-9 pr-3 text-xs text-zinc-300 outline-none placeholder:text-zinc-700"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-zinc-600">
              <tr className="border-b border-white/5">
                <th className="px-5 py-3">Symbol</th>

                <th className="px-5 py-3">Entry</th>

                <th className="px-5 py-3">Exit</th>

                <th className="px-5 py-3">Quantity</th>

                <th className="px-5 py-3">Reason</th>

                <th className="px-5 py-3">Fees</th>

                <th className="px-5 py-3">P&L</th>

                <th className="px-5 py-3">R</th>
              </tr>
            </thead>

            <tbody>
              {filteredTrades.map((t) => (
                <tr
                  key={`${t.symbol}-${t.exitTime}`}
                  className="border-b border-white/4 hover:bg-white/[.02]"
                >
                  <td className="px-5 py-4 font-medium">{t.symbol}</td>

                  <td className="px-5 py-4 text-zinc-400">
                    <div>{price(t.entryPrice)}</div>

                    <div className="mt-1 text-[10px] text-zinc-600">
                      {time(t.entryTime)}
                    </div>
                  </td>

                  <td className="px-5 py-4 text-zinc-400">
                    <div>{price(t.exitPrice)}</div>

                    <div className="mt-1 text-[10px] text-zinc-600">
                      {time(t.exitTime)}
                    </div>
                  </td>

                  <td className="px-5 py-4 text-zinc-400">{t.quantity}</td>

                  <td className="px-5 py-4">
                    <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-400">
                      {t.reason}
                    </span>
                  </td>

                  <td className="px-5 py-4 text-zinc-500">{money(t.fees)}</td>

                  <td
                    className={`px-5 py-4 font-medium ${
                      t.netPnL >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {t.netPnL >= 0 ? "+" : ""}
                    {money(t.netPnL)}
                  </td>

                  <td
                    className={`px-5 py-4 ${
                      t.rMultiple >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {t.rMultiple >= 0 ? "+" : ""}
                    {t.rMultiple.toFixed(2)}R
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
