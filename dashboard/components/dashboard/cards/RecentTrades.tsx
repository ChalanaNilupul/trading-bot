"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { SectionHeader } from "../ui";
import { Trade } from "../types";
import { money, time } from "../format";

export function RecentTrades({ trades }: { trades: Trade[] }) {
  return (
    <section className="glass rounded-2xl p-5">
      <SectionHeader
        title="Recent trades"
        description="Completed paper executions"
      />

      <div className="mt-5 space-y-1">
        {trades.slice(0, 6).map((t) => (
          <div
            key={`${t.symbol}-${t.exitTime}`}
            className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-white/[.025]"
          >
            <div className="flex items-center gap-3">
              <div
                className={`grid h-9 w-9 place-items-center rounded-lg ${
                  t.netPnL >= 0
                    ? "bg-emerald-400/8 text-emerald-400"
                    : "bg-red-400/8 text-red-400"
                }`}
              >
                {t.netPnL >= 0 ? (
                  <ArrowUpRight size={16} />
                ) : (
                  <ArrowDownRight size={16} />
                )}
              </div>

              <div>
                <div className="text-sm font-medium">
                  {t.symbol}
                  <span
                    className={`ml-1 text-[10px] ${t.side === "SHORT" ? "text-rose-400" : "text-zinc-500"}`}
                  >
                    {t.side || "TRADE"}
                  </span>
                </div>

                <div className="mt-0.5 text-xs text-zinc-600">
                  {time(t.exitTime)} · {t.reason}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div
                className={`text-sm font-medium ${
                  t.netPnL >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {t.netPnL >= 0 ? "+" : ""}
                {money(t.netPnL)}
              </div>

              <div className="text-xs text-zinc-600">
                {t.rMultiple >= 0 ? "+" : ""}
                {t.rMultiple.toFixed(2)}R
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
