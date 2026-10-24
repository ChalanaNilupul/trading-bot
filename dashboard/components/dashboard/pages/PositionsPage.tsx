"use client";

import { Wallet, TrendingUp, Target } from "lucide-react";
import { EmptyState, PageTitle, SectionHeader, Stat } from "../ui";
import { PositionCard } from "../cards/Positions";
import { Runner, Trade } from "../types";
import { money, pct } from "../format";

export function PositionsPage({ runners, positions, trades, equity }: {
  runners: Runner[];
  positions: Runner[];
  trades: Trade[];
  equity: { t: string; v: number }[];
}) {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Positions"
        description="Monitor every currently open paper position."
        icon={Wallet}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Open positions"
          value={String(positions.length)}
          sub="Across paper accounts"
          icon={Wallet}
        />

        <Stat
          label="Unrealized P&L"
          value={money(
            positions.reduce(
              (sum, p) => sum + (p.position?.unrealizedPnl || 0),
              0,
            ),
          )}
          sub="Current open P&L"
          positive={
            positions.reduce(
              (sum, p) => sum + (p.position?.unrealizedPnl || 0),
              0,
            ) >= 0
          }
          icon={TrendingUp}
        />

        <Stat
          label="Exposure"
          value={money(
            positions.reduce(
              (sum, p) =>
                sum +
                (p.position?.entryPrice || 0) * (p.position?.quantity || 0),
              0,
            ),
          )}
          sub="Approx. position value"
          icon={Target}
        />
      </div>

      {positions.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No open positions"
          description="Your paper engine currently has no active trades."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {positions.map((p) => (
            <PositionCard key={p.symbol} position={p} />
          ))}
        </div>
      )}

      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Runner state"
          description="Account-level state for every trading runner."
        />

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-zinc-600">
              <tr className="border-b border-white/5">
                <th className="px-4 py-3">Symbol</th>

                <th className="px-4 py-3">Equity</th>

                <th className="px-4 py-3">Return</th>

                <th className="px-4 py-3">Position</th>

                <th className="px-4 py-3">Risk</th>
              </tr>
            </thead>

            <tbody>
              {runners.map((r) => (
                <tr key={r.symbol} className="border-b border-white/4">
                  <td className="px-4 py-4 font-medium">{r.symbol}</td>

                  <td className="px-4 py-4 text-zinc-300">{money(r.equity)}</td>

                  <td
                    className={`px-4 py-4 ${
                      r.returnPct >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {pct(r.returnPct)}
                  </td>

                  <td className="px-4 py-4 text-zinc-400">
                    {r.position ? r.position.side || "OPEN" : "FLAT"}
                  </td>

                  <td className="px-4 py-4">
                    <span
                      className={
                        r.risk?.halted ? "text-red-400" : "text-emerald-400"
                      }
                    >
                      {r.risk?.halted ? "HALTED" : "CLEAR"}
                    </span>
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
