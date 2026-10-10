// Spatial scenes: the product drawn as objects at different depths, not as a
// diagram on a page.
//
// These replace the SVG figures (figures.tsx's PaysItself / TwoKeys / Frozen /
// Signature). An SVG on a fixed viewBox scales its type down with its frame, so
// on a wide screen the boxes were full width and the words in them were ten
// pixels. Here every node is real HTML: it keeps its type size at any width,
// reflows on a phone, and can sit on its own plane.
//
// Depth vocabulary, used the same way everywhere:
//   - glass panels float over the lit background (styles: spatial.css)
//   - the thing that matters is raised and glows; what fails is sunk and dimmed
//   - only the panel under the pointer tilts, and nothing moves under reduced
//     motion or on a touch screen

import { useRef, type ReactNode, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, CircleUser, Flame, HandCoins, KeyRound, ScrollText, ShieldCheck, Snowflake, Wallet, type LucideIcon,
} from "lucide-react";
import { NETWORKS } from "../config";
import { prefersStill, useSteps } from "../lib/reveal";
import { PQ_ACTION, EXECUTE, SIG_BYTES, fmtGas } from "../measured";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;

/** A panel that leans toward the pointer. Still under reduced motion and on touch. */
export function Tilt({ children, className = "", max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== "mouse" || prefersStill()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--ry", `${(x * max).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-y * max).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--rx", "0deg");
  };
  return (
    <div ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </div>
  );
}

/** One object in a scene: an icon tile, a name, and what it does. */
export function Node({ icon: Icon, title, sub, tone, tag }: {
  icon: LucideIcon; title: string; sub: string; tone?: "raised" | "accent" | "ice" | "sunk"; tag?: string;
}) {
  return (
    <div className={`node ${tone ? `node-${tone}` : ""}`}>
      {tag && <span className="node-tag">{tag}</span>}
      <span className="node-ico"><Icon size={26} strokeWidth={1.75} /></span>
      <span className="node-title">{title}</span>
      <span className="node-sub">{sub}</span>
    </div>
  );
}

/** A connector with value moving along it. Vertical on phones (see spatial.css). */
function Pipe({ label, dashed }: { label?: string; dashed?: boolean }) {
  return (
    <div className={`pipe ${dashed ? "pipe-dashed" : ""}`} aria-hidden="true">
      <span className="pipe-line"><i /><i /><i /></span>
      {label && <span className="pipe-label">{label}</span>}
    </div>
  );
}

/* ── One: it pays itself ─────────────────────────────────────────────── */
export function PaysScene() {
  return (
    <figure className="stage stage-pays" aria-label="A payer funds a Writ order once. The order holds the money and pays the recipient every period. When a payment is due, any stranger can press Pay; they get their gas back plus a small tip from the order. Nobody runs a server or a keeper.">
      <div className="flow">
        <Node icon={Wallet} title="Your wallet" sub="funds it once" tag="once" />
        <Pipe label="USDC in" />
        <Node icon={ScrollText} title="The order" sub="holds the money, on the chain" tone="raised" tag="Writ" />
        <Pipe label="every period" />
        <Node icon={CircleUser} title="Recipient" sub="gets paid on schedule" />
      </div>
      <div className="anyone">
        <Pipe dashed />
        <Node icon={HandCoins} title="Anyone" sub={`presses Pay, keeps a tip · costs them ${EXECUTE.usd}`} tone="accent" tag="any stranger" />
      </div>
      <figcaption className="stage-cap">No keeper, no cron, no server appears anywhere in this picture. That is the point.</figcaption>
    </figure>
  );
}

/* ── Two: only the key card can change it ────────────────────────────── */
const TRIES = [
  ["Send future payments to me", "needs the key card"],
  ["Cancel it and refund me", "needs the key card"],
  ["Replace the key card", "needs the key card"],
  ["Pull the money out now", "30 days' notice, and the key card can block it"],
] as const;

