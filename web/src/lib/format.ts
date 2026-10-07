// Money and time, in words people read. USDC here is always the 6-decimal
// ERC-20 amount (ARCHITECTURE.md §2.6).

export function formatUsdc(units: bigint, opts: { min?: number } = {}): string {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const whole = v / 1_000_000n;
  let frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const min = opts.min ?? 2;
  if (frac.length < min) frac = frac.padEnd(min, "0");
  const w = whole.toLocaleString("en-US");
  return `${neg ? "−" : ""}${w}${frac ? "." + frac : ""}`;
}

export const usdc = (units: bigint) => `${formatUsdc(units)} USDC`;

/** "12.5" -> 12_500_000n. Returns null if it isn't a valid amount with at most 6 decimals. */
export function parseUsdc(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(s) && !/^\.\d{1,6}$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 1_000_000n + BigInt(f.padEnd(6, "0") || "0");
}

const MIN = 60, HOUR = 3600, DAY = 86400;

/** "42 min", "3 h 5 min", "2 days" */
export function duration(seconds: bigint | number): string {
  let s = Math.max(0, Math.round(Number(seconds)));
  if (s < MIN) return `${s} s`;
  if (s < HOUR) return `${Math.round(s / MIN)} min`;
  if (s < DAY) {
    const h = Math.floor(s / HOUR);
    const m = Math.round((s % HOUR) / MIN);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(s / DAY);
  s -= d * DAY;
  const h = Math.round(s / HOUR);
  return h && d < 3 ? `${d} day${d === 1 ? "" : "s"} ${h} h` : `${d} day${d === 1 ? "" : "s"}`;
}

/** "in 42 min" / "42 min ago" relative to `now` (both unix seconds). */
export function relative(ts: bigint, now: bigint): string {
  const d = Number(ts - now);
  if (Math.abs(d) < 30) return "now";
  return d > 0 ? `in ${duration(d)}` : `${duration(-d)} ago`;
}

export function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function formatDay(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export const INTERVALS: { label: string; seconds: bigint }[] = [
  { label: "Every hour", seconds: 3600n },
  { label: "Every day", seconds: 86400n },
  { label: "Every week", seconds: 7n * 86400n },
  { label: "Every 30 days", seconds: 30n * 86400n },
];

export function intervalLabel(seconds: bigint): string {
  const known = INTERVALS.find((i) => i.seconds === seconds);
  if (known) return known.label.toLowerCase();
  return `every ${duration(seconds)}`;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
