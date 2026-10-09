// Three figures, one per chapter of /how. Each assembles itself once when the
// reader reaches it, and each makes exactly one claim.
//
// All three are hand-authored inline SVG on a 760-wide viewBox so they share a
// grid, and every colour comes from a token so they follow the theme rather
// than carrying their own palette.

import { useSteps } from "../lib/reveal";

const W = 760;
const ease = { transition: "opacity .45s ease, fill .4s ease, stroke .4s ease" };

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
  const [ref, n] = useSteps<HTMLDivElement>(5, 620);
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
  const [ref, n] = useSteps<HTMLDivElement>(6, 560);
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
  const [ref, n] = useSteps<HTMLDivElement>(5, 640);
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
