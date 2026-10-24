"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bot,
  Gauge,
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
  CircleDollarSign,
  RefreshCw,
  TrendingUp,
  Search,
  Download,
  Clock3,
  Target,
  Zap,
  Database,
  Server,
  Terminal,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  LineChart,
  Cpu,
  Save,
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
  Cell,
  Line,
  LineChart as RechartsLineChart,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";

const nav = [
  ["Overview", LayoutDashboard],
  ["Markets", Radar],
  ["Positions", Wallet],
  ["Trades", Activity],
  ["Backtests", BarChart3],
  ["Strategies", SlidersHorizontal],
  ["Risk", ShieldCheck],
] as const;

type Runner = {
  symbol: string;
  price: number;
  equity: number;
  returnPct: number;
  lastProcessed: number | null;
  lastNote: string;
  position: any;
  metrics: any;
  risk: any;
};

type RuntimeEvent = {
  id: number;
  timestamp: number;
  level: string;
  category: string;
  message: string;
  symbol?: string;
  source?: string;
};

type Status = {
  telemetry?: {
    lastSuccessfulBinanceAt: number | null;
    lastCandleAt: number | null;
    lastBinanceError: { at: number; message: string } | null;
    mode: string;
  };
  mode: string;
  running: boolean;
  strategy: string;
  interval: string;
  updatedAt: number;
  portfolio: {
    startingBalance: number;
    equity: number;
    returnPct: number;
  };
  metrics: any;
  runners: Runner[];
};

type Market = {
  symbol: string;
  price: number;
  change: number;
  signal: string;
  score: number;
  maxScore: number;
  rsi: number | null;
  adx: number | null;
};

type Trade = {
  symbol: string;
  side?: "LONG" | "SHORT";
  leverage?: number;
  margin?: number;
  funding?: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  reason: string;
  netPnL: number;
  fees: number;
  rMultiple: number;
};
type BacktestResult = {
  config: {
    symbol: string;
    interval: string;
    candlesRequested: number;
    candlesUsed: number;
    feeRate: number;
    slippage: number;
    trailing: boolean;
    split: number;
    haltResumeDays: number;
  };
  period: {
    candles: number;
    days: number;
  };
  full: {
    metrics: {
      startingBalance: number;
      finalEquity: number;
      returnPct: number;
      trades: number;
      winRate: number;
      profitFactor: number;
      expectancy: number;
      avgR: number;
      avgWin: number;
      avgLoss: number;
      payoff: number;
      fees: number;
      maxDrawdownPct: number;
      sharpe: number;
      sortino: number;
      maxLossStreak: number;
      byReason: Record<string, number>;
    };
    buyHold: number;
    trades: any[];
    equityCurve: {
      time: number;
      equity: number;
    }[];
  };
  inSample: {
    metrics: BacktestResult["full"]["metrics"];
    buyHold: number;
    trades: any[];
    equityCurve: {
      time: number;
      equity: number;
    }[];
  };
  outSample: {
    metrics: BacktestResult["full"]["metrics"];
    buyHold: number;
    trades: any[];
    equityCurve: {
      time: number;
      equity: number;
    }[];
  };
  risk: {
    haltExits: number;
  };
  csv: string;
};

const money = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const price = (n: number) =>
  `$${n.toLocaleString(undefined, {
    maximumFractionDigits: n < 10 ? 4 : 2,
  })}`;

