// The figures, one per chapter of /how plus the hero plate and the schedule.
// Each assembles itself once when the reader reaches it, and each makes exactly
// one claim.
//
// The SVGs are hand-authored on two grids: 760 wide for desktop and 340 wide,
// stacked vertically, for phones. One grid scaled down to a 375px screen put
// the labels at about five pixels, which is no figure at all. Every colour
// comes from a token so they follow the theme rather than carrying their own
// palette, and label colours meet WCAG AA on the plate.

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { NETWORKS } from "../config";
import { useOrder } from "../hooks";
import { countdown, useLiveNow } from "../lib/clock";
import { duration, short, usdc } from "../lib/format";
import { isFunded, paymentsLeft } from "../lib/order";
import { useSteps } from "../lib/reveal";
import { PQ_ACTION, SIG_BYTES, fmtGas } from "../measured";

const W = 760;
const N = 340; // the narrow grid
const ease = { transition: "opacity .28s ease, fill .25s ease, stroke .25s ease" };
// While a figure assembles, parts not yet reached sit faint. Never the resting
// state: see lib/reveal.tsx.
const DIM = 0.2;

const F = { label: 14, sub: 12.5, head: 12, note: 13 } as const;

/** Phones get the stacked figure. Re-evaluates on resize and rotation. */
function useNarrow(query = "(max-width: 560px)") {
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

function Head({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fill="var(--text-2)" fontSize={F.head}
          fontFamily="var(--mono)" letterSpacing="1.4">{children}</text>
  );
}

function Box({
  x, y, w = 150, h = 56, label, sub, on, fill,
}: { x: number; y: number; w?: number; h?: number; label: string; sub?: string; on: boolean; fill?: string }) {
  return (
    <g opacity={on ? 1 : DIM} style={ease}>
      <rect x={x} y={y} width={w} height={h} rx={3}
            fill={fill ?? "var(--surface-3)"} stroke="var(--border-strong)" strokeWidth={1} />
      <text x={x + w / 2} y={sub ? y + h / 2 - 4 : y + h / 2 + 5} textAnchor="middle"
            fill={fill ? "var(--seal-ink)" : "var(--text)"} fontSize={F.label} fontWeight={600}
            fontFamily="var(--sans)">{label}</text>
      {sub && (
        <text x={x + w / 2} y={y + h / 2 + 15} textAnchor="middle"
              fill={fill ? "rgba(13,12,10,.78)" : "var(--text-2)"} fontSize={F.sub}
              fontFamily="var(--mono)">{sub}</text>
      )}
    </g>
  );
}

function Arrow({ x1, x2, y, on, dashed }: { x1: number; x2: number; y: number; on: boolean; dashed?: boolean }) {
  return (
    <g opacity={on ? 1 : DIM} style={ease}>
      <line x1={x1} y1={y} x2={x2 - 7} y2={y} stroke="var(--text-2)" strokeWidth={1.2}
            strokeDasharray={dashed ? "4 4" : undefined} />
      <path d={`M${x2 - 7},${y - 4} L${x2},${y} L${x2 - 7},${y + 4}`} fill="none"
            stroke="var(--text-2)" strokeWidth={1.2} />
    </g>
  );
}

function ArrowDown({ x, y1, y2, on, dashed }: { x: number; y1: number; y2: number; on: boolean; dashed?: boolean }) {
  return (
    <g opacity={on ? 1 : DIM} style={ease}>
      <line x1={x} y1={y1} x2={x} y2={y2 - 7} stroke="var(--text-2)" strokeWidth={1.2}
            strokeDasharray={dashed ? "4 4" : undefined} />
      <path d={`M${x - 4},${y2 - 7} L${x},${y2} L${x + 4},${y2 - 7}`} fill="none"
            stroke="var(--text-2)" strokeWidth={1.2} />
    </g>
  );
}

function Note({ x, y, on, children, color = "var(--text-2)", size = F.note, weight }: {
  x: number; y: number; on: boolean; children: string; color?: string; size?: number; weight?: number;
}) {
  return (
    <text x={x} y={y} textAnchor="middle" fill={color} fontSize={size} fontWeight={weight}
          fontFamily="var(--sans)" opacity={on ? 1 : 0} style={ease}>{children}</text>
  );
}

/* ── One ─────────────────────────────────────────────────────────────────
   It pays itself. Money goes in once; anyone can press Pay; the recipient is
   paid and the presser is reimbursed. No keeper anywhere in the picture. */
const PAYS_LABEL = "A payer funds a Writ order once. When a period is due, any stranger presses Pay; the recipient is paid and the stranger is reimbursed their gas plus a tip.";

export function PaysItself() {
  const [ref, n] = useSteps<HTMLDivElement>(5, 330);
  const on = (i: number) => n >= i;
  const narrow = useNarrow();
  if (narrow) {
    return (
      <div ref={ref}>
        <svg viewBox={`0 0 ${N} 384`} role="img" aria-label={PAYS_LABEL}>
          <Head x={N / 2} y={16}>ONCE · THEN EVERY PERIOD</Head>
          <Box x={20} y={32} w={300} label="Your wallet" sub="funds it once" on={on(1)} />
          <ArrowDown x={N / 2} y1={88} y2={118} on={on(1)} />
          <Box x={20} y={120} w={300} label="The order" sub="holds the money" on={on(2)} />
          <ArrowDown x={250} y1={176} y2={214} on={on(4)} />
          <g opacity={on(3) ? 1 : DIM} style={ease}>
            <line x1={90} y1={178} x2={90} y2={214} stroke="var(--text-2)" strokeWidth={1.2} strokeDasharray="4 4" />
          </g>
          <Box x={20} y={216} w={140} label="Anyone" sub="presses Pay" on={on(3)} />
          <Box x={180} y={216} w={140} label="Recipient" sub="gets paid" on={on(4)} />
          <Note x={90} y={298} on={on(5)} color="var(--accent-text)" size={F.sub}>↑ gas back + a tip</Note>
          <Note x={N / 2} y={340} on={on(5)}>No keeper appears anywhere</Note>
          <Note x={N / 2} y={360} on={on(5)}>in this picture. That is the point.</Note>
        </svg>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 262`} role="img" aria-label={PAYS_LABEL}>
        <Head x={W / 2} y={18}>ONCE · THEN EVERY PERIOD, FOREVER</Head>
        <Box x={20} y={40} label="Your wallet" sub="funds it once" on={on(1)} />
        <Arrow x1={176} x2={300} y={68} on={on(1)} />
        <Box x={305} y={40} label="The order" sub="holds the money" on={on(2)} />
        <Arrow x1={461} x2={585} y={68} on={on(4)} />
        <Box x={590} y={40} label="Recipient" sub="gets paid" on={on(4)} />

        {/* the stranger who presses Pay, and is paid for it */}
        <g opacity={on(3) ? 1 : DIM} style={ease}>
          <line x1={383} y1={96} x2={383} y2={146} stroke="var(--text-2)" strokeWidth={1.2} strokeDasharray="4 4" />
        </g>
        <Box x={305} y={150} label="Anyone" sub="presses Pay" on={on(3)} />
        <g opacity={on(5) ? 1 : DIM} style={ease}>
          <path d="M461,178 C520,178 520,124 560,104" fill="none" stroke="var(--accent-text)"
                strokeWidth={1.3} strokeDasharray="4 4" />
          <text x={575} y={180} textAnchor="middle" fill="var(--accent-text)" fontSize={F.sub}
                fontFamily="var(--mono)">gas back + a tip</text>
        </g>

        <Note x={W / 2} y={248} on={on(5)}>No keeper appears anywhere in this picture. That is the point.</Note>
      </svg>
    </div>
  );
}

/* ── Two ─────────────────────────────────────────────────────────────────
   Two keys, two powers. The wallet can only ever add; the key card is the only
   thing that can redirect. Four attempts, four refusals. */
const TRIES = [
  "Send future payments to me",
  "Cancel it and refund me",
  "Replace the key card",
  "Pull the money out now",
];
const KEYS_LABEL = "A stolen wallet can add money to an order but cannot redirect it. Four things a thief would try are each refused by the chain, because changing an order needs the post-quantum key card.";

function Refusal({ x, y, w, h, text, lit, size }: { x: number; y: number; w: number; h: number; text: string; lit: boolean; size: number }) {
  return (
    <g opacity={lit ? 1 : DIM} style={ease}>
      <rect x={x} y={y} width={w} height={h} rx={3}
            fill={lit ? "var(--seal)" : "var(--surface-3)"} stroke="var(--border-strong)" strokeWidth={1} style={ease} />
      <text x={x + 16} y={y + h / 2 + 5} fill={lit ? "var(--seal-ink)" : "var(--text-2)"} fontSize={size}
            fontFamily="var(--sans)" style={ease}>{text}</text>
      <text x={x + w - 14} y={y + h / 2 + 4} textAnchor="end" fill={lit ? "var(--seal-ink)" : "var(--text-2)"}
            fontSize={11.5} fontWeight={600} fontFamily="var(--mono)" letterSpacing="1.2" style={ease}>REFUSED</text>
    </g>
  );
}

export function TwoKeys() {
  const [ref, n] = useSteps<HTMLDivElement>(6, 300);
  const on = (i: number) => n >= i;
  const narrow = useNarrow();
  if (narrow) {
    return (
      <div ref={ref}>
        <svg viewBox={`0 0 ${N} 520`} role="img" aria-label={KEYS_LABEL}>
          <Head x={N / 2} y={16}>STOLEN WALLET</Head>
          <Box x={20} y={28} w={300} h={46} label="Can add money" on={on(1)} />
          <Box x={20} y={82} w={300} h={46} label="Cannot change who gets paid" on={on(2)} />
          <Head x={N / 2} y={158}>YOUR KEY CARD</Head>
          <Box x={20} y={170} w={300} h={46} label="The only thing that can" on={on(6)} />
          <Head x={N / 2} y={248}>WHAT THE CHAIN SAYS</Head>
          {TRIES.map((t, i) => (
            <Refusal key={t} x={20} y={260 + i * 52} w={300} h={42} text={t} lit={on(Math.min(i + 2, 5))} size={13.5} />
          ))}
          <Note x={N / 2} y={488} on={on(6)}>Run these yourself on the live order.</Note>
          <Note x={N / 2} y={508} on={on(6)}>They are free, and nothing is signed.</Note>
        </svg>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 310`} role="img" aria-label={KEYS_LABEL}>
        <Head x={150} y={18}>STOLEN WALLET</Head>
        <Box x={20} y={32} w={260} h={48} label="Can add money" on={on(1)} />
        <Box x={20} y={88} w={260} h={48} label="Cannot change who gets paid" on={on(2)} />

        <Head x={150} y={178}>YOUR KEY CARD</Head>
        <Box x={20} y={192} w={260} h={48} label="The only thing that can" on={on(6)} />

        {/* four attempts, each stamped REFUSED */}
        <Head x={535} y={18}>WHAT THE CHAIN SAYS</Head>
        {TRIES.map((t, i) => (
          <Refusal key={t} x={330} y={32 + i * 56} w={410} h={44} text={t} lit={on(Math.min(i + 2, 5))} size={14} />
        ))}

        <Note x={W / 2} y={296} on={on(6)}>Run these yourself on the live order. They are free, and nothing is signed.</Note>
      </svg>
    </div>
  );
}

/* ── Three ───────────────────────────────────────────────────────────────
   A frozen recipient. The attempt is not made at all, so no gas burns and the
   order parks instead of failing. */
const FROZEN_LABEL = "On Arc a payment to a blocklisted address reverts, burns gas and leaves no receipt. Writ reads the blocklist first, so the order is parked as frozen and the key card can redirect it.";

function Outcome({ x, y, w, title, sub, tone, on }: { x: number; y: number; w: number; title: string; sub: string; tone: "bad" | "ice"; on: boolean }) {
  const c = tone === "bad" ? "var(--accent-text)" : "var(--ice)";
  return (
    <g opacity={on ? 1 : DIM} style={ease}>
      <rect x={x} y={y} width={w} height={60} rx={3}
            fill={tone === "bad" ? "var(--accent-soft)" : "var(--ice-soft)"}
            stroke={tone === "bad" ? "var(--accent-line)" : "var(--ice)"} strokeWidth={1} />
      <text x={x + w / 2} y={y + 25} textAnchor="middle" fill={c} fontSize={F.label}
            fontWeight={600} fontFamily="var(--sans)">{title}</text>
      <text x={x + w / 2} y={y + 45} textAnchor="middle" fill="var(--text-2)" fontSize={F.sub}
            fontFamily="var(--mono)">{sub}</text>
    </g>
  );
}

export function Frozen() {
  const [ref, n] = useSteps<HTMLDivElement>(5, 340);
  const on = (i: number) => n >= i;
  const narrow = useNarrow();
  if (narrow) {
    return (
      <div ref={ref}>
        <svg viewBox={`0 0 ${N} 440`} role="img" aria-label={FROZEN_LABEL}>
          <Head x={N / 2} y={16}>WITHOUT THE CHECK</Head>
          <Box x={20} y={28} w={300} h={48} label="Pay a frozen recipient" on={on(1)} />
          <ArrowDown x={N / 2} y1={76} y2={102} on={on(2)} />
          <Outcome x={20} y={104} w={300} title="Reverts. Gas burns." sub="no receipt · no reason" tone="bad" on={on(2)} />
          <Head x={N / 2} y={198}>WRIT READS IT FIRST</Head>
          <Box x={20} y={210} w={300} h={56} label="isBlacklisted(recipient)" sub="a free read" on={on(3)} />
          <ArrowDown x={N / 2} y1={266} y2={292} on={on(4)} />
          <Outcome x={20} y={294} w={300} title="Parked as frozen." sub="logged · nothing burned" tone="ice" on={on(4)} />
          <ArrowDown x={N / 2} y1={354} y2={380} on={on(5)} dashed />
          <Box x={20} y={382} w={300} h={48} label="Key card picks a new recipient" on={on(5)} />
        </svg>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 266`} role="img" aria-label={FROZEN_LABEL}>
        <Head x={190} y={18}>WITHOUT THE CHECK</Head>
        <Box x={30} y={32} w={320} h={48} label="Pay a frozen recipient" on={on(1)} />
        <ArrowDown x={190} y1={80} y2={108} on={on(2)} />
        <Outcome x={30} y={110} w={320} title="Reverts. Gas burns." sub="no receipt · no reason" tone="bad" on={on(2)} />

        <Head x={570} y={18}>WRIT READS IT FIRST</Head>
        <Box x={410} y={32} w={320} h={48} label="isBlacklisted(recipient)" sub="a free read" on={on(3)} />
        <ArrowDown x={570} y1={80} y2={108} on={on(4)} />
        <Outcome x={410} y={110} w={320} title="Parked as frozen." sub="logged · nothing burned" tone="ice" on={on(4)} />

        <ArrowDown x={570} y1={170} y2={200} on={on(5)} dashed />
        <Box x={410} y={202} w={320} h={48} label="The key card picks a new recipient" on={on(5)} />
      </svg>
    </div>
  );
}

/* ── The hero ────────────────────────────────────────────────────────────
   The product, in one frame, read off the chain.

   This is the order itself, set as what it is: a standing order on paper, with
   an authority block under the rule.

   It is live. Order #2 on Arc mainnet is read on mount and the countdown
   ticks, so a judge who leaves the tab open watches a real obligation come
   due. Two rules govern that, because this sits above the fold:

     - Every row is there on the first paint. The plate used to build itself a
       row at a time, which meant the first frame was a header, two rows and a
       large empty box. It is a document, not an animation: all of it renders at
       once, the terms from the deployment record first and the chain's values
       when the read lands.
     - Nothing may change height. Every row that exists after the read exists
       before it, so the countdown band holds its space with a placeholder of
       the same shape rather than appearing and shoving the page down.

   HTML rather than SVG because it is a document: it has to reflow on a phone
   and the type has to be the page's own type, not a drawing of type. */

/* The terms as deployed (deployments/arc-mainnet.json). Only the key card can
   change any of these, and it has not been used — but the chain is still the
   authority, so these are a first paint, not a claim. */
const RECORD = {
  pays: "0.01 USDC",
  every: "24 hours",
  to: "0x1258…C6c5",
  collected: "—",
};

/** The four things a thief with your wallet would try, and what Arc says. */
const AUTHORITY: [string, string][] = [
  ["the wallet that funded it", "refused"],
  ["the recipient", "refused"],
  ["us, the authors", "refused"],
  ["anyone, with a quantum computer", "refused"],
];

export function StandingOrder() {
  const id = NETWORKS.mainnet.featuredOrder;
  // dataUpdatedAt, not Date.now(): the latter is recomputed on every render, so
  // the elapsed delta would always be zero and the countdown would only move in
  // ten-second jumps when the query refetched.
  const { data, dataUpdatedAt } = useOrder(NETWORKS.mainnet, id);
  const now = useLiveNow(data?.now, dataUpdatedAt);

  const o = data?.order;
  const live = o
    ? {
        pays: usdc(o.amountPerPeriod),
        every: duration(o.periodSeconds),
        to: short(o.beneficiary),
        collected: `${o.periodsPaid} of ${o.periodsPaid + Number(paymentsLeft(o))}`,
      }
    : RECORD;

  // The order is collectable only when it is due, active, and still holds a
  // payment plus its executor fee — the same three conditions `execute`
  // enforces (§6.3). Claiming "anyone may collect" without the funding check
  // would advertise a button that reverts.
  const due = !!o && !!now && o.state === "Active" && now >= o.nextDueAt;
  const collectable = due && !!o && isFunded(o);
  const state = o ? o.state.toLowerCase() : "active";

  return (
    <div className="writ-plate" aria-busy={!o}>
      <div className="wp-head">
        <span>Standing order №{id?.toString() ?? "2"}</span>
        <span className="wp-id">Arc mainnet · {state}</span>
      </div>

      {(["pays", "every", "to", "collected"] as const).map((k) => (
        <div key={k} className="wp-line" data-in="true">
          <span className="k">{k}</span>
          <span className="v">{live[k]}</span>
        </div>
      ))}

      {/* Holds its space from the first paint so the read cannot shift it.
          When the order is actually collectable the band becomes a link: a
          reader one click from pressing Pay and keeping the tip is the whole
          argument demonstrated rather than described. */}
      {collectable ? (
        <Link to={`/order/${id}?net=mainnet`} className="wp-next wp-go" data-in="true" data-due="true">
          <span className="k">due now</span>
          <span className="v">collect it and keep the tip <ArrowRight size={14} /></span>
        </Link>
      ) : (
        <div className="wp-next" data-in="true" data-due="false">
          {/* Three states, not two. A due order whose balance no longer covers a
              payment plus its fee would otherwise count down to 00:00:00 and sit
              there, which reads as a stuck clock rather than as the real
              condition: it is due, and it needs money. */}
          <span className="k">{due ? "due · underfunded" : "next payment in"}</span>
          <span className="v num">
            {!now || !o ? "—" : due ? "waiting on a top-up" : countdown(o.nextDueAt - now)}
          </span>
        </div>
      )}

      <div className="wp-rule" data-in="true">
        <span>who may change where this money goes</span>
      </div>

      {AUTHORITY.map(([k, v]) => (
        <div key={k} className="wp-line wp-no" data-in="true">
          <span className="k">{k}</span>
          <span className="v stamp">{v}</span>
        </div>
      ))}

      <div className="wp-total" data-in="true">
        <span className="k">one key card, held offline</span>
        <span className="v">the only thing that can</span>
      </div>
    </div>
  );
}

/* ── A schedule that runs without anyone minding it ──────────────────────
   The live order's real schedule, not an illustration: the bars are order #2's
   payments as the chain reports them. It used to fill to 25/25 by itself while
   the real order sat at 1 of 25, which is a number the page made up. */
export function Timeline() {
  const id = NETWORKS.mainnet.featuredOrder;
  const { data, dataUpdatedAt } = useOrder(NETWORKS.mainnet, id);
  const now = useLiveNow(data?.now, dataUpdatedAt);
  const o = data?.order;

  const paid = o?.periodsPaid ?? 0;
  const total = o ? paid + Number(paymentsLeft(o)) : 25;
  const due = !!o && !!now && o.state === "Active" && now >= o.nextDueAt;

  return (
    <div className="tl" aria-busy={!o}>
      <div className="tl-head">
        <span>
          <span className="live-dot tl-live">live</span> order #{id?.toString() ?? "2"} · paid daily
        </span>
        <span className="tl-n num">{o ? `${paid} of ${total} paid` : "reading…"}</span>
      </div>
      <div className="tl-bars" role="img" aria-label={o ? `Order #${id}: ${paid} of ${total} payments made${due ? ", and the next one is due now" : ""}.` : "Loading the live order's schedule."}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="tl-bar" data-state={i < paid ? "paid" : i === paid && due ? "due" : "later"} />
        ))}
      </div>
      <div className="tl-foot">
        <span>funded once</span>
        <span className="sep" aria-hidden="true">·</span>
        <span>no keeper, no cron, no server</span>
        <span className="sep" aria-hidden="true">·</span>
        <span>{due ? "a payment is due: whoever presses Pay keeps the tip" : "whoever presses Pay keeps the tip"}</span>
        {id !== null && <Link className="tl-link" to={`/order/${id}?net=mainnet`}>see it live <ArrowRight size={12} /></Link>}
      </div>
    </div>
  );
}

