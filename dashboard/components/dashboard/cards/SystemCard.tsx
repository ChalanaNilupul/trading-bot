"use client";



export function SystemCard({
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
