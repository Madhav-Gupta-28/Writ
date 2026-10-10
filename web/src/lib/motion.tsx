// Motion helpers for the signage look: words that flip up into place, numbers
// that count up like a departures board, and a moving ticker tape.
//
// Same rule as reveal.tsx: the finished frame is the default. Each of these
// renders its final text first, and only animates when motion is allowed. Under
// reduced motion, in tests and in print they are plain text.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersStill } from "./reveal";

/** A line whose words rise into place one after another (CSS only, see motion.css). */
export function Words({ text, start = 0, step = 60 }: { text: string; start?: number; step?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <span className="word">
            <span style={{ "--d": `${start + i * step}ms` } as CSSProperties}>{w}</span>
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

const NUM = /^(\D*?)([\d,]+(?:\.\d+)?)(.*)$/;

/**
 * A number that counts up from zero the first time it is on screen, keeping its
 * prefix, suffix, decimals and thousands separators: "$0.0060", "434,264",
 * "30 days". Anything that does not parse is shown as is.
 */
export function CountUp({ value, ms = 1200 }: { value: string; ms?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const m = NUM.exec(value);
    const el = ref.current;
    if (!m || !el || prefersStill() || typeof IntersectionObserver !== "function") {
      setShown(value);
      return;
    }
    const [, pre, digits, post] = m;
    const target = Number(digits.replace(/,/g, ""));
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    const commas = digits.includes(",");
    const fmt = (n: number) => {
      const s = decimals ? n.toFixed(decimals) : String(Math.round(n));
      return pre + (commas ? Number(s).toLocaleString("en-US", { minimumFractionDigits: decimals }) : s) + post;
    };

    let raf = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      io.disconnect();
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        const eased = 1 - Math.pow(1 - p, 4);
        setShown(p < 1 ? fmt(target * eased) : value);
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      setShown(fmt(0));
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) run(); }, { rootMargin: "-40px" });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      setShown(value);
    };
  }, [value, ms]);

  return <span ref={ref} className="countup">{shown}</span>;
}

/** A strip of tape with true statements running along it. The second copy is for the loop only. */
export function Ticker({ items }: { items: string[] }) {
  const row = (hidden: boolean) => (
    <span className="ticker-row" aria-hidden={hidden || undefined}>
      {items.map((t) => (
        <span key={t} className="ticker-item">{t}</span>
      ))}
    </span>
  );
  return (
    <div className="ticker" role="marquee" aria-label={items.join(". ")}>
      <div className="ticker-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
