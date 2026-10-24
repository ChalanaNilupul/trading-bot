"use client";

import { SectionHeader, SignalBadge } from "../ui";
import { Market } from "../types";
import { pct, price } from "../format";

export function MarketTable({ markets }: { markets: Market[] }) {
  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className="border-b border-white/6 p-5">
        <SectionHeader
          title="Market scanner"
          description="Same strategy logic used by the paper engine"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-zinc-600">
            <tr className="border-b border-white/5">
              <th className="px-5 py-3">Market</th>

              <th className="px-5 py-3">Price</th>

              <th className="px-5 py-3">24h</th>

              <th className="px-5 py-3">Signal</th>

              <th className="px-5 py-3">Score</th>

              <th className="px-5 py-3">RSI</th>

              <th className="px-5 py-3">ADX</th>
            </tr>
          </thead>

          <tbody>
            {markets.map((x) => (
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

                <td className="px-5 py-4 text-zinc-300">
                  {x.score}/{x.maxScore}
                </td>

                <td className="px-5 py-4 text-zinc-400">
                  {x.rsi?.toFixed(1) ?? "—"}
                </td>

                <td className="px-5 py-4 text-zinc-400">
                  {x.adx?.toFixed(1) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
