// Chain time, and the one way this site renders a duration.
//
// There is deliberately one of each, shared by every caller. Giving a second
// component its own copy would put a second one-second interval on the page,
// and a timer owned by a component is a timer that outlives it — the leak
// lib/reveal.tsx exists to prevent.

import { useEffect, useState } from "react";

/**
 * Chain time that keeps ticking between refreshes.
 *
 * `useOrder` refetches every 10 s, so the block timestamp alone would make a
 * countdown jump in ten-second steps. This advances it by the wall-clock time
 * elapsed since the fetch landed, which is monotonic and never runs backwards
 * past a refresh. Undefined until the first read, so callers can hold a static
 * baseline instead of flashing a zero.
 */
export function useLiveNow(chainNow: bigint | undefined, fetchedAt: number) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  if (chainNow === undefined) return undefined;
  return chainNow + BigInt(Math.max(0, Math.floor((t - fetchedAt) / 1000)));
}

/** `3d 04:12:09`, clamped at zero — a duration never counts past due. */
export function countdown(s: bigint) {
  let n = Number(s < 0n ? 0n : s);
  const d = Math.floor(n / 86400); n -= d * 86400;
  const h = Math.floor(n / 3600); n -= h * 3600;
  const m = Math.floor(n / 60); const sec = n - m * 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d > 0 ? `${d}d ` : ""}${p(h)}:${p(m)}:${p(sec)}`;
}
