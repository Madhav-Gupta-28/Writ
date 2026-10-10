// The two live figures: the hero plate (the order as a document) and the
// schedule (the order's real payments). Both read live order #2 on Arc mainnet.
//
// The illustrative SVG figures that used to live here were replaced by the
// spatial scenes in pages/spatial.tsx: an SVG on a fixed viewBox shrinks its
// type with its frame, which is what made them look squeezed.

import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { NETWORKS } from "../config";
import { useOrder } from "../hooks";
import { countdown, useLiveNow } from "../lib/clock";
import { duration, short, usdc } from "../lib/format";
import { isFunded, paymentsLeft } from "../lib/order";

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
  ["a quantum computer, forging the key card", "refused"],
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
        <span className="wp-id">{state}</span>
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
          <span key={i} className="tl-bar" style={{ "--i": i } as CSSProperties} data-state={i < paid ? "paid" : i === paid && due ? "due" : "later"} />
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
