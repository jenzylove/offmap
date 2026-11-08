export const usd = (n: number, digits?: number) => {
  if (!Number.isFinite(n)) return "n/a";
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};

export const compactUsd = (n: number) => {
  if (!Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return usd(n);
};

export const pct = (n: number, digits = 1) => (Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "n/a");

export const short = (a: string, head = 6, tail = 4) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

export function units(v: bigint, decimals: number, maxFrac = 6): string {
  const neg = v < 0n;
  const x = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = x / base;
  let frac = (x % base).toString().padStart(decimals, "0").slice(0, maxFrac).replace(/0+$/, "");
  const s = whole.toLocaleString("en-US") + (frac ? "." + frac : "");
  return neg ? "-" + s : s;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Parses a user typed decimal into smallest units. Returns null when it is not a positive number. */
export function toUnits(s: string, decimals: number): bigint | null {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [w = "0", f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const v = BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return v > 0n ? v : null;
}