/* ── What the chain actually checks ──────────────────────────────────────
   The one number that makes people lean in: a 7,856-byte hash-based signature,
   verified inside a transaction, for under a cent. Measured on mainnet. */
const SIG_LABEL = `A ${SIG_BYTES}-byte SLH-DSA signature from the key card is passed to Arc's post-quantum precompile at 0x1800...0004, which verifies it on-chain. Measured on Arc mainnet: ${fmtGas(PQ_ACTION.gas)} gas, about ${PQ_ACTION.usd}, for a whole key-card action.`;

export function Signature() {
  const [ref, n] = useSteps<HTMLDivElement>(4, 320, "-40px");
  const on = (i: number) => n >= i;
  const narrow = useNarrow();
  const big = `${fmtGas(PQ_ACTION.gas)} gas · ${PQ_ACTION.usd}`;
  const arc = (x: number, y: number, w: number, h: number) => (
    <g opacity={on(2) ? 1 : DIM} style={ease}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="var(--accent-soft)"
            stroke="var(--accent-line)" strokeWidth={1} />
      <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fill="var(--text)" fontSize={F.label} fontWeight={600}
            fontFamily="var(--sans)">Arc, inside the chain</text>
      <text x={x + w / 2} y={y + h / 2 + 16} textAnchor="middle" fill="var(--accent-text)" fontSize={F.sub}
            fontFamily="var(--mono)">0x1800…0004</text>
    </g>
  );
  if (narrow) {
    return (
      <div ref={ref}>
        <svg viewBox={`0 0 ${N} 362`} role="img" aria-label={SIG_LABEL}>
          <Box x={20} y={12} w={300} h={60} label="Your key card" sub={`${SIG_BYTES}-byte signature`} on={on(1)} />
          <ArrowDown x={N / 2} y1={72} y2={100} on={on(2)} />
          {arc(20, 102, 300, 60)}
          <ArrowDown x={N / 2} y1={162} y2={190} on={on(3)} />
          <Box x={20} y={192} w={300} h={60} label="true" sub="or nothing happens" on={on(3)}
               fill={on(3) ? "var(--seal)" : undefined} />
          <Note x={N / 2} y={296} on={on(4)} color="var(--text)" size={16} weight={600}>{big}</Note>
          <Note x={N / 2} y={322} on={on(4)}>measured on Arc mainnet,</Note>
          <Note x={N / 2} y={342} on={on(4)}>one whole key-card action</Note>
        </svg>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 206`} role="img" aria-label={SIG_LABEL}>
        <Box x={20} y={40} w={200} h={64} label="Your key card" sub={`${SIG_BYTES}-byte signature`} on={on(1)} />
        <Arrow x1={226} x2={288} y={72} on={on(2)} />
        {arc(293, 40, 200, 64)}
        <Arrow x1={499} x2={561} y={72} on={on(3)} />
        <Box x={566} y={40} w={174} h={64} label="true" sub="or nothing happens" on={on(3)}
             fill={on(3) ? "var(--seal)" : undefined} />

        <Note x={W / 2} y={156} on={on(4)} color="var(--text)" size={16} weight={600}>{big}</Note>
        <Note x={W / 2} y={182} on={on(4)}>Measured on Arc mainnet for one whole key-card action. No other production chain will check this signature for you at any price.</Note>
      </svg>
    </div>
  );
}
