// Three figures, one per chapter of /how. Each assembles itself once when the
// reader reaches it, and each makes exactly one claim.
//
// All three are hand-authored inline SVG on a 760-wide viewBox so they share a
// grid, and every colour comes from a token so they follow the theme rather
// than carrying their own palette.

import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { NETWORKS } from "../config";
import { useOrder } from "../hooks";
import { countdown, useLiveNow } from "../lib/clock";
import { duration, short, usdc } from "../lib/format";
import { isFunded, paymentsLeft } from "../lib/order";
import { useSteps } from "../lib/reveal";

const W = 760;
const ease = { transition: "opacity .28s ease, fill .25s ease, stroke .25s ease" };

function Box({
  x, y, w = 150, h = 54, label, sub, on, fill,
}: { x: number; y: number; w?: number; h?: number; label: string; sub?: string; on: boolean; fill?: string }) {
  return (
    <g opacity={on ? 1 : 0.14} style={ease}>
      <rect x={x} y={y} width={w} height={h} rx={3}
            fill={fill ?? "var(--surface-2)"} stroke="var(--border-strong)" strokeWidth={1} />
      <text x={x + w / 2} y={sub ? y + 23 : y + h / 2 + 4} textAnchor="middle"
            fill={fill ? "var(--seal-ink)" : "var(--text)"} fontSize={13} fontWeight={600}
            fontFamily="var(--sans)">{label}</text>
      {sub && (
        <text x={x + w / 2} y={y + 40} textAnchor="middle"
              fill={fill ? "rgba(13,12,10,.68)" : "var(--muted)"} fontSize={11}
              fontFamily="var(--mono)">{sub}</text>
      )}
    </g>
  );
}

function Arrow({ x1, x2, y, on, dashed }: { x1: number; x2: number; y: number; on: boolean; dashed?: boolean }) {
  return (
    <g opacity={on ? 1 : 0.14} style={ease}>
      <line x1={x1} y1={y} x2={x2 - 7} y2={y} stroke="var(--border-strong)" strokeWidth={1.2}
            strokeDasharray={dashed ? "4 4" : undefined} />
      <path d={`M${x2 - 7},${y - 4} L${x2},${y} L${x2 - 7},${y + 4}`} fill="none"
            stroke="var(--border-strong)" strokeWidth={1.2} />
    </g>
  );
}

/* ── One ─────────────────────────────────────────────────────────────────
   It pays itself. Money goes in once; anyone can press Pay; the recipient is
   paid and the presser is reimbursed. No keeper anywhere in the picture. */