export function KeysScene() {
  const [ref, n] = useSteps<HTMLElement>(TRIES.length + 1, 260);
  return (
    <figure ref={ref} className="stage stage-keys" aria-label="A thief who has stolen the funding wallet tries four things: redirect future payments, cancel and refund, replace the key card, and pull the money out. The chain refuses all four, because changing an order needs the post-quantum key card, which is kept offline.">
      <div className="keys-back">
        <div className="keys-head"><span className="dot-red" /> A thief with your wallet tries…</div>
        <ul className="tries">
          {TRIES.map(([what, why], i) => (
            <li key={what} data-on={n > i}>
              <span className="try-what">{what}<small>{why}</small></span>
              <span className="refused">Refused</span>
            </li>
          ))}
        </ul>
      </div>
      <Tilt className="keys-front" max={9}>
        <div className="keycard-3d" data-on={n > TRIES.length}>
          <span className="kc-chip"><KeyRound size={30} strokeWidth={1.75} /></span>
          <span className="kc-label">Your key card</span>
          <span className="kc-big">The only thing that can change where the money goes.</span>
          <span className="kc-foot">Kept offline · post-quantum</span>
        </div>
      </Tilt>
    </figure>
  );
}

/** The signature, as three numbers you can check. */
export function SignatureStats() {
  const ex = MAINNET.explorer;
  return (
    <figure className="sig-stats" aria-label={`A key card signature is ${SIG_BYTES} bytes (SLH-DSA, NIST FIPS 205). Arc checks it inside the chain with its post-quantum precompile; one whole key-card action measured on mainnet cost ${fmtGas(PQ_ACTION.gas)} gas, about ${PQ_ACTION.usd}.`}>
      <div className="sig-tile">
        <span className="sig-v">{SIG_BYTES}<small>bytes</small></span>
        <span className="sig-k">one post-quantum signature</span>
        <a className="sig-src" href="https://csrc.nist.gov/pubs/fips/205/final" target="_blank" rel="noreferrer">SLH-DSA · NIST FIPS 205 ↗</a>
      </div>
      <div className="sig-tile sig-tile-raised">
        <span className="sig-v"><ShieldCheck size={30} strokeWidth={1.75} /> Arc</span>
        <span className="sig-k">checks it inside the chain, not our server</span>
        <a className="sig-src" href="https://docs.arc.io/arc/concepts/post-quantum-security" target="_blank" rel="noreferrer">precompile 0x1800…0004 ↗</a>
      </div>
      <div className="sig-tile">
        <span className="sig-v">{PQ_ACTION.usd}</span>
        <span className="sig-k">for a whole key-card action ({fmtGas(PQ_ACTION.gas)} gas)</span>
        <a className="sig-src" href={`${ex}/tx/${PQ_ACTION.tx}`} target="_blank" rel="noreferrer">measured on mainnet ↗</a>
      </div>
    </figure>
  );
}

/* ── Three: a frozen recipient loses nothing ──────────────────────────── */
export function FrozenScene() {
  return (
    <figure className="stage stage-frozen" aria-label="On Arc, paying a blocklisted address reverts, burns the gas and leaves no receipt. Writ reads the blocklist first, for free; if the recipient is frozen, the order is parked as frozen, logged, with nothing burned, and the key card can pick a new recipient.">
      <div className="plane plane-sunk">
        <div className="plane-head">Without the check</div>
        <Node icon={CircleUser} title="Pay a frozen recipient" sub="the transfer is attempted" tone="sunk" />
        <div className="drop" aria-hidden="true" />
        <Node icon={Flame} title="Reverts. Gas burns." sub="no receipt · no reason" tone="sunk" />
      </div>
      <div className="plane plane-raised">
        <div className="plane-head">Writ reads it first</div>
        <Node icon={ShieldCheck} title="isBlacklisted(recipient)" sub="a free read, before any transfer" tone="raised" />
        <div className="drop" aria-hidden="true" />
        <Node icon={Snowflake} title="Parked as frozen" sub="logged · nothing burned" tone="ice" />
        <div className="drop drop-dashed" aria-hidden="true" />
        <Node icon={KeyRound} title="Key card picks a new recipient" sub="or cancels and refunds" />
      </div>
    </figure>
  );
}

/** A large "try it" call to the live order. */
export function LiveCall({ label = "Try to hijack the live order" }: { label?: string }) {
  if (live === null) return null;
  return (
    <Link to={`/order/${live}?net=mainnet`} className="btn btn-primary btn-xl glow">
      {label} <ArrowRight size={18} />
    </Link>
  );
}
