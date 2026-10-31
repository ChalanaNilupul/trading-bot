"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  LayoutDashboard,
  Menu,
  Pause,
  Play,
  Radar,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
  RefreshCw,
} from "lucide-react";
import {
  BacktestResult,
  Market,
  RuntimeEvent,
  Status,
  Trade,
} from "./dashboard/types";
import { time } from "./dashboard/format";
import { API } from "./dashboard/config";
import { OverviewPage } from "./dashboard/pages/OverviewPage";
import { MarketsPage } from "./dashboard/pages/MarketsPage";
import { PositionsPage } from "./dashboard/pages/PositionsPage";
import { TradesPage } from "./dashboard/pages/TradesPage";
import { BacktestsPage } from "./dashboard/pages/BacktestsPage";
import { StrategiesPage } from "./dashboard/pages/StrategiesPage";
import { RiskPage } from "./dashboard/pages/RiskPage";
import { SettingsPage } from "./dashboard/pages/SettingsPage";

import { AIPage } from "./dashboard/pages/AIPage";

import { SingleCoinLabPage } from "./dashboard/pages/SingleCoinLabPage";

import { DiagnosticsPage } from "./dashboard/pages/DiagnosticsPage";

const nav = [
  ["Overview", LayoutDashboard],
  ["Markets", Radar],
  ["Positions", Wallet],
  ["Trades", Activity],
  ["Backtests", BarChart3],
  ["Diagnostics", Activity],
  ["Single Coin Lab", SlidersHorizontal],
  ["Strategies", SlidersHorizontal],
  ["AI Monitor", Bot],
  ["Risk", ShieldCheck],
] as const;

