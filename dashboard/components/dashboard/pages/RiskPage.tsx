"use client";

import { Activity, ShieldCheck, Target, CheckCircle2, AlertTriangle } from "lucide-react";
import { PageTitle, RiskExplanation, RiskStat, SectionHeader } from "../ui";
import { Runner, Status, Trade } from "../types";
import { pct } from "../format";

export function RiskPage({ status, runners, trades, dailyLoss, drawdown, maxLosses, maxTrades }: {
  status: Status | null;
  runners: Runner[];
  trades: Trade[];
  dailyLoss: number;
  drawdown: number;
  maxLosses: number;
  maxTrades: number;
}) {
  return (
    <div className="space-y-6">
      <PageTitle
        title="Risk"
        description="Portfolio risk controls and trading protection."
        icon={ShieldCheck}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <RiskStat
          label="Daily loss"
          value={`${dailyLoss.toFixed(2)}%`}
          limit={runners[0]?.risk?.limits?.maxDailyLossPct ?? 3}
          current={Math.abs(dailyLoss)}
        />

        <RiskStat
          label="Drawdown"
          value={`${drawdown.toFixed(2)}%`}
          limit={runners[0]?.risk?.limits?.maxDrawdownPct ?? 10}
          current={drawdown}
        />

        <RiskStat
          label="Consecutive losses"
          value={String(maxLosses)}
          limit={runners[0]?.risk?.limits?.maxConsecutiveLosses ?? 3}
          current={maxLosses}
        />

        <RiskStat
          label="Trades today"
          value={String(maxTrades)}
          limit={runners[0]?.risk?.limits?.maxTradesPerDay ?? 6}
          current={maxTrades}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Risk guards"
            description="Protection rules enforced by the engine."
          />

          <div className="mt-5 space-y-3">
            {[
              [
                "Maximum daily loss",
                runners[0]?.risk?.limits?.maxDailyLossPct ?? 3,
                "%",
              ],
              [
                "Maximum drawdown",
                runners[0]?.risk?.limits?.maxDrawdownPct ?? 10,
                "%",
              ],
              [
                "Maximum consecutive losses",
                runners[0]?.risk?.limits?.maxConsecutiveLosses ?? 3,
                " losses",
              ],
              [
                "Maximum trades per day",
                runners[0]?.risk?.limits?.maxTradesPerDay ?? 6,
                " trades",
              ],
            ].map(([label, value, suffix]) => (
              <div
                key={String(label)}
                className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[.02] p-4"
              >
                <span className="text-sm text-zinc-400">{label}</span>

                <span className="font-medium text-zinc-200">
                  {String(value)}
                  {String(suffix)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Account status"
            description="Risk state across all runners."
          />

          <div className="mt-5 space-y-3">
            {runners.map((runner) => (
              <div
                key={runner.symbol}
                className={`rounded-xl border p-4 ${
                  runner.risk?.halted
                    ? "border-red-400/15 bg-red-400/5"
                    : "border-emerald-400/10 bg-emerald-400/5"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {runner.risk?.halted ? (
                      <AlertTriangle size={18} className="text-red-400" />
                    ) : (
                      <CheckCircle2 size={18} className="text-emerald-400" />
                    )}

                    <span className="font-medium">{runner.symbol}</span>
                  </div>

                  <span
                    className={`text-xs ${
                      runner.risk?.halted ? "text-red-300" : "text-emerald-300"
                    }`}
                  >
                    {runner.risk?.halted ? "HALTED" : "CLEAR"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-zinc-600">Daily P&L</div>

                    <div className="mt-1 text-zinc-300">
                      {pct(runner.risk?.dailyPnlPct || 0)}
                    </div>
                  </div>

                  <div>
                    <div className="text-zinc-600">Drawdown</div>

                    <div className="mt-1 text-zinc-300">
                      {(runner.risk?.drawdownPct || 0).toFixed(2)}%
                    </div>
                  </div>

                  <div>
                    <div className="text-zinc-600">Loss streak</div>

                    <div className="mt-1 text-zinc-300">
                      {runner.risk?.consecutiveLosses || 0}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Risk philosophy"
          description="Why these controls exist."
        />

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <RiskExplanation
            icon={ShieldCheck}
            title="Capital protection"
            text="The system should stop taking new trades before losses become uncontrolled."
          />

          <RiskExplanation
            icon={Activity}
            title="Consistency"
            text="Daily limits prevent a bad trading session from dominating the entire account."
          />

          <RiskExplanation
            icon={Target}
            title="Position discipline"
            text="Every position should have a defined stop and target before execution."
          />
        </div>
      </section>
    </div>
  );
}
