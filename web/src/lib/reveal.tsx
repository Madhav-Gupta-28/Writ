// The three ways a figure on this site is allowed to move, in one place.
//
// Ported from Rialto, including the bug its comment records: each of these was
// once written out longhand per figure, and every copy started its interval
// inside the observer callback where the effect's cleanup could not see it.
// Leaving the page mid-animation left a timer running against a component that
// no longer existed, still calling setState.
//
// Reduced motion is honoured the same way throughout: the figure is shown
// finished rather than shown still, because these carry meaning and skipping
// the animation must not mean skipping the content.

import { useEffect, useRef, useState, type ReactNode } from "react";

// Both guards degrade to "show the content finished" rather than throwing.
// matchMedia and IntersectionObserver are missing in jsdom and in older
// embedded webviews, and a figure that carries the argument must never be the
// thing that takes the page down.
const still = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const canObserve = () => typeof IntersectionObserver === "function";

/** True from the first time the element is scrolled into view, and then always. */
export function useSeen<T extends HTMLElement>(rootMargin = "-70px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (still() || !canObserve()) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        setSeen(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return [ref, seen] as const;
}

/**
 * A figure that assembles itself once: 0, then 1…`total`, one step every `ms`,
 * beginning when the reader reaches it. Under reduced motion it is `total`
 * from the start.
 */
export function useSteps<T extends HTMLElement>(total: number, ms: number, rootMargin = "-70px") {
  const [ref, seen] = useSeen<T>(rootMargin);
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (still()) {
      setN(total);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= total) clearInterval(id);
    }, ms);
    return () => clearInterval(id);
  }, [seen, total, ms]);

  return [ref, n] as const;
}

/** Whether the element is on screen *now* — for a figure that loops rather than assembling. */
export function useVisible<T extends HTMLElement>(rootMargin = "-70px") {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!canObserve()) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return [ref, visible] as const;
}

/** Lifts its children in once, when the reader reaches them. */
export function Rise({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={seen ? "rise in" : "rise"}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export const prefersStill = still;
