"use client";

import { Wallet, Target } from "lucide-react";
import { EmptyState, SectionHeader } from "../ui";
import { Runner } from "../types";
import { money, price } from "../format";

export function PositionsCard({ positions }: { positions: Runner[] }) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Open positions"
          description="Current account positions"
        />

        <span className="rounded-lg bg-white/5 px-2 py-1 text-xs text-zinc-400">
          {positions.length} open
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {positions.length ? (
          positions.map((p) => <PositionCard key={p.symbol} position={p} />)
        ) : (
          <EmptyState
            icon={Wallet}
            title="No open positions"
            description="No active positions."
          />
        )}
      </div>
    </section>
  );
}

export function PositionCard({ position: p }: { position: Runner }) {
  const pos = p.position;

  return (
    <div className="rounded-xl border border-white/6 bg-white/[.02] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{p.symbol}</div>

          <div
            className={`mt-1 text-xs ${pos.side === "SHORT" ? "text-rose-400" : "text-emerald-400"}`}
          >
            {pos.side || "OPEN"} · {pos.leverage || 5}×
          </div>
        </div>

        <div
          className={`text-right ${
            pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-red-400"
          }`}
        >
          <div className="font-medium">{money(pos.unrealizedPnl)}</div>

          <div className="text-xs text-zinc-600">unrealized</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
        <PositionValue label="Entry" value={price(pos.entryPrice)} />

        <PositionValue label="Current" value={price(pos.currentPrice)} />

        <PositionValue label="Stop" value={price(pos.stopPrice)} red />

        <PositionValue label="Target" value={pos.targetPrice == null ? "Disabled" : price(pos.targetPrice)} green />

        <PositionValue label="Isolated margin" value={money(pos.margin || 0)} />

        <PositionValue
          label="Liquidation est."
          value={price(pos.liquidationPrice)}
          red
        />
      </div>
    </div>
  );
}

export function PositionValue({
  label,
  value,
  red,
  green,
}: {
  label: string;
  value: string;
  red?: boolean;
  green?: boolean;
}) {
  return (
    <div>
      <div className="text-zinc-600">{label}</div>

      <div
        className={`mt-1 ${
          red ? "text-red-300" : green ? "text-emerald-300" : "text-zinc-300"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
