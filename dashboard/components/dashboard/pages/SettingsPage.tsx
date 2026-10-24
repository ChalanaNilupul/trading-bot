"use client";

import { Pause, Play, Settings, RefreshCw, Database, Server, Terminal, Cpu } from "lucide-react";
import { ConfigRow, PageTitle, SectionHeader, SettingInput } from "../ui";
import { SystemCard } from "../cards/SystemCard";
import { Market, Status } from "../types";
import { API } from "../config";

export function SettingsPage({ status, busy, command, load }: {
  status: Status | null;
  busy: boolean;
  command: (path: string) => Promise<void>;
  load: () => Promise<void>;
}) {
  return (
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
}
