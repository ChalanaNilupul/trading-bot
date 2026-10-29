"use client";

import { useState } from "react";

import {
  Activity,
  BarChart3,
  Gauge,
  Play,
  ShieldCheck,
  Wallet,
  RefreshCw,
  TrendingUp,
  LineChart,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";
import {
  ConfigRow,
  EmptyState,
  InputSelect,
  MetricBox,
  PageTitle,
  SectionHeader,
  Stat,
} from "../ui";
import { BacktestResult, Trade } from "../types";
import { money, pct, price, time } from "../format";

export function BacktestsPage({
  trades,
  equity,
  drawdown,
  backtestSymbol,
  setBacktestSymbol,
  backtestInterval,
  setBacktestInterval,
  backtestCandles,
  setBacktestCandles,
  backtestRunning,
  backtestResult,
  runBacktest,
  backtestStrategy,
  setBacktestStrategy,
}: {
  trades: Trade[];
  equity: { t: string; v: number }[];
  drawdown: number;
  backtestSymbol: string;
  setBacktestSymbol: (v: string) => void;
  backtestInterval: string;
  setBacktestInterval: (v: string) => void;
  backtestCandles: string;
  setBacktestCandles: (v: string) => void;
  backtestRunning: boolean;
  backtestResult: BacktestResult | null;
  runBacktest: (direction?: string) => Promise<void>;
  backtestStrategy: string;
  setBacktestStrategy: (v: string) => void;
}) {
  const result = backtestResult;
  const [direction, setDirection] = useState("LONG");

  // if (!result?.config || !result?.period || !result?.full) {
  //   return (
  //     <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
  //       <h2 className="text-xl font-semibold text-white">Backtests</h2>
  //       <p className="mt-2 text-sm text-zinc-400">
  //         Run a backtest to see the results here.
  //       </p>
  //     </div>
  //   );
  // }

  const metrics = result?.full?.metrics;

  const backtestChart =
    result?.full?.equityCurve?.map((point: any) => ({
      time: point.time,
      equity: point.equity,
    })) ?? [];

  const exitReasons = metrics
    ? Object.entries(metrics.byReason || {}).map(([name, value]) => ({
        name,
        value,
      }))
    : [];

  return (
    <div className="space-y-6">
      <PageTitle
        title="Backtests"
        description="Test your strategy against historical Binance candles."
        icon={BarChart3}
      />

      {/* <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">Note: the backend backtest endpoint is still the legacy backtester, not the new Futures paper engine. Do not interpret these results as Futures backtest results.</div> */}

      {/* CONFIGURATION */}
      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Run a backtest"
          description="Choose a coin and direction. AI is excluded; backtesting never changes your running bot."
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <InputSelect
            label="Strategy"
            value={backtestStrategy}
            onChange={setBacktestStrategy}
            options={[
              "Current (score)",
              "Breakout 50/20",
              "Breakout 30/15",
              "Breakout 40/20",
              "Breakout 50/30",
              "Breakout 60/20",
              "Breakout 80/30",
              "Dip buy (RSI)",
              "EMA pullback",
              "Trend filter only",
            ]}
          />
          <InputSelect label="Direction" value={direction} onChange={setDirection} options={["LONG", "SHORT"]} />
          <InputSelect
            label="Symbol"
            value={backtestSymbol}
            onChange={setBacktestSymbol}
            options={[
              "BTCUSDT",
              "ETHUSDT",
              "BNBUSDT",
              "SOLUSDT",
              "XRPUSDT",
              "ADAUSDT",
              "AVAXUSDT",
              "LINKUSDT",
            ]}
          />

          <InputSelect
            label="Interval"
            value={backtestInterval}
            onChange={setBacktestInterval}
            options={["1m", "5m", "15m", "30m", "1h", "4h", "1d"]}
          />

          <div>
            <label className="mb-2 block text-xs text-zinc-500">Candles</label>

            <input
              type="number"
              min="500"
              max="20000"
              value={backtestCandles}
              onChange={(e) => setBacktestCandles(e.target.value)}
              className="w-full rounded-xl border border-white/7 bg-white/[.03] px-3 py-2.5 text-sm text-zinc-300 outline-none focus:border-indigo-400/30"
            />
          </div>

          <div className="flex items-end">
            <button
              disabled={backtestRunning}
              onClick={() => void runBacktest(direction)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {backtestRunning ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play size={15} />
                  Run backtest
                </>
              )}
            </button>
          </div>
        </div>

        {result && (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
            <span className="rounded-lg bg-white/5 px-3 py-1.5">
              {result.config?.strategy ?? backtestStrategy}
            </span>
            <span className="rounded-lg bg-white/5 px-3 py-1.5">
              {result.config?.symbol ?? "—"}
            </span>

            <span className="rounded-lg bg-white/5 px-3 py-1.5">
              {result.config.interval}
            </span>

            <span className="rounded-lg bg-white/5 px-3 py-1.5">
              {result.config.candlesUsed.toLocaleString()} candles
            </span>

            <span className="rounded-lg bg-white/5 px-3 py-1.5">
              {result.period.days} days
            </span>
          </div>
        )}
      </section>

      {!result ? (
        <section className="glass rounded-2xl p-5">
          <EmptyState
            icon={BarChart3}
            title="No backtest loaded"
            description="Choose a market, timeframe and candle count, then run the backtest."
          />
        </section>
      ) : (
        <>
          {/* MAIN METRICS */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat
              label="Return"
              value={pct(metrics?.returnPct || 0)}
              sub={`Buy & hold ${pct(result.full.buyHold)}`}
              positive={(metrics?.returnPct || 0) >= 0}
              icon={TrendingUp}
            />

            <Stat
              label="Final equity"
              value={money(metrics?.finalEquity || 0)}
              sub={`Started ${money(metrics?.startingBalance || 0)}`}
              positive={(metrics?.returnPct || 0) >= 0}
              icon={Wallet}
            />

            <Stat
              label="Max drawdown"
              value={`${(metrics?.maxDrawdownPct || 0).toFixed(2)}%`}
              sub="Historical risk"
              positive={(metrics?.maxDrawdownPct || 0) < 10}
              icon={ShieldCheck}
            />

            <Stat
              label="Trades"
              value={String(metrics?.trades || 0)}
              sub={`${(metrics?.winRate || 0).toFixed(1)}% win rate`}
              positive={(metrics?.winRate || 0) >= 50}
              icon={Activity}
            />

            <Stat
              label="Profit factor"
              value={
                metrics?.profitFactor === Infinity
                  ? "∞"
                  : (metrics?.profitFactor || 0).toFixed(2)
              }
              sub={`Expectancy ${money(metrics?.expectancy || 0)}`}
              positive={(metrics?.profitFactor || 0) >= 1}
              icon={Gauge}
            />
          </div>

          {/* EQUITY CURVE */}
          <section className="glass rounded-2xl p-5">
            <SectionHeader
              title="Backtest equity curve"
              description={`Historical simulation · {result.config?.symbol ?? "—"} · ${result.config.interval}`}
            />

            <div className="mt-5 h-[360px]">
              {backtestChart.length === 0 ? (
                <EmptyState
                  icon={LineChart}
                  title="No equity data"
                  description="The backtest did not return an equity curve."
                />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={backtestChart}>
                    <defs>
                      <linearGradient
                        id="backtestEquityFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="#6366f1"
                          stopOpacity={0.3}
                        />

                        <stop
                          offset="100%"
                          stopColor="#6366f1"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>

                    <CartesianGrid stroke="#ffffff08" vertical={false} />

                    <XAxis
                      dataKey="time"
                      axisLine={false}
                      tickLine={false}
                      minTickGap={40}
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
                      tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                    />

                    <Tooltip
                      contentStyle={{
                        background: "#111620",
                        border: "1px solid #ffffff12",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value) => [
                        `$${Number(value).toFixed(2)}`,
                        "Equity",
                      ]}
                    />

                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="#818cf8"
                      strokeWidth={2}
                      fill="url(#backtestEquityFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {/* PERFORMANCE COMPARISON */}
          <div className="grid gap-6 xl:grid-cols-3">
            <section className="glass rounded-2xl p-5">
              <SectionHeader
                title="Full period"
                description="Complete historical test"
              />

              <div className="mt-5 space-y-3">
                <ConfigRow
                  label="Return"
                  value={pct(metrics?.returnPct || 0)}
                />

                <ConfigRow
                  label="Buy & hold"
                  value={pct(result.full.buyHold)}
                />

                <ConfigRow
                  label="Final equity"
                  value={money(metrics?.finalEquity || 0)}
                />

                <ConfigRow
                  label="Trades"
                  value={String(metrics?.trades || 0)}
                />

                <ConfigRow
                  label="Win rate"
                  value={`${(metrics?.winRate || 0).toFixed(1)}%`}
                />

                <ConfigRow
                  label="Profit factor"
                  value={
                    metrics?.profitFactor === Infinity
                      ? "∞"
                      : (metrics?.profitFactor || 0).toFixed(2)
                  }
                />
              </div>
            </section>

            <section className="glass rounded-2xl p-5">
              <SectionHeader
                title="In-sample"
                description={`${Math.round(
                  result.config.split * 100,
                )}% of historical data`}
              />

              <div className="mt-5 space-y-3">
                <ConfigRow
                  label="Return"
                  value={pct(result.inSample.metrics.returnPct)}
                />

                <ConfigRow
                  label="Buy & hold"
                  value={pct(result.inSample.buyHold)}
                />

                <ConfigRow
                  label="Trades"
                  value={String(result.inSample.metrics.trades)}
                />

                <ConfigRow
                  label="Win rate"
                  value={`${result.inSample.metrics.winRate.toFixed(1)}%`}
                />

                <ConfigRow
                  label="Profit factor"
                  value={
                    result.inSample.metrics.profitFactor === Infinity
                      ? "∞"
                      : result.inSample.metrics.profitFactor.toFixed(2)
                  }
                />

                <ConfigRow
                  label="Max drawdown"
                  value={`${result.inSample.metrics.maxDrawdownPct.toFixed(
                    2,
                  )}%`}
                />
              </div>
            </section>

            <section className="glass rounded-2xl p-5">
              <SectionHeader
                title="Out-of-sample"
                description={`${Math.round(
                  (1 - result.config.split) * 100,
                )}% unseen data`}
              />

              <div className="mt-5 space-y-3">
                <ConfigRow
                  label="Return"
                  value={pct(result.outSample.metrics.returnPct)}
                />

                <ConfigRow
                  label="Buy & hold"
                  value={pct(result.outSample.buyHold)}
                />

                <ConfigRow
                  label="Trades"
                  value={String(result.outSample.metrics.trades)}
                />

                <ConfigRow
                  label="Win rate"
                  value={`${result.outSample.metrics.winRate.toFixed(1)}%`}
                />

                <ConfigRow
                  label="Profit factor"
                  value={
                    result.outSample.metrics.profitFactor === Infinity
                      ? "∞"
                      : result.outSample.metrics.profitFactor.toFixed(2)
                  }
                />

                <ConfigRow
                  label="Max drawdown"
                  value={`${result.outSample.metrics.maxDrawdownPct.toFixed(
                    2,
                  )}%`}
                />
              </div>
            </section>
          </div>

          {/* ADVANCED METRICS */}
          <section className="glass rounded-2xl p-5">
            <SectionHeader
              title="Performance metrics"
              description="Detailed statistics from the backtest."
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricBox
                label="Sharpe ratio"
                value={metrics?.sharpe?.toFixed(2) || "0.00"}
              />

              <MetricBox
                label="Sortino ratio"
                value={metrics?.sortino?.toFixed(2) || "0.00"}
              />

              <MetricBox
                label="Expectancy"
                value={money(metrics?.expectancy || 0)}
              />

              <MetricBox
                label="Average R"
                value={`${(metrics?.avgR || 0).toFixed(2)}R`}
              />

              <MetricBox
                label="Average win"
                value={money(metrics?.avgWin || 0)}
              />

              <MetricBox
                label="Average loss"
                value={money(metrics?.avgLoss || 0)}
              />

              <MetricBox
                label="Payoff ratio"
                value={(metrics?.payoff || 0).toFixed(2)}
              />

              <MetricBox label="Fees paid" value={money(metrics?.fees || 0)} />
            </div>
          </section>

          {/* EXIT BREAKDOWN */}
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="glass rounded-2xl p-5">
              <SectionHeader
                title="Exit breakdown"
                description="How the strategy closed trades."
              />

              {exitReasons.length === 0 ? (
                <div className="mt-5">
                  <EmptyState
                    icon={Activity}
                    title="No exits"
                    description="No completed trades were returned."
                  />
                </div>
              ) : (
                <div className="mt-5 h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={exitReasons} layout="vertical">
                      <CartesianGrid stroke="#ffffff08" horizontal={false} />

                      <XAxis
                        type="number"
                        axisLine={false}
                        tickLine={false}
                        tick={{
                          fill: "#71717a",
                          fontSize: 10,
                        }}
                      />

                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        axisLine={false}
                        tickLine={false}
                        tick={{
                          fill: "#a1a1aa",
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

                      <Bar
                        dataKey="value"
                        fill="#818cf8"
                        radius={[0, 6, 6, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="glass rounded-2xl p-5">
              <SectionHeader
                title="Backtest configuration"
                description="Parameters used for this simulation."
              />

              <div className="mt-5 space-y-2">
                <ConfigRow
                  label="Symbol"
                  value={result.config?.symbol ?? "—"}
                />

                <ConfigRow label="Direction" value={result.config.direction || "LONG"} />
                <ConfigRow label="Interval" value={result.config.interval} />

                <ConfigRow
                  label="Candles"
                  value={result.config.candlesUsed.toLocaleString()}
                />

                <ConfigRow
                  label="Fee rate"
                  value={`${(result.config.feeRate * 100).toFixed(2)}%`}
                />

                <ConfigRow
                  label="Slippage"
                  value={`${(result.config.slippage * 100).toFixed(2)}%`}
                />

                <ConfigRow
                  label="Trailing stop"
                  value={result.config.trailing ? "Enabled" : "Disabled"}
                />

                <ConfigRow
                  label="Train / test split"
                  value={`${Math.round(
                    result.config.split * 100,
                  )}% / ${Math.round((1 - result.config.split) * 100)}%`}
                />

                <ConfigRow
                  label="Risk halt exits"
                  value={String(result.risk.haltExits)}
                />
              </div>
            </section>
          </div>

          {/* TRADES */}
          <section className="glass overflow-hidden rounded-2xl">
            <div className="border-b border-white/6 p-5">
              <SectionHeader
                title="Backtest trades"
                description={`${result.full.trades.length} historical executions`}
              />
            </div>

            {result.full.trades.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={Activity}
                  title="No trades"
                  description="The strategy did not generate any completed trades during this test."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1000px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-zinc-600">
                    <tr className="border-b border-white/5">
                      <th className="px-5 py-3">Entry</th>
                      <th className="px-5 py-3">Exit</th>
                      <th className="px-5 py-3">Entry price</th>
                      <th className="px-5 py-3">Exit price</th>
                      <th className="px-5 py-3">Quantity</th>
                      <th className="px-5 py-3">Reason</th>
                      <th className="px-5 py-3">Net P&L</th>
                      <th className="px-5 py-3">R</th>
                    </tr>
                  </thead>

                  <tbody>
                    {result.full.trades
                      .slice()
                      .reverse()
                      .slice(0, 100)
                      .map((trade: any, index: number) => (
                        <tr
                          key={`${trade.entryTime}-${trade.exitTime}-${index}`}
                          className="border-b border-white/4 hover:bg-white/[.02]"
                        >
                          <td className="px-5 py-4 text-xs text-zinc-400">
                            {time(trade.entryTime)}
                          </td>

                          <td className="px-5 py-4 text-xs text-zinc-400">
                            {time(trade.exitTime)}
                          </td>

                          <td className="px-5 py-4 text-zinc-300">
                            {price(trade.entryPrice)}
                          </td>

                          <td className="px-5 py-4 text-zinc-300">
                            {price(trade.exitPrice)}
                          </td>

                          <td className="px-5 py-4 text-zinc-400">
                            {trade.quantity}
                          </td>

                          <td className="px-5 py-4">
                            <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-400">
                              {trade.reason}
                            </span>
                          </td>

                          <td
                            className={`px-5 py-4 font-medium ${
                              trade.netPnL >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {trade.netPnL >= 0 ? "+" : ""}
                            {money(trade.netPnL)}
                          </td>

                          <td
                            className={`px-5 py-4 ${
                              trade.rMultiple >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {trade.rMultiple >= 0 ? "+" : ""}
                            {Number(trade.rMultiple).toFixed(2)}R
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