export default function Dashboard() {
  const [active, setActive] = useState("Overview");
  const [open, setOpen] = useState(false);

  const [status, setStatus] = useState<Status | null>(null);

  const [markets, setMarkets] = useState<Market[]>([]);

  const [trades, setTrades] = useState<Trade[]>([]);
  const [runtimeEvents, setRuntimeEvents] = useState<RuntimeEvent[]>([]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [marketSearch, setMarketSearch] = useState("");

  const [tradeSearch, setTradeSearch] = useState("");

  const [backtestSymbol, setBacktestSymbol] = useState("ETHUSDT");

  const [backtestInterval, setBacktestInterval] = useState("15m");

  const [backtestCandles, setBacktestCandles] = useState("10000");

  const [backtestRunning, setBacktestRunning] = useState(false);

  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(
    null,
  );
  const [backtestStrategy, setBacktestStrategy] = useState("Breakout 50/20");

  const load = useCallback(async () => {
    try {
      const [s, m, t, e] = await Promise.all([
        fetch(`${API}/api/status`, {
          cache: "no-store",
        }).then((r) => r.json()),

        fetch(`${API}/api/markets`, {
          cache: "no-store",
        }).then((r) => r.json()),

        fetch(`${API}/api/trades`, {
          cache: "no-store",
        }).then((r) => r.json()),
        fetch(`${API}/api/events?limit=80`, {
          cache: "no-store",
        }).then((r) => r.json()),
      ]);

      if (s.error) {
        throw new Error(s.error);
      }

      setStatus(s);
      setMarkets(m.markets || []);
      setTrades(t || []);
      setRuntimeEvents((e.events || []).slice(0, 80));
      setError("");
    } catch (e: any) {
      setError(e.message || "Backend API unavailable");
    }
  }, []);

  useEffect(() => {
    load();

    const id = setInterval(load, 5000);

    return () => clearInterval(id);
  }, [load]);

  const command = async (path: string) => {
    setBusy(true);

    try {
      await fetch(`${API}${path}`, {
        method: "POST",
      });

      await load();
    } finally {
      setBusy(false);
    }
  };

  const runners = status?.runners || [];

  const positions = runners.filter((r) => r.position);

  const equity = useMemo(() => {
    let value = status?.portfolio.startingBalance || 0;

    const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);

    return [
      {
        t: "Start",
        v: value,
      },

      ...sorted.slice(-30).map((t) => {
        value += t.netPnL;

        return {
          t: time(t.exitTime),
          v: value,
        };
      }),
    ];
  }, [status, trades]);

  const drawdown = Math.max(...runners.map((r) => r.risk?.drawdownPct || 0), 0);

  const dailyLoss = Math.min(
    ...runners.map((r) => r.risk?.dailyPnlPct || 0),
    0,
  );

  const maxTrades = Math.max(
    ...runners.map((r) => r.risk?.tradesToday || 0),
    0,
  );

  const maxLosses = Math.max(
    ...runners.map((r) => r.risk?.consecutiveLosses || 0),
    0,
  );

  const m = status?.metrics;

  const filteredMarkets = markets.filter((x) =>
    x.symbol.toLowerCase().includes(marketSearch.toLowerCase()),
  );

  const filteredTrades = trades.filter((x) =>
    x.symbol.toLowerCase().includes(tradeSearch.toLowerCase()),
  );

  const winningTrades = trades.filter((t) => t.netPnL > 0);

  const losingTrades = trades.filter((t) => t.netPnL < 0);

  const totalFees = trades.reduce((sum, t) => sum + (t.fees || 0), 0);

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.netPnL, 0);

  const grossLoss = Math.abs(
    losingTrades.reduce((sum, t) => sum + t.netPnL, 0),
  );

  const avgTrade =
    trades.length > 0
      ? trades.reduce((sum, t) => sum + t.netPnL, 0) / trades.length
      : 0;

  const tradeChart = useMemo(() => {
    let running = 0;

    return [...trades]
      .sort((a, b) => a.exitTime - b.exitTime)
      .map((t) => {
        running += t.netPnL;

        return {
          time: time(t.exitTime),
          pnl: t.netPnL,
          cumulative: running,
        };
      });
  }, [trades]);

  const signalCounts = useMemo(() => {
    return [
      {
        name: "BUY",
        value: markets.filter((m) => m.signal === "BUY").length,
      },
      {
        name: "SELL",
        value: markets.filter((m) => m.signal === "SELL").length,
      },
      {
        name: "WAIT",
        value: markets.filter((m) => m.signal !== "BUY" && m.signal !== "SELL")
          .length,
      },
    ];
  }, [markets]);

  const runBacktest = async (direction = "LONG") => {
    setBacktestRunning(true);
    setError("");

    try {
      const response = await fetch(`${API}/api/backtest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: backtestSymbol,
          direction,
          strategy: backtestStrategy,
          interval: backtestInterval,
          candles: Number(backtestCandles),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Backtest failed");
      }

      setBacktestResult(data.result ?? data);
    } catch (e: any) {
      setError(e.message || "Backtest failed");
    } finally {
      setBacktestRunning(false);
    }
  };

  /*
   * ACTIVE PAGE
   */
  const renderPage = () => {
    switch (active) {
      case "Markets":
        return (
          <MarketsPage
            status={status}
            runners={runners}
            markets={markets}
            m={m}
            filteredMarkets={filteredMarkets}
            marketSearch={marketSearch}
            setMarketSearch={setMarketSearch}
            signalCounts={signalCounts}
            setActive={setActive}
          />
        );

      case "Positions":
        return (
          <PositionsPage
            runners={runners}
            positions={positions}
            trades={trades}
            equity={equity}
          />
        );

      case "Trades":
        return (
          <TradesPage
            trades={trades}
            filteredTrades={filteredTrades}
            tradeSearch={tradeSearch}
            setTradeSearch={setTradeSearch}
            avgTrade={avgTrade}
            winningTrades={winningTrades}
            losingTrades={losingTrades}
            totalFees={totalFees}
            tradeChart={tradeChart}
          />
        );

      case "Backtests":
        return (
          <BacktestsPage
            trades={trades}
            equity={equity}
            drawdown={drawdown}
            backtestSymbol={backtestSymbol}
            setBacktestSymbol={setBacktestSymbol}
            backtestInterval={backtestInterval}
            setBacktestInterval={setBacktestInterval}
            backtestCandles={backtestCandles}
            setBacktestCandles={setBacktestCandles}
            backtestRunning={backtestRunning}
            backtestResult={backtestResult}
            runBacktest={runBacktest}
            backtestStrategy={backtestStrategy}
            setBacktestStrategy={setBacktestStrategy}
          />
        );

      case "Strategies":
        return (
          <StrategiesPage
            status={status}
            runners={runners}
            markets={markets}
            equity={equity}
          />
        );

      case "Diagnostics":
        return <DiagnosticsPage result={backtestResult} />;

      case "Single Coin Lab":
        return <SingleCoinLabPage status={status} />;

      case "AI Monitor":
        return <AIPage />;

      case "Risk":
        return (
          <RiskPage
            status={status}
            runners={runners}
            trades={trades}
            dailyLoss={dailyLoss}
            drawdown={drawdown}
            maxLosses={maxLosses}
            maxTrades={maxTrades}
          />
        );

      case "Settings":
        return (
          <SettingsPage
            status={status}
            busy={busy}
            command={command}
            load={load}
          />
        );

      case "Overview":
      default:
        return (
          <OverviewPage
            status={status}
            runners={runners}
            positions={positions}
            trades={trades}
            markets={markets}
            runtimeEvents={runtimeEvents}
            equity={equity}
            m={m}
            dailyLoss={dailyLoss}
            drawdown={drawdown}
            maxLosses={maxLosses}
            maxTrades={maxTrades}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#080b12] text-zinc-100">
      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 border-r border-white/7 bg-[#0b0f17]/95 p-4 backdrop-blur-xl transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-12 items-center justify-between px-2">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-500/15 text-indigo-400">
              <Bot size={19} />
            </div>

            <div>
              <div className="font-semibold">TradeLab</div>

              <div className="text-[10px] uppercase tracking-[.18em] text-zinc-500">
                Personal Bot
              </div>
            </div>
          </div>

          <button
            className="text-zinc-500 lg:hidden"
            onClick={() => setOpen(false)}
          >
            <X size={19} />
          </button>
        </div>

        <div className="mt-8 space-y-1">
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              onClick={() => {
                setActive(label);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                active === label
                  ? "bg-white/7 text-white"
                  : "text-zinc-500 hover:bg-white/4 hover:text-zinc-200"
              }`}
            >
              <Icon size={17} />

              {label}

              {label === "Risk" && (
                <span
                  className={`ml-auto h-2 w-2 rounded-full ${
                    drawdown < 10 ? "bg-emerald-400" : "bg-red-400"
                  }`}
                />
              )}
            </button>
          ))}
        </div>

        <div className="mt-8 border-t border-white/6 pt-5">
          <div className="px-3 text-[10px] font-medium uppercase tracking-[.18em] text-zinc-600">
            System
          </div>

          <button
            onClick={() => {
              setActive("Settings");
              setOpen(false);
            }}
            className={`mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
              active === "Settings"
                ? "bg-white/7 text-white"
                : "text-zinc-500 hover:bg-white/4 hover:text-zinc-200"
            }`}
          >
            <Settings size={17} />
            Settings
          </button>
        </div>

        <div className="absolute bottom-5 left-4 right-4 rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />

            {status?.running ? "Paper engine running" : "Paper engine stopped"}
          </div>

          <div className="mt-2 text-[11px] leading-5 text-zinc-500">
            No real orders can be placed from this dashboard.
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-white/6 bg-[#080b12]/80 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg p-2 text-zinc-400 hover:bg-white/5 lg:hidden"
                onClick={() => setOpen(true)}
              >
                <Menu size={20} />
              </button>

              <div>
                <div className="text-sm font-medium">{active}</div>

                <div className="text-xs text-zinc-500">
                  {status
                    ? `Updated ${time(status.updatedAt)}`
                    : "Connecting to backend…"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-xs text-amber-300 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                PAPER MODE
              </div>

              <button
                onClick={load}
                className="rounded-xl border border-white/7 bg-white/3 p-2 text-zinc-400 hover:text-white"
              >
                <RefreshCw size={17} />
              </button>

              <button
                disabled={busy || !status}
                onClick={() =>
                  command(status?.running ? "/api/bot/stop" : "/api/bot/start")
                }
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${
                  status?.running
                    ? "bg-indigo-500 text-white"
                    : "bg-white/7 text-zinc-300"
                }`}
              >
                {status?.running ? <Pause size={14} /> : <Play size={14} />}

                <span className="hidden sm:inline">
                  {status?.running ? "Bot running" : "Start bot"}
                </span>
              </button>
            </div>
          </div>
        </header>

        <div className="grid-bg min-h-[calc(100vh-64px)] p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-[1500px]">
            {error && (
              <div className="mb-6 rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
                Backend connection error: {error}
                <div className="mt-2 text-xs text-red-300/70">
                  Start the API with{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5">
                    node --env-file=.env src/api.js
                  </code>{" "}
                  in your backend folder.
                </div>
              </div>
            )}

            {renderPage()}

            <footer className="mt-8 flex flex-col justify-between gap-2 border-t border-white/5 py-5 text-xs text-zinc-600 sm:flex-row">
              <span>TradeLab · personal research & paper trading</span>

              <span>
                Engine: {status?.running ? "running" : "stopped"} · Binance data
                · PAPER
              </span>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