export function PaysItself() {
  const [ref, n] = useSteps<HTMLDivElement>(5, 330);
  const on = (i: number) => n >= i;
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 250`} role="img"
           aria-label="A payer funds a Writ order once. When a period is due, any stranger presses Pay; the recipient is paid and the stranger is reimbursed their gas plus a tip.">
        <text x={W / 2} y={16} textAnchor="middle" fill="var(--muted)" fontSize={10.5}
              fontFamily="var(--mono)" letterSpacing="1.5">ONCE &nbsp;·&nbsp; THEN EVERY PERIOD, FOREVER</text>

        <Box x={20} y={40} label="Your wallet" sub="funds it once" on={on(1)} />
        <Arrow x1={176} x2={300} y={67} on={on(1)} />
        <Box x={305} y={40} label="The order" sub="holds the money" on={on(2)} />
        <Arrow x1={461} x2={585} y={67} on={on(4)} />
        <Box x={590} y={40} label="Recipient" sub="gets paid" on={on(4)} />

        {/* the stranger who presses Pay, and is paid for it */}
        <g opacity={on(3) ? 1 : 0.14} style={ease}>
          <line x1={383} y1={94} x2={383} y2={140} stroke="var(--border-strong)" strokeWidth={1.2} strokeDasharray="4 4" />
        </g>
        <Box x={305} y={145} label="Anyone" sub="presses Pay" on={on(3)} />
        <g opacity={on(5) ? 1 : 0.14} style={ease}>
          <path d="M461,172 C520,172 520,120 560,100" fill="none" stroke="var(--accent)"
                strokeWidth={1.3} strokeDasharray="4 4" />
          <text x={560} y={168} textAnchor="middle" fill="var(--accent)" fontSize={11}
                fontFamily="var(--mono)">gas back + a tip</text>
        </g>

        <text x={W / 2} y={236} textAnchor="middle" fill="var(--muted)" fontSize={11.5}
              fontFamily="var(--sans)" opacity={on(5) ? 1 : 0} style={ease}>
          No keeper appears anywhere in this picture. That is the point.
        </text>
      </svg>
    </div>
  );
}

/* ── Two ─────────────────────────────────────────────────────────────────
   Two keys, two powers. The wallet can only ever add; the key card is the only
   thing that can redirect. Four attempts, four refusals. */
export function TwoKeys() {
  const [ref, n] = useSteps<HTMLDivElement>(6, 300);
  const on = (i: number) => n >= i;
  const tries = [
    "Send future payments to me",
    "Cancel it and refund me",
    "Replace the key card",
    "Pull the money out now",
  ];
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 300`} role="img"
           aria-label="A stolen wallet can add money to an order but cannot redirect it. Four things a thief would try are each refused by the chain, because changing an order needs the post-quantum key card.">
        <text x={150} y={16} textAnchor="middle" fill="var(--muted)" fontSize={10.5}
              fontFamily="var(--mono)" letterSpacing="1.5">STOLEN WALLET</text>
        <Box x={20} y={30} w={260} h={48} label="Can add money" on={on(1)} />
        <Box x={20} y={86} w={260} h={48} label="Cannot change who gets paid" on={on(2)} />

        <text x={150} y={176} textAnchor="middle" fill="var(--muted)" fontSize={10.5}
              fontFamily="var(--mono)" letterSpacing="1.5">YOUR KEY CARD</text>
        <Box x={20} y={190} w={260} h={48} label="The only thing that can" on={on(6)} />

        {/* four attempts, each stamped REFUSED */}
        <text x={530} y={16} textAnchor="middle" fill="var(--muted)" fontSize={10.5}
              fontFamily="var(--mono)" letterSpacing="1.5">WHAT THE CHAIN SAYS</text>
        {tries.map((t, i) => {
          const y = 30 + i * 56;
          const lit = on(Math.min(i + 2, 5));
          return (
            <g key={t} opacity={lit ? 1 : 0.14} style={ease}>
              <rect x={330} y={y} width={410} height={44} rx={3}
                    fill={lit ? "var(--seal)" : "var(--surface-2)"} stroke="var(--border-strong)" strokeWidth={1}
                    style={ease} />
              <text x={348} y={y + 27} fill={lit ? "var(--seal-ink)" : "var(--muted)"} fontSize={12.5}
                    fontFamily="var(--sans)" style={ease}>{t}</text>
              <text x={722} y={y + 27} textAnchor="end" fill={lit ? "var(--seal-ink)" : "var(--muted)"}
                    fontSize={10.5} fontFamily="var(--mono)" letterSpacing="1.4" style={ease}>REFUSED</text>
            </g>
          );
        })}

        <text x={W / 2} y={286} textAnchor="middle" fill="var(--muted)" fontSize={11.5}
              fontFamily="var(--sans)" opacity={on(6) ? 1 : 0} style={ease}>
          Run these yourself on the live order. They are free, and nothing is signed.
        </text>
      </svg>
    </div>
  );
}

/* ── Three ───────────────────────────────────────────────────────────────
   A frozen recipient. The attempt is not made at all, so no gas burns and the
   order parks instead of failing. */