const pct = (n: number | null | undefined) => {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "0.00%";

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const time = (ms: number) =>
  new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Stat({
  label,
  value,
  sub,
  positive,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
  icon: any;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-400">{label}</span>

        <span className="rounded-lg bg-white/5 p-2 text-zinc-400">
          <Icon size={17} />
        </span>
      </div>

      <div className="mt-4 text-2xl font-semibold tracking-tight">{value}</div>

      <div
        className={`mt-1 flex items-center gap-1 text-xs ${
          positive === false ? "text-red-400" : "text-emerald-400"
        }`}
      >
        {positive === false ? (
          <ArrowDownRight size={13} />
        ) : (
          <ArrowUpRight size={13} />
        )}

        {sub}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description?: string;
  icon?: any;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          {Icon && <Icon size={17} className="text-indigo-400" />}

          <h2 className="font-medium">{title}</h2>
        </div>

        {description && (
          <p className="mt-1 text-xs text-zinc-500">{description}</p>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: any;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/8 p-12 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-white/5 text-zinc-500">
        <Icon size={22} />
      </div>

      <div className="mt-4 text-sm font-medium text-zinc-300">{title}</div>

      <div className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-600">
        {description}
      </div>
    </div>
  );
}

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

  const runBacktest = async () => {
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
   * OVERVIEW
   */
  const Overview = () => (
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

      <MarketTable markets={markets} />

      <OperationsMonitor status={status} events={runtimeEvents} />

      <div className="grid gap-6 xl:grid-cols-2">
        <PositionsCard positions={positions} />

        <RecentTrades trades={trades} />
      </div>
    </div>
  );

  /*
   * MARKETS
   */
  const MarketsPage = () => (
    <div className="space-y-6">
      <PageTitle
        title="Markets"
        description="Live market scanner and strategy signals."
        icon={Radar}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="Markets scanned"
          value={String(markets.length)}
          sub="Live Binance markets"
          icon={Radar}
        />

        <Stat
          label="Buy signals"
          value={String(markets.filter((m) => m.signal === "BUY").length)}
          sub="Current strategy signals"
          positive
          icon={ArrowUpRight}
        />

        <Stat
          label="Sell signals"
          value={String(markets.filter((m) => m.signal === "SELL").length)}
          sub="Current strategy signals"
          positive={false}
          icon={ArrowDownRight}
        />
      </div>

      <section className="glass overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-4 border-b border-white/6 p-5 sm:flex-row sm:items-center sm:justify-between">
          <SectionHeader
            title="Market scanner"
            description="Live indicators from the trading engine."
          />

          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
            />

            <input
              value={marketSearch}
              onChange={(e) => setMarketSearch(e.target.value)}
              placeholder="Search market..."
              className="rounded-xl border border-white/7 bg-white/[.03] py-2 pl-9 pr-3 text-xs text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-indigo-400/30"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-zinc-600">
              <tr className="border-b border-white/5">
                <th className="px-5 py-3">Market</th>

                <th className="px-5 py-3">Price</th>

                <th className="px-5 py-3">24h</th>

                <th className="px-5 py-3">Signal</th>

                <th className="px-5 py-3">Score</th>

                <th className="px-5 py-3">RSI</th>

                <th className="px-5 py-3">ADX</th>

                <th className="px-5 py-3">Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredMarkets.map((x) => (
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

                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full bg-indigo-400"
                          style={{
                            width: `${
                              (x.score / Math.max(x.maxScore, 1)) * 100
                            }%`,
                          }}
                        />
                      </div>

                      <span className="text-zinc-400">
                        {x.score}/{x.maxScore}
                      </span>
                    </div>
                  </td>

                  <td className="px-5 py-4 text-zinc-400">
                    {x.rsi?.toFixed(1) ?? "—"}
                  </td>

                  <td className="px-5 py-4 text-zinc-400">
                    {x.adx?.toFixed(1) ?? "—"}
                  </td>

                  <td className="px-5 py-4">
                    <button
                      onClick={() => {
                        setActive("Positions");
                      }}
                      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-white"
                    >
                      Details
                      <ChevronRight size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Signal distribution"
            description="Current strategy output."
          />

          <div className="mt-5 h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signalCounts}>
                <CartesianGrid stroke="#ffffff08" vertical={false} />

                <XAxis
                  dataKey="name"
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
                />

                <Tooltip
                  contentStyle={{
                    background: "#111620",
                    border: "1px solid #ffffff12",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                />

                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {signalCounts.map((_, index) => (
                    <Cell key={index} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Scanner status"
            description="Engine processing state."
          />

          <div className="mt-5 space-y-3">
            {runners.map((runner) => (
              <div
                key={runner.symbol}
                className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[.02] p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-400/10 text-indigo-400">
                    <Radar size={17} />
                  </div>

                  <div>
                    <div className="text-sm font-medium">{runner.symbol}</div>

                    <div className="mt-1 text-xs text-zinc-600">
                      {runner.lastNote || "Waiting for signal"}
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm text-zinc-300">
                    {price(runner.price)}
                  </div>

                  <div className="mt-1 text-xs text-zinc-600">
                    {runner.lastProcessed
                      ? time(runner.lastProcessed)
                      : "Not processed"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  /*
   * POSITIONS
   */
  const PositionsPage = () => (
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

  /*
   * TRADES
   */
  const TradesPage = () => (
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

  /*
   * BACKTESTS
   */

  const BacktestsPage = () => {
    const result = backtestResult;

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
            description="Configure the historical simulation."
          />

          <div className="mt-6 grid gap-4 md:grid-cols-4">
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
              <label className="mb-2 block text-xs text-zinc-500">
                Candles
              </label>

              <input
                type="number"
                min="500"
                max="50000"
                value={backtestCandles}
                onChange={(e) => setBacktestCandles(e.target.value)}
                className="w-full rounded-xl border border-white/7 bg-white/[.03] px-3 py-2.5 text-sm text-zinc-300 outline-none focus:border-indigo-400/30"
              />
            </div>

            <div className="flex items-end">
              <button
                disabled={backtestRunning}
                onClick={runBacktest}
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
                        tickFormatter={(value) =>
                          `$${Number(value).toFixed(0)}`
                        }
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

                <MetricBox
                  label="Fees paid"
                  value={money(metrics?.fees || 0)}
                />
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
  };

  /*
   * STRATEGIES
   */
  const StrategiesPage = () => (
    <div className="space-y-6">
      <PageTitle
        title="Strategies"
        description="Inspect the strategy currently powering your paper engine."
        icon={SlidersHorizontal}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <SectionHeader
            title="Active strategy"
            description="Current strategy configuration."
          />

          <div className="mt-6 rounded-2xl border border-indigo-400/10 bg-indigo-400/5 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-widest text-indigo-300">
                  Running strategy
                </div>

                <div className="mt-2 text-2xl font-semibold">
                  {status?.strategy || "Unknown strategy"}
                </div>

                <div className="mt-2 text-sm text-zinc-500">
                  {status?.interval || "Unknown interval"} candle timeframe
                </div>
              </div>

              <div className="rounded-xl bg-indigo-400/10 p-3 text-indigo-400">
                <Zap size={22} />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ConfigRow label="Mode" value={status?.mode || "PAPER"} />

            <ConfigRow label="Interval" value={status?.interval || "—"} />

            <ConfigRow label="Markets" value={`${markets.length} scanned`} />

            <ConfigRow label="Runner count" value={String(runners.length)} />

            <ConfigRow
              label="Engine"
              value={status?.running ? "Running" : "Stopped"}
            />

            <ConfigRow label="Data source" value="Binance" />
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Strategy health"
            description="Current execution status."
          />

          <div className="mt-6 space-y-4">
            <HealthRow label="Engine" ok={!!status?.running} />

            <HealthRow label="Market data" ok={markets.length > 0} />

            <HealthRow
              label="Risk guard"
              ok={!runners.some((r) => r.risk?.halted)}
            />

            <HealthRow label="Paper mode" ok={true} />
          </div>
        </section>
      </div>

      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Strategy runners"
          description="Individual market workers."
        />

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {runners.map((runner) => (
            <div
              key={runner.symbol}
              className="rounded-xl border border-white/6 bg-white/[.02] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{runner.symbol}</span>

                <span
                  className={`h-2 w-2 rounded-full ${
                    runner.risk?.halted ? "bg-red-400" : "bg-emerald-400"
                  }`}
                />
              </div>

              <div className="mt-4 space-y-2 text-xs">
                <ConfigRow label="Price" value={price(runner.price)} />

                <ConfigRow label="Equity" value={money(runner.equity)} />

                <ConfigRow label="Return" value={pct(runner.returnPct)} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );

  /*
   * RISK
   */
  const RiskPage = () => (
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

  /*
   * SETTINGS
   */
  const SettingsPage = () => (
    <div className="space-y-6">
      <PageTitle
        title="Settings"
        description="Trading engine and dashboard configuration."
        icon={Settings}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Backend connection"
            description="Current dashboard API configuration."
          />

          <div className="mt-5 space-y-4">
            <SettingInput label="API URL" value={API} readOnly />

            <SettingInput label="Environment" value="PAPER" readOnly />

            <SettingInput label="Market data" value="Binance" readOnly />
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <SectionHeader
            title="Engine"
            description="Current trading engine state."
          />

          <div className="mt-5 space-y-3">
            <ConfigRow
              label="Status"
              value={status?.running ? "Running" : "Stopped"}
            />

            <ConfigRow label="Strategy" value={status?.strategy || "—"} />

            <ConfigRow label="Interval" value={status?.interval || "—"} />

            <ConfigRow label="Mode" value={status?.mode || "PAPER"} />
          </div>

          <div className="mt-6 flex gap-2">
            <button
              disabled={busy}
              onClick={() =>
                command(status?.running ? "/api/bot/stop" : "/api/bot/start")
              }
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-xs font-medium text-white"
            >
              {status?.running ? <Pause size={14} /> : <Play size={14} />}

              {status?.running ? "Stop engine" : "Start engine"}
            </button>

            <button
              onClick={load}
              className="inline-flex items-center gap-2 rounded-xl border border-white/7 bg-white/5 px-4 py-2.5 text-xs text-zinc-300"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </section>
      </div>

      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="System information"
          description="Useful information while developing the bot."
        />

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SystemCard icon={Server} label="Backend" value="Node.js API" />

          <SystemCard icon={Database} label="Market data" value="Binance" />

          <SystemCard icon={Cpu} label="Execution" value="Paper engine" />

          <SystemCard icon={Terminal} label="Dashboard" value="Next.js" />
        </div>
      </section>
    </div>
  );

  /*
   * ACTIVE PAGE
   */
  const renderPage = () => {
    switch (active) {
      case "Markets":
        return <MarketsPage />;

      case "Positions":
        return <PositionsPage />;

      case "Trades":
        return <TradesPage />;

      case "Backtests":
        return <BacktestsPage />;

      case "Strategies":
        return <StrategiesPage />;

      case "Risk":
        return <RiskPage />;

      case "Overview":
      default:
        return <Overview />;
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
                    npm run api
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

/* =========================================================
   COMPONENTS
========================================================= */

function PageTitle({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: any;
}) {
  return (
    <section>
      <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-400/15 bg-indigo-400/5 px-3 py-1 text-[11px] text-indigo-300">
        <Icon size={12} />
        TradeLab
      </div>

      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {title}
      </h1>

      <p className="mt-1 text-sm text-zinc-500">{description}</p>
    </section>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  return (
    <span
      className={`rounded-md px-2 py-1 text-[11px] font-medium ${
        signal === "BUY"
          ? "bg-emerald-400/10 text-emerald-300"
          : signal === "SELL"
            ? "bg-red-400/10 text-red-300"
            : "bg-white/6 text-zinc-400"
      }`}
    >
      {signal}
    </span>
  );
}

function RiskCard({ runners, dailyLoss, drawdown, maxLosses, maxTrades }: any) {
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

function OperationsMonitor({
  status,
  events,
}: {
  status: Status | null;
  events: RuntimeEvent[];
}) {
  const telemetry = status?.telemetry;
  const lastSuccess = telemetry?.lastSuccessfulBinanceAt;
  const lastCandle = telemetry?.lastCandleAt;
  const error = telemetry?.lastBinanceError;
  const formatTime = (value?: number | null) =>
    value ? new Date(value).toLocaleString() : "No successful update yet";

  return (
    <section className="glass overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/6 p-5">
        <div>
          <SectionHeader
            title="Live backend operations"
            description="Timestamped events emitted by the backend. This is paper trading only; no real Binance orders are sent."
          />
        </div>
        <span
          className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold ${status?.running ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-amber-400/20 bg-amber-400/10 text-amber-300"}`}
        >
          {status?.running ? "PAPER ENGINE RUNNING" : "PAPER ENGINE STOPPED"}
        </span>
      </div>

      <div className="grid gap-3 border-b border-white/6 p-4 sm:grid-cols-3">
        <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Last Binance data success
          </div>
          <div className="mt-2 text-xs text-zinc-200">
            {formatTime(lastSuccess)}
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Last processed candle
          </div>
          <div className="mt-2 text-xs text-zinc-200">
            {formatTime(lastCandle)}
          </div>
        </div>
        <div className="rounded-xl border border-white/6 bg-white/[.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">
            Latest API/data error
          </div>
          <div
            className={`mt-2 line-clamp-2 text-xs ${error ? "text-red-300" : "text-emerald-300"}`}
          >
            {error
              ? `${formatTime(error.at)} — ${error.message}`
              : "No recorded data errors"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Terminal size={14} /> Runtime event feed
        </div>
        <div className="text-[10px] text-zinc-600">
          Refreshes with dashboard · newest first
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="p-8 text-center text-xs leading-5 text-zinc-500">
            No backend events recorded yet. Start the paper engine to see
            fetches, candle evaluations, signals, risk decisions and trade
            events here.
          </div>
        ) : (
          events.map((event) => (
            <div
              key={event.id}
              className="flex gap-3 border-b border-white/[.035] px-5 py-3 last:border-0"
            >
              <div
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${event.level === "error" ? "bg-red-400" : event.level === "warn" ? "bg-amber-400" : event.level === "trade" ? "bg-indigo-400" : "bg-emerald-400"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wider text-zinc-400">
                    {event.category}
                  </span>
                  {event.symbol && (
                    <span className="text-[10px] text-zinc-600">
                      {event.symbol}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] tabular-nums text-zinc-600">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="mt-1 break-words text-xs leading-5 text-zinc-300">
                  {event.message}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MarketTable({ markets }: { markets: Market[] }) {
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

function PositionsCard({ positions }: { positions: Runner[] }) {
  return (
    <section className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="Open positions"
          description="Live paper positions"
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
            description="No active paper positions."
          />
        )}
      </div>
    </section>
  );
}

function PositionCard({ position: p }: { position: Runner }) {
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

        <PositionValue label="Target" value={price(pos.targetPrice)} green />

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

function PositionValue({
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

function RecentTrades({ trades }: { trades: Trade[] }) {
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

function InputSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="mb-2 block text-xs text-zinc-500">{label}</label>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/7 bg-[#0c1018] px-3 py-2.5 text-sm text-zinc-300 outline-none focus:border-indigo-400/30"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-3 last:border-0">
      <span className="text-xs text-zinc-600">{label}</span>

      <span className="text-xs text-zinc-300">{value}</span>
    </div>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[.02] p-3">
      <span className="text-sm text-zinc-400">{label}</span>

      <span
        className={`flex items-center gap-2 text-xs ${
          ok ? "text-emerald-400" : "text-red-400"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            ok ? "bg-emerald-400" : "bg-red-400"
          }`}
        />

        {ok ? "Healthy" : "Problem"}
      </span>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[.02] p-4">
      <div className="text-xs text-zinc-600">{label}</div>

      <div className="mt-2 text-lg font-semibold text-zinc-200">{value}</div>
    </div>
  );
}

function RiskStat({
  label,
  value,
  limit,
  current,
}: {
  label: string;
  value: string;
  limit: number;
  current: number;
}) {
  const percentage = Math.min((current / limit) * 100, 100);

  const safe = current < limit;

  return (
    <div className="glass rounded-2xl p-5">
      <div className="text-sm text-zinc-400">{label}</div>

      <div
        className={`mt-3 text-2xl font-semibold ${
          safe ? "text-zinc-100" : "text-red-400"
        }`}
      >
        {value}
      </div>

      <div className="mt-1 text-xs text-zinc-600">Limit: {limit}</div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full ${
            safe ? "bg-indigo-400" : "bg-red-400"
          }`}
          style={{
            width: `${percentage}%`,
          }}
        />
      </div>
    </div>
  );
}

function RiskExplanation({
  icon: Icon,
  title,
  text,
}: {
  icon: any;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[.02] p-4">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-400/10 text-indigo-400">
        <Icon size={17} />
      </div>

      <div className="mt-4 text-sm font-medium">{title}</div>

      <div className="mt-2 text-xs leading-5 text-zinc-600">{text}</div>
    </div>
  );
}

function SettingInput({
  label,
  value,
  readOnly,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs text-zinc-500">{label}</label>

      <div className="flex items-center gap-2">
        <input
          value={value}
          readOnly={readOnly}
          className="w-full rounded-xl border border-white/7 bg-white/[.03] px-3 py-2.5 text-sm text-zinc-300 outline-none"
        />

        <button
          className="rounded-xl border border-white/7 bg-white/5 p-2.5 text-zinc-500 hover:text-white"
          title="Save"
        >
          <Save size={15} />
        </button>
      </div>
    </div>
  );
}

function SystemCard({
  icon: Icon,
  label,
  value,
}: {
  icon: any;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[.02] p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-zinc-400">
          <Icon size={17} />
        </div>

        <div>
          <div className="text-[11px] text-zinc-600">{label}</div>

          <div className="mt-1 text-sm text-zinc-300">{value}</div>
        </div>
      </div>
    </div>
  );
}
