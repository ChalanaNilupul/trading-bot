"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FlaskConical,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { API } from "../config";
import { EmptyState, PageTitle, SectionHeader } from "../ui";

type Review = {
  symbol: string;
  at: number;
  candleTime: number | null;
  provider: string;
  model: string;
  signal: string;
  interval: string;
  strategy: string;
  allowed: boolean;
  confidence: number | null;
  reason: string;
  outcome: "approved" | "vetoed" | "error";
};
type Monitor = {
  enabled: boolean;
  provider: string;
  model: string | null;
  keyConfigured: boolean;
  minConfidence: number;
  timeoutMs: number;
  running: boolean;
  interval: string;
  strategy: string;
  testing: boolean;
  nextTestAt: number;
  reviews: Review[];
  lastTest: (Review & { success: boolean }) | null;
  counts: {
    reviewed: number;
    approved: number;
    vetoed: number;
    errors: number;
  };
};
const stamp = (value: number | null) =>
  value ? new Date(value).toLocaleString() : "—";

export function AIPage() {
  const [data, setData] = useState<Monitor | null>(null);
  const [error, setError] = useState("");
  const [testError, setTestError] = useState("");
  const [testing, setTesting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/ai`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AI monitor unavailable");
      setData(body);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI monitor unavailable");
    }
  }, []);
  useEffect(() => {
    void load();
    const poll = setInterval(() => {
      void load();
    }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);
  const test = async () => {
    setTesting(true);
    setTestError("");
    try {
      const response = await fetch(`${API}/api/ai/test`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Connection test failed");
    } catch (e) {
      setTestError(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      await load();
      setTesting(false);
    }
  };
  const cooldown = Math.max(
    0,
    Math.ceil(((data?.nextTestAt || 0) - now) / 1000),
  );
  const lastTest = data?.lastTest;
  return (
    <div className="space-y-6">
      <PageTitle
        title="AI Monitor"
        description="See when AI reviews an entry, what it decided, and whether your provider responds."
        icon={Bot}
      />
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300"
        >
          {error}{" "}
          <button onClick={() => void load()} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}
      {!data ? (
        <div className="glass rounded-2xl p-6 text-sm text-zinc-400">
          Loading AI configuration…
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [
                "Entry filter",
                data.enabled ? "Enabled" : "Disabled",
                data.running ? "Trading engine running" : "Trading engine stopped",
              ],
              [
                "Provider / model",
                data.provider,
                data.model || "Model not configured",
              ],
              [
                "API key",
                data.keyConfigured ? "Configured" : "Missing",
                "Key stays on the backend",
              ],
              [
                "Minimum confidence",
                `${Math.round(data.minConfidence * 100)}%`,
                `${data.timeoutMs / 1000}s request timeout · subjective score`,
              ],
            ].map(([label, value, sub]) => (
              <div key={label} className="glass min-w-0 rounded-2xl p-5">
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="mt-3 text-xl font-semibold capitalize">
                  {value}
                </div>
                <div className="mt-2 break-words text-xs text-zinc-400">
                  {sub}
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="glass rounded-2xl p-5 sm:p-6">
              <SectionHeader
                title="Test AI connection"
                description="Send one test request without opening a trade."
                icon={FlaskConical}
              />
              <p className="mt-4 text-sm leading-6 text-zinc-400">
                This sends an empty market snapshot to {data.provider}. A valid
                rejection confirms the connection works. The request may incur
                an API charge.
              </p>
              <button
                onClick={() => void test()}
                disabled={
                  !data.enabled ||
                  !data.keyConfigured ||
                  testing ||
                  data.testing ||
                  cooldown > 0
                }
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FlaskConical size={16} />
                {testing || data.testing
                  ? "Testing connection…"
                  : cooldown
                    ? `Try again in ${cooldown}s`
                    : "Test connection · 1 API request"}
              </button>
              {!data.enabled && (
                <p className="mt-3 text-xs text-amber-300">
                  Set AI_ENABLED=1 in backend .env and restart the backend to
                  test.
                </p>
              )}
              {!data.keyConfigured && (
                <p className="mt-3 text-xs text-amber-300">
                  Add the selected provider’s key to backend .env and restart.
                </p>
              )}
              {testError && (
                <p role="alert" className="mt-4 text-sm text-red-300">
                  {testError}
                </p>
              )}
              {lastTest ? (
                <div
                  aria-live="polite"
                  className={`mt-5 rounded-xl border p-4 ${lastTest.success ? "border-emerald-400/20 bg-emerald-400/5" : "border-red-400/20 bg-red-400/5"}`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {lastTest.success ? (
                      <CheckCircle2 size={16} className="text-emerald-400" />
                    ) : (
                      <XCircle size={16} className="text-red-400" />
                    )}
                    {lastTest.success
                      ? "Provider returned a valid review"
                      : "Connection test failed"}
                  </div>
                  <div className="mt-2 text-xs text-zinc-400">
                    {stamp(lastTest.at)} · {lastTest.provider} /{" "}
                    {lastTest.model}
                  </div>
                  <p className="mt-3 text-sm text-zinc-300">
                    {lastTest.reason}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Connection tests are separate from trading reviews.
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-xs text-zinc-500">
                  No dashboard connection test yet. Earlier terminal tests are
                  not saved here.
                </p>
              )}
            </section>
            <section className="glass rounded-2xl p-5 sm:p-6">
              <SectionHeader title="When does AI run?" icon={ShieldCheck} />
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-zinc-400">
                <li>
                  The trading engine processes a newly closed {data.interval}{" "}
                  candle.
                </li>
                <li>
                  {data.strategy} proposes a BUY or SHORT while that symbol is
                  flat.
                </li>
                <li>AI reviews the last 60 closed candles and indicators.</li>
                <li>
                  Approval must meet the confidence threshold. Existing risk
                  rules still decide whether an entry can open.
                </li>
              </ol>
              <div className="mt-5 rounded-xl bg-white/3 p-4 text-xs leading-6 text-zinc-400">
                Stops, position size, leverage and exits remain controlled by
                the trading engine. AI failures veto new entries. Approval does
                not guarantee a trade or profit. Confidence is not a win
                probability.
              </div>
            </section>
          </div>
          <section className="glass overflow-hidden rounded-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6">
              <SectionHeader
                title="Recent entry reviews"
                description="Latest 100 saved reviews across configured symbols, including earlier runs."
                icon={Bot}
              />
              <button
                onClick={() => void load()}
                className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300"
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-4 sm:px-6">
              {[
                ["Reviewed", data.counts.reviewed],
                ["Approved", data.counts.approved],
                ["Vetoed", data.counts.vetoed],
                ["API / response errors", data.counts.errors],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white/3 p-3">
                  <div className="text-xs text-zinc-500">{label}</div>
                  <div className="mt-1 text-xl font-medium">{value}</div>
                </div>
              ))}
            </div>
            {!data.reviews.length ? (
              <div className="p-5 pt-0 sm:p-6 sm:pt-0">
                <EmptyState
                  icon={Bot}
                  title="No trading reviews yet"
                  description={
                    data.enabled
                      ? `AI is waiting for an eligible strategy entry on ${data.interval} candles. A review may take time. A log file is created only after a review; you do not need to create it yourself.`
                      : "AI is disabled. Enable it in backend .env, restart the backend, then start the bot."
                  }
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-xs">
                  <thead className="border-y border-white/5 bg-white/3 text-zinc-500">
                    <tr>
                      {[
                        "Reviewed / candle",
                        "Symbol / signal",
                        "Provider / model",
                        "Decision",
                        "Confidence",
                        "Reason",
                      ].map((label) => (
                        <th key={label} className="px-5 py-3 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.reviews.map((review, index) => (
                      <tr
                        key={`${review.symbol}-${review.at}-${index}`}
                        className="align-top"
                      >
                        <td className="whitespace-nowrap px-5 py-4 text-zinc-300">
                          {stamp(review.at)}
                          <div className="mt-1 text-[10px] text-zinc-500">
                            Candle: {stamp(review.candleTime)}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-medium">
                          {review.symbol}
                          <div className="mt-1 text-zinc-500">
                            {review.signal} · {review.interval}
                          </div>
                        </td>
                        <td className="max-w-48 break-words px-5 py-4 text-zinc-300">
                          {review.provider}
                          <div className="mt-1 text-zinc-500">
                            {review.model}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`rounded-md px-2 py-1 ${review.outcome === "approved" ? "bg-emerald-400/10 text-emerald-300" : review.outcome === "error" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}
                          >
                            {review.outcome === "error"
                              ? "Error · entry blocked"
                              : review.outcome === "approved"
                                ? "Approved"
                                : "Vetoed"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-zinc-300">
                          {review.confidence === null
                            ? "—"
                            : `${Math.round(review.confidence * 100)}%`}
                        </td>
                        <td className="max-w-md px-5 py-4 leading-5 text-zinc-400">
                          {review.reason}
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
