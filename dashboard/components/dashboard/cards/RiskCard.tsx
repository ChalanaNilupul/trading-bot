"use client";

import { ShieldCheck } from "lucide-react";
import { SectionHeader } from "../ui";

export function RiskCard({ runners, dailyLoss, drawdown, maxLosses, maxTrades }: any) {
  const risk = runners[0]?.risk;

  const items = [
    [
      "Daily loss",
      `${dailyLoss.toFixed(2)}%`,
      `Limit ${risk?.limits?.maxDailyLossPct ?? 3}%`,
      Math.min(
        (Math.abs(dailyLoss) / (risk?.limits?.maxDailyLossPct || 3)) * 100,
        100,
      ),
    ],

    [
      "Drawdown",
      `${drawdown.toFixed(2)}%`,
      `Limit ${risk?.limits?.maxDrawdownPct ?? 10}%`,
      Math.min((drawdown / (risk?.limits?.maxDrawdownPct || 10)) * 100, 100),
    ],

    [
      "Consecutive losses",
      String(maxLosses),
      `Limit ${risk?.limits?.maxConsecutiveLosses ?? 3}`,
      Math.min(
        (maxLosses / (risk?.limits?.maxConsecutiveLosses || 3)) * 100,
        100,
      ),
    ],

    [
      "Trades today",
      String(maxTrades),
      `Limit ${risk?.limits?.maxTradesPerDay ?? 6}`,
      Math.min((maxTrades / (risk?.limits?.maxTradesPerDay || 6)) * 100, 100),
    ],
  ];

  return (
    <section className="glass rounded-2xl p-5">
      <SectionHeader
        title="Risk monitor"
        description="Across paper accounts"
        icon={ShieldCheck}
      />

      <div className="mt-6 space-y-5">
        {items.map(([a, b, c, w]) => (
          <div key={String(a)}>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">{a}</span>

              <span className="text-zinc-300">
                {b} <span className="text-zinc-600">· {c}</span>
              </span>
            </div>

            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-indigo-400"
                style={{
                  width: `${Number(w)}%`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        className={`mt-6 flex items-center gap-2 rounded-xl border p-3 text-xs ${
          runners.some((r: any) => r.risk?.halted)
            ? "border-red-400/10 bg-red-400/5 text-red-300"
            : "border-emerald-400/10 bg-emerald-400/5 text-emerald-300"
        }`}
      >
        <ShieldCheck size={15} />

        {runners.some((r: any) => r.risk?.halted)
          ? "One or more accounts are HALTED."
          : "All risk guards are clear."}
      </div>
    </section>
  );
}
