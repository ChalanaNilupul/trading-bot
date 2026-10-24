

export const money = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const price = (n: number) =>
  `$${n.toLocaleString(undefined, {
    maximumFractionDigits: n < 10 ? 4 : 2,
  })}`;

export const pct = (n: number | null | undefined) => {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "0.00%";

  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

export const time = (ms: number) =>
  new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
