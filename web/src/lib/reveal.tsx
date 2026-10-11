// The three ways a figure on this site is allowed to move, in one place.
//
// Every interval here is started inside the effect and cleared by its cleanup.
// A timer started in an observer callback is invisible to that cleanup, so
// leaving the page mid-animation leaves it running against a component that no
// longer exists, still calling setState.
//
// Visible is the default, hidden is the exception. A figure starts finished and
// is only taken back to its first frame when all of these hold:
//   - motion is allowed (reduced motion shows it finished, never still), and
//   - the browser can tell us when it scrolls into view, and
//   - it starts below the fold, so the reader has not seen it yet.
// That way a figure is never stranded half-drawn: not when the observer never
// fires (old webviews, some in-app browsers), not in a full-page screenshot,
// not in print, and not when it is already on screen at load, where hiding it
// would only flash it. Starting every figure at its first frame and waiting for
// the observer is the trap: anything that stops the observer then strands the
// diagram at 14% opacity, which reads as nearly invisible rather than as still.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const still = () => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
};

const canObserve = () => typeof IntersectionObserver === "function";

// useLayoutEffect so an armed figure is reset before the first paint; falls
// back to useEffect where there is no DOM (tests, SSR).
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Below the bottom of the viewport, i.e. not yet seen by the reader. */
function belowFold(el: Element) {
  const r = el.getBoundingClientRect();
  return r.top > window.innerHeight;
}

/**
 * True when the element has been (or is being) seen. Starts true; becomes false
 * only for an element that will provably animate in, then true again once it is
 * scrolled to. A scroll check backs up the observer, so a browser whose
 * IntersectionObserver never reports still reveals the figure.
 */
function useSeen<T extends HTMLElement>(rootMargin = "-70px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(true);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || still() || !canObserve() || !belowFold(el)) return;
    setSeen(false);

    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      setSeen(true);
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) reveal(); }, { rootMargin });
    // Belt and braces: if the element is plainly inside the viewport and the
    // observer has not said so, reveal anyway.
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) reveal();
    };
    io.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      done = true;
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rootMargin]);

  return [ref, seen] as const;
}

/**
 * A figure that assembles itself once: 0, then 1…`total`, one step every `ms`,
 * beginning when the reader reaches it. It is `total` (finished) whenever it
 * will not animate: reduced motion, no observer, or already on screen.
 */
export function useSteps<T extends HTMLElement>(total: number, ms: number, rootMargin = "-70px") {
  const [ref, seen] = useSeen<T>(rootMargin);
  const [n, setN] = useState(total);
  const armed = useRef(false);

  // Seen -> not seen only happens when the figure is armed; reset it to frame 0.
  useIsoLayoutEffect(() => {
    if (!seen) {
      armed.current = true;
      setN(0);
    }
  }, [seen]);

  useEffect(() => {
    if (!seen || !armed.current) return;
    armed.current = false;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= total) clearInterval(id);
    }, ms);
    return () => {
      clearInterval(id);
      setN(total); // never leave a figure half-drawn on unmount or re-run
    };
  }, [seen, total, ms]);

  return [ref, n] as const;
}

/** Lifts its children in once, when the reader reaches them. Visible unless it will provably animate. */
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