export function Frozen() {
  const [ref, n] = useSteps<HTMLDivElement>(5, 340);
  const on = (i: number) => n >= i;
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 265`} role="img"
           aria-label="On Arc a payment to a blocklisted address reverts, burns gas and leaves no receipt. Writ reads the blocklist first, so the order is parked as frozen and the key card can redirect it.">
        <text x={190} y={16} textAnchor="middle" fill="var(--muted)" fontSize={10.5}
              fontFamily="var(--mono)" letterSpacing="1.5">WITHOUT THE CHECK</text>
        <Box x={30} y={32} w={320} h={46} label="Pay a frozen recipient" on={on(1)} />
        <g opacity={on(2) ? 1 : 0.14} style={ease}>
          <line x1={190} y1={78} x2={190} y2={106} stroke="var(--border-strong)" strokeWidth={1.2} />
          <rect x={30} y={110} width={320} height={60} rx={3} fill="var(--surface-2)"
                stroke="var(--accent-line)" strokeWidth={1} />
          <text x={190} y={134} textAnchor="middle" fill="var(--accent)" fontSize={12.5}
                fontWeight={600} fontFamily="var(--sans)">Reverts. Gas burns.</text>
          <text x={190} y={154} textAnchor="middle" fill="var(--muted)" fontSize={11}
                fontFamily="var(--mono)">no receipt · no reason</text>
        </g>

        <text x={570} y={16} textAnchor="middle" fill="var(--muted)" fontSize={10.5}
              fontFamily="var(--mono)" letterSpacing="1.5">WRIT READS IT FIRST</text>
        <Box x={410} y={32} w={320} h={46} label="isBlacklisted(recipient)" sub="a free read" on={on(3)} />
        <g opacity={on(4) ? 1 : 0.14} style={ease}>
          <line x1={570} y1={78} x2={570} y2={106} stroke="var(--border-strong)" strokeWidth={1.2} />
          <rect x={410} y={110} width={320} height={60} rx={3} fill="var(--ice-soft)"
                stroke="var(--ice)" strokeWidth={1} />
          <text x={570} y={134} textAnchor="middle" fill="var(--ice)" fontSize={12.5}
                fontWeight={600} fontFamily="var(--sans)">Parked as frozen.</text>
          <text x={570} y={154} textAnchor="middle" fill="var(--muted)" fontSize={11}
                fontFamily="var(--mono)">logged · nothing burned</text>
        </g>

        <g opacity={on(5) ? 1 : 0.14} style={ease}>
          <line x1={570} y1={170} x2={570} y2={198} stroke="var(--border-strong)" strokeWidth={1.2} strokeDasharray="4 4" />
          <Box x={410} y={202} w={320} h={44} label="The key card picks a new recipient" on={on(5)} />
        </g>
      </svg>
    </div>
  );
}

/* ── The hero ────────────────────────────────────────────────────────────
   The product, in one frame, read off the chain.

   What this replaces was five boxes and two side notes — a diagram of roles,
   which is an org chart, not an artifact. Nearly blank as a screenshot, and a
   screenshot is what ends up in a judging deck.

   This is the order itself, set as what it is: a standing order on paper, with
   an authority block under the rule. Four refusals land one at a time and the
   last line is the only one in the seal colour.

   It is live. Order #2 on Arc mainnet is read on mount and the countdown
   ticks, so a judge who leaves the tab open watches a real obligation come
   due. Two rules govern that, because this sits above the fold:

     - Static first, never a spinner. The terms from the deployment record are
       rendered on the first paint and swapped for chain values when the read
       lands. A hero that spins is a hero that looks broken on a slow phone.
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
  collected: "1 of 25",
};

/** The four things a thief with your wallet would try, and what Arc says. */
const AUTHORITY: [string, string][] = [
  ["the wallet that funded it", "refused"],
  ["the recipient", "refused"],
  ["us, the authors", "refused"],
  ["anyone, with a quantum computer", "refused"],
];

export function StandingOrder() {
  // four terms, the countdown band, four refusals, then the closing line
  const [ref, n] = useSteps<HTMLDivElement>(10, 260, "-40px");
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
  // The header carries the chain's own state and the band carries due-ness;
  // putting "due now" in both just said it twice.
  const state = o ? o.state.toLowerCase() : "active";

  return (
    <div ref={ref} className="writ-plate">
      <div className="wp-head">
        <span>Standing order №{id?.toString() ?? "2"}</span>
        <span className="wp-id">Arc mainnet · {state}</span>
      </div>

      {(["pays", "every", "to", "collected"] as const).map((k, i) => (
        <div key={k} className="wp-line" data-in={n > i}>
          <span className="k">{k}</span>
          <span className="v">{live[k]}</span>
        </div>
      ))}

      {/* Holds its space from the first paint so the read cannot shift it.
          When the order is actually collectable the band becomes a link: a
          reader one click from pressing Pay and keeping the tip is the whole
          argument demonstrated rather than described, so it is the most
          valuable thing on the page and gets the only live call to action. */}
      {collectable ? (
        <Link
          to={`/order/${id}?net=mainnet`}
          className="wp-next wp-go"
          data-in={n > 4}
          data-due="true"
        >
          <span className="k">due now</span>
          <span className="v">collect it and keep the tip <ArrowRight size={14} /></span>
        </Link>
      ) : (
        <div className="wp-next" data-in={n > 4} data-due="false">
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

      <div className="wp-rule" data-in={n > 4}>
        <span>who may change where this money goes</span>
      </div>

      {AUTHORITY.map(([k, v], i) => (
        <div key={k} className="wp-line wp-no" data-in={n > i + 5}>
          <span className="k">{k}</span>
          <span className="v stamp">{v}</span>
        </div>
      ))}

      <div className="wp-total" data-in={n > 9}>
        <span className="k">one key card, held offline</span>
        <span className="v">the only thing that can</span>
      </div>
    </div>
  );
}

/* ── A schedule that runs without anyone minding it ──────────────────────
   Twenty-five periods. The paid ones fill in, the due one pulses, and the
   caption is the only sentence: nobody is running this. */
export function Timeline() {
  const [ref, n] = useSteps<HTMLDivElement>(26, 62, "-40px");
  const total = 25;
  const paid = n > total ? total : n;
  return (
    <div ref={ref} className="tl">
      <div className="tl-head">
        <span>one period per day · twenty-five of them</span>
        <span className="tl-n num">{paid}/{total}</span>
      </div>
      <div className="tl-bars">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="tl-bar" data-state={i < paid ? "paid" : i === paid ? "due" : "later"} />
        ))}
      </div>
      <div className="tl-foot">
        <span>funded once</span>
        <span>·</span>
        <span>no keeper, no cron, no server</span>
        <span>·</span>
        <span>whoever presses Pay keeps the tip</span>
      </div>
    </div>
  );
}

/* ── What the chain actually checks ──────────────────────────────────────
   The one number that makes people lean in: a 7,856-byte hash-based signature,
   verified inside a transaction, for under a cent. */
export function Signature() {
  const [ref, n] = useSteps<HTMLDivElement>(4, 320, "-40px");
  const on = (i: number) => n >= i;
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${W} 196`} role="img"
           aria-label="A 7,856-byte SLH-DSA signature from the key card is passed to Arc's post-quantum precompile at 0x1800...0004, which verifies it on-chain for 433,953 gas, about $0.0087.">
        <Box x={20} y={44} w={200} h={64} label="Your key card" sub="7,856-byte signature" on={on(1)} />
        <Arrow x1={226} x2={288} y={76} on={on(2)} />
        <g opacity={on(2) ? 1 : 0.14} style={ease}>
          <rect x={293} y={44} width={200} height={64} rx={3} fill="var(--accent-soft)"
                stroke="var(--accent-line)" strokeWidth={1} />
          <text x={393} y={68} textAnchor="middle" fill="var(--text)" fontSize={13} fontWeight={600}
                fontFamily="var(--sans)">Arc, inside the chain</text>
          <text x={393} y={88} textAnchor="middle" fill="var(--accent)" fontSize={11}
                fontFamily="var(--mono)">0x1800…0004</text>
        </g>
        <Arrow x1={499} x2={561} y={76} on={on(3)} />
        <Box x={566} y={44} w={174} h={64} label="true" sub="or nothing happens" on={on(3)}
             fill={on(3) ? "var(--seal)" : undefined} />

        <text x={W / 2} y={160} textAnchor="middle" fill="var(--text)" fontSize={15} fontWeight={600}
              fontFamily="var(--sans)" opacity={on(4) ? 1 : 0} style={ease}>
          433,953 gas. $0.0087.
        </text>
        <text x={W / 2} y={182} textAnchor="middle" fill="var(--muted)" fontSize={11.5}
              fontFamily="var(--sans)" opacity={on(4) ? 1 : 0} style={ease}>
          No other production chain will check this signature for you at any price.
        </text>
      </svg>
    </div>
  );
}
