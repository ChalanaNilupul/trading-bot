"use client";

import { ArrowDownRight, ArrowUpRight, Save } from "lucide-react";

export function Stat({
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

export function SectionHeader({
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

export function EmptyState({
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

export function PageTitle({
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

export function SignalBadge({ signal }: { signal: string }) {
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

export function InputSelect({
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

export function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-3 last:border-0">
      <span className="text-xs text-zinc-600">{label}</span>

      <span className="text-xs text-zinc-300">{value}</span>
    </div>
  );
}

export function HealthRow({ label, ok }: { label: string; ok: boolean }) {
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

export function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[.02] p-4">
      <div className="text-xs text-zinc-600">{label}</div>

      <div className="mt-2 text-lg font-semibold text-zinc-200">{value}</div>
    </div>
  );
}

export function RiskStat({
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

export function RiskExplanation({
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

export function SettingInput({
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
