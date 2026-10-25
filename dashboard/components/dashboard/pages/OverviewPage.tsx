"use client";

import {
  Activity,
  Gauge,
  ShieldCheck,
  Wallet,
  CircleDollarSign,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionHeader, Stat } from "../ui";
import { RiskCard } from "../cards/RiskCard";
import { OperationsMonitor } from "../cards/OperationsMonitor";
import { MarketTable } from "../cards/MarketTable";
import { PositionsCard } from "../cards/Positions";
import { RecentTrades } from "../cards/RecentTrades";
import { Market, Runner, RuntimeEvent, Status, Trade } from "../types";
import { money, pct, time } from "../format";

export function OverviewPage({
  status,
  runners,
  positions,
  trades,
  markets,
  runtimeEvents,
  equity,
  m,
  dailyLoss,
  drawdown,
  maxLosses,
  maxTrades,
}: {
  status: Status | null;
  runners: Runner[];
  positions: Runner[];
  trades: Trade[];
  markets: Market[];
  runtimeEvents: RuntimeEvent[];
  equity: { t: string; v: number }[];
  m: Status["metrics"] | undefined;
  dailyLoss: number;
  drawdown: number;
  maxLosses: number;
  maxTrades: number;
}) {
  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-400/15 bg-indigo-400/5 px-3 py-1 text-[11px] text-indigo-300">
            <Activity size={12} />
            {status?.strategy || "Strategy"} · {status?.interval || "—"}
          </div>

          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Trading overview
          </h1>

          <p className="mt-1 text-sm text-zinc-500">
            Live paper account state from your Node trading engine.
          </p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat
          label="Paper equity"
          value={money(status?.portfolio.equity || 0)}
          sub={`${pct(status?.portfolio.returnPct || 0)} all time`}
          positive={(status?.portfolio.returnPct || 0) >= 0}
          icon={Wallet}
        />

        <Stat
          label="Total P&L"
          value={money(
            (status?.portfolio.equity || 0) -
              (status?.portfolio.startingBalance || 0),
          )}
          sub={`${m?.trades || 0} closed trades`}
          positive={(status?.portfolio.returnPct || 0) >= 0}
          icon={CircleDollarSign}
        />

        <Stat
          label="Daily P&L"
          value={pct(dailyLoss)}
          sub="Worst account today"
          positive={dailyLoss >= 0}
          icon={TrendingUp}
        />

        <Stat
          label="Max drawdown"
          value={`${drawdown.toFixed(2)}%`}
          sub={`Limit ${runners[0]?.risk?.limits?.maxDrawdownPct ?? 10}%`}
          positive={drawdown < (runners[0]?.risk?.limits?.maxDrawdownPct ?? 10)}
          icon={ShieldCheck}
        />

        <Stat
          label="Profit factor"
          value={
            m?.profitFactor === Infinity
              ? "∞"
              : (m?.profitFactor || 0).toFixed(2)
          }
          sub={`${m?.winRate?.toFixed(1) || "0.0"}% win rate`}
          positive={(m?.profitFactor || 0) >= 1}
          icon={Gauge}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,.8fr)]">
        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Equity curve"
            description={`Realized paper equity · ${money(
              status?.portfolio.startingBalance || 0,
            )} starting`}
          />

          <div className="mt-5 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={equity}>
                <defs>
                  <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />

                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke="#ffffff08" vertical={false} />

                <XAxis
                  dataKey="t"
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
                  tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                />

                <Tooltip
                  contentStyle={{
                    background: "#111620",
                    border: "1px solid #ffffff12",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v) => [`$${Number(v).toFixed(2)}`, "Equity"]}
                />

                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="#818cf8"
                  strokeWidth={2}
                  fill="url(#equityFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <RiskCard
          runners={runners}
          dailyLoss={dailyLoss}
          drawdown={drawdown}
          maxLosses={maxLosses}
          maxTrades={maxTrades}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <PositionsCard positions={positions} />

        <RecentTrades trades={trades} />
      </div>

      <MarketTable markets={markets} />

      <OperationsMonitor status={status} events={runtimeEvents} />
    </div>
  );
}
