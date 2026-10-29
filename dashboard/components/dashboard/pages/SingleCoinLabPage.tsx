"use client";
import { useState } from "react";
import { FlaskConical, Play, ShieldCheck } from "lucide-react";
import { API } from "../config";
import { InputSelect, PageTitle, SectionHeader } from "../ui";
import { Status } from "../types";

type Metrics = {
  returnPct: number;
  profitFactor: number | null;
  trades: number;
  maxDrawdownPct: number;
  expectancy: number;
};
type Report = {
  symbol: string;
  direction: string;
  interval: string;
  candlesUsed: number;
  passed: boolean;
  message: string;
  env: string | null;
  selected: { strategy: string } | null;
  finalTest: Metrics | null;
  periods: {
    start: number;
    trainingEnd: number;
    validationEnd: number;
    finalStart: number;
    end: number;
  };
  candidates: {
    strategy: string;
    training: Metrics;
    validation: Metrics;
    qualifies: boolean;
  }[];
  assumptions: {
    feeRate: number;
    slippage: number;
    fundingRatePer8h: number;
    note: string;
  };
};
const pf = (value: number | null) => (value === null ? "∞" : value.toFixed(2));
const date = (value: number) => new Date(value).toLocaleDateString();
export function SingleCoinLabPage({ status }: { status: Status | null }) {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [direction, setDirection] = useState("LONG");
  const [interval, setInterval] = useState("4h");
  const [candles, setCandles] = useState("5000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Report | null>(null);
  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`${API}/api/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          direction,
          interval,
          candles: Number(candles),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "Preset comparison failed");
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preset comparison failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <PageTitle
        title="Single Coin Lab"
        description="Research one coin and one direction before starting its paper bot."
        icon={FlaskConical}
      />
      <div className="rounded-xl border border-indigo-400/20 bg-indigo-400/5 p-4 text-sm leading-6 text-indigo-200">
        This compares fixed strategy presets; it does not train an ML model or
        call Gemini. It selects on training/validation history, then checks one
        final holdout. Results never start the bot automatically.
      </div>
      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Choose your bot"
          description="The same direction rules are used by backtests and the paper runner."
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InputSelect
            label="Coin"
            value={symbol}
            onChange={setSymbol}
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
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={["LONG", "SHORT"]}
          />
          <InputSelect
            label="Candle interval"
            value={interval}
            onChange={setInterval}
            options={["15m", "30m", "1h", "4h", "1d"]}
          />
          <label className="text-xs text-zinc-400">
            Closed candles
            <input
              type="number"
              min={1500}
              max={20000}
              step={500}
              value={candles}
              onChange={(e) => setCandles(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-[#0c1018] p-2.5 text-sm text-zinc-200"
            />
          </label>
        </div>
        <p className="mt-4 text-xs leading-5 text-zinc-400">
          LONG opens longs and sells to exit. SHORT uses dedicated bearish
          entries and buys to cover. SHORT is directional trading, not a neutral
          grid. Current (score) is excluded from SHORT comparisons.
        </p>
        <button
          disabled={busy}
          onClick={() => void run()}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          <Play size={15} />
          {busy ? "Comparing presets…" : "Compare & validate presets"}
        </button>
        {busy && (
          <p role="status" className="mt-3 text-xs text-zinc-400">
            Downloading closed candles and comparing strategies. This may take a
            minute.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        )}
      </section>
      <section className="glass rounded-2xl p-5">
        <SectionHeader
          title="Currently running configuration"
          icon={ShieldCheck}
        />
        <p className="mt-4 text-sm text-zinc-300">
          {status
            ? `${status.runners.map((r) => r.symbol).join(", ")} · ${status.direction || "LONG"} · ${status.strategy} · ${status.interval} · ${status.running ? "running" : "stopped"}`
            : "Waiting for backend status…"}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Lab choices do not change this configuration. To specialize the
          runner, set BOT_SYMBOL, DIRECTION, STRATEGY and INTERVAL in backend
          .env, then restart. A single coin receives the whole configured paper
          wallet.
        </p>
      </section>
      {result && (
        <>
          <section
            className={`rounded-2xl border p-5 ${result.passed ? "border-emerald-400/20 bg-emerald-400/5" : "border-amber-400/20 bg-amber-400/5"}`}
          >
            <h2 className="font-semibold">
              {result.symbol} · {result.direction} · {result.interval}
            </h2>
            <p className="mt-3 text-sm leading-6">{result.message}</p>
            <p className="mt-2 text-xs text-zinc-400">
              {result.candlesUsed.toLocaleString()} candles ·{" "}
              {date(result.periods.start)}–{date(result.periods.end)}. Training
              ends {date(result.periods.trainingEnd)}; validation ends{" "}
              {date(result.periods.validationEnd)}; final holdout starts{" "}
              {date(result.periods.finalStart)}.
            </p>
            {result.selected && (
              <p className="mt-3 text-sm">
                Selected on development data:{" "}
                <strong>{result.selected.strategy}</strong>
              </p>
            )}
            {result.finalTest && (
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["Final return", `${result.finalTest.returnPct.toFixed(2)}%`],
                  ["Final PF", pf(result.finalTest.profitFactor)],
                  ["Final trades", result.finalTest.trades],
                  [
                    "Final drawdown",
                    `${result.finalTest.maxDrawdownPct.toFixed(2)}%`,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-black/20 p-3">
                    <div className="text-xs text-zinc-400">{label}</div>
                    <div className="mt-1 text-lg">{value}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="glass overflow-hidden rounded-2xl">
            <div className="p-5">
              <SectionHeader
                title="Preset comparison"
                description="Ranked on validation return; final holdout never chooses the winner."
              />
              <p className="mt-3 text-xs leading-5 text-zinc-500">
                Screen: positive training return/PF above 1; validation ≥30
                trades, PF ≥1.2, positive return and drawdown ≤10%. Final
                screen: ≥10 trades, positive return, PF above 1 and drawdown
                ≤10%. These are research filters, not proof of a reliable edge.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="bg-white/5 text-zinc-400">
                  <tr>
                    {[
                      "Strategy",
                      "Train return",
                      "Validation return",
                      "Validation PF",
                      "Trades",
                      "Drawdown",
                      "Screen",
                    ].map((x) => (
                      <th key={x} className="p-3 font-medium">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.candidates.map((row) => (
                    <tr key={row.strategy} className="border-t border-white/5">
                      <td className="p-3">{row.strategy}</td>
                      <td className="p-3">
                        {row.training.returnPct.toFixed(2)}%
                      </td>
                      <td className="p-3">
                        {row.validation.returnPct.toFixed(2)}%
                      </td>
                      <td className="p-3">{pf(row.validation.profitFactor)}</td>
                      <td className="p-3">{row.validation.trades}</td>
                      <td className="p-3">
                        {row.validation.maxDrawdownPct.toFixed(2)}%
                      </td>
                      <td
                        className={`p-3 ${row.qualifies ? "text-emerald-300" : "text-zinc-500"}`}
                      >
                        {row.qualifies ? "Pass" : "Fail"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {result.env && (
            <section className="glass rounded-2xl p-5">
              <SectionHeader
                title="Paper bot settings"
                description="Stop the backend before changing its profile. Replace these values in backend .env, then restart and click Start bot."
              />
              <pre className="mt-4 overflow-x-auto rounded-xl bg-black/30 p-4 text-xs leading-6 text-indigo-200">
                {result.env}
              </pre>
              <p className="mt-3 text-xs leading-5 text-zinc-400">
                Keep your existing AI keys private. BOT_SYMBOL overrides
                SYMBOLS. Direction profiles use separate paper state files; old
                positions stay in the previous profile. Review or close them
                before switching. This does not deploy or place real orders.
              </p>
            </section>
          )}
          <p className="text-xs leading-5 text-zinc-500">
            Assumed costs: fee {(result.assumptions.feeRate * 100).toFixed(3)}%
            per fill, slippage {(result.assumptions.slippage * 100).toFixed(3)}
            %, fixed funding{" "}
            {(result.assumptions.fundingRatePer8h * 100).toFixed(3)}% per 8h.{" "}
            {result.assumptions.note}
          </p>
        </>
      )}
    </div>
  );
}
