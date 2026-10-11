// The landing page: five beats, and the text is only ever a caption.
//
// The rule that governs every edit here: nobody reads a landing page. A reader
// arrives with thirty seconds and arrives sceptical. So every claim is either a
// picture, a number, or a link to the chain, and no paragraph runs past two
// lines.
//
// The headline has to state the product and the surprise in one sentence. A
// headline that is only punchy fails the reader who does not already know what
// this is — and the plate beside it exists to prove the surprise.

import { Link } from "react-router-dom";
import { ArrowRight, ServerOff, ShieldCheck, ShieldX } from "lucide-react";
import { NETWORKS } from "../config";
import { Rise } from "../lib/reveal";
import { CountUp, Ticker, Words } from "../lib/motion";
import { EXECUTE, OPEN, PQ_ACTION, SIG_BYTES, TESTS, fmtGas } from "../measured";
import { NetLink } from "../ui";
import { StandingOrder, Timeline } from "./figures";
import { KeysScene, Tilt } from "./spatial";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;
const order = live !== null ? `/order/${live}` : "/open";

// Every stat says where it came from: the first two are receipts of real
// transactions on Arc mainnet (see measured.ts). No number on this page is an
// estimate, because a figure a reader cannot check is worth less than none.
const ex = MAINNET.explorer;
// The hero already states the cost of a payment, the signature size and the
// zero servers, so the band carries the other measured numbers.
const STATS: { v: string; k: string; src: string; href?: string }[] = [
  { v: OPEN.usd, k: "to open and fund an order", src: `${fmtGas(OPEN.gas)} gas · mainnet tx`, href: `${ex}/tx/${OPEN.tx}` },
  { v: fmtGas(PQ_ACTION.gas), k: "gas per key card action", src: `${PQ_ACTION.usd} · mainnet tx`, href: `${ex}/tx/${PQ_ACTION.tx}` },
  { v: String(TESTS.total), k: `tests, ${TESTS.live} against live Arc`, src: `passing as of ${TESTS.asOf}` },
  { v: "30 days", k: "notice before a wallet can withdraw", src: "and the key card can block it", href: `https://sourcify.dev/#/lookup/${MAINNET.writ}` },
];

// The problem, as three things that are true of every recurring payment that
// exists today. Each one is a single point of failure named out loud.
const TODAY: [string, string, string][] = [
  ["A card on file", "one phished login", "the payout address is theirs"],
  ["A multisig", "one signer short of threshold", "you are still negotiating"],
  ["A contract subscription", "whoever holds the owner key", "points it anywhere, instantly"],
];

// Every line is true of the deployed contract or of order #2.
const TAPE = [
  `order #${live?.toString() ?? "2"} · 0.01 USDC a day`,
  "stolen wallet → refused",
  "redirect payments → needs the key card",
  `${SIG_BYTES}-byte SLH-DSA signature`,
  "checked by Arc at 0x1800…0004",
  `${EXECUTE.usd} fee per payment · refunded by the order`,
  "no admin · no server · no keeper",
];

const NOT: [string, string][] = [
  ["No admin", "nobody can pause it"],
  ["No upgrade path", "the code cannot change"],
  ["No custody", "we never hold your money"],
  ["No server", "delete us and it still pays"],
];

export function Home() {
  return (
    <div className="landing">
      {/* 1 — what it is: one line across the page, then the live order under it */}
      <section className="hero2">
        <div>
          <div className="hero2-kicker">
            <span className="live-dot">Live on Arc mainnet</span>
          </div>
          <h1>
            <Words text="A recurring USDC payment" />{" "}
            <em><Words text="not even your wallet can redirect." start={240} /></em>
          </h1>
        </div>
        <div className="hero2-grid">
          <div className="hero2-copy">
            <p className="lead">
              Redirecting it needs a post-quantum key card you keep offline, and Arc checks
              that on-chain. <strong>There is no other way in.</strong>
            </p>
            <div className="hero-cta">
              <Link to={order} className="btn btn-primary btn-xl">
                Try to steal a live payment <ArrowRight size={18} />
              </Link>
            </div>
            <div className="facts">
              <div className="fact">
                <span className="v num"><CountUp value={EXECUTE.usd} /></span>
                <span className="k">per payment, refunded · <a href={`${ex}/tx/${EXECUTE.tx}`} target="_blank" rel="noreferrer">mainnet tx</a></span>
              </div>
              <div className="fact">
                <span className="v num"><CountUp value={SIG_BYTES} /></span>
                <span className="k">bytes per signature</span>
              </div>
              <div className="fact">
                <span className="v num">0</span>
                <span className="k">servers, admins, upgrades</span>
              </div>
            </div>
          </div>
          <div className="hero-art">
            {/* The live order, read off the chain, with three true statements
                stuck beside it like labels on a wall. */}
            <Tilt className="hero-tilt" max={3}>
              <StandingOrder />
            </Tilt>
            <span className="orbit orbit-a" aria-hidden="true"><ShieldX size={15} /> stolen wallet · refused</span>
            <span className="orbit orbit-b" aria-hidden="true"><ShieldCheck size={15} /> key card action · {fmtGas(PQ_ACTION.gas)} gas</span>
            <span className="orbit orbit-c" aria-hidden="true"><ServerOff size={15} /> no server · no keeper</span>
          </div>
        </div>
      </section>

      {/* a strip of tape running under the hero: the claims, moving */}
      <Ticker items={TAPE} />

      {/* the numbers */}
      <section className="statband">
        {STATS.map(({ v, k, src, href }) => (
          <div key={k} className="stat">
            <div className="v num"><CountUp value={v} /></div>
            <div className="eyebrow">{k}</div>
            <div className="src">
              {href ? <a href={href} target="_blank" rel="noreferrer">{src} ↗</a> : src}
            </div>
          </div>
        ))}
      </section>

      {/* 2 — why you cannot do this today */}
      <section className="beat">
        <Rise>
          <div className="eyebrow eyebrow-accent">The problem</div>
          <h2 className="claim">One stolen key reroutes every future payment.</h2>
          <div className="cols-3 gapped">
            {TODAY.map(([what, one, then]) => (
              <div key={what} className="card today">
                <div className="eyebrow">{what}</div>
                <div className="t-one">{one}</div>
                <div className="t-then">{then}</div>
              </div>
            ))}
          </div>
        </Rise>
      </section>

      {/* 3 — how we get around it */}
      <section className="beat">
        <Rise>
          <div className="beside">
            <div>
              <div className="eyebrow eyebrow-accent">What Writ does</div>
              <h2 className="claim">So we took that power away from everyone.</h2>
              <p className="lead">
                Your wallet funds it. A separate offline key redirects it. Not a permission
                check — <strong>there is no function to call</strong>.
              </p>
              <div className="hero-cta">
                <NetLink to="/how" className="btn btn-lg">See how it works</NetLink>
              </div>
            </div>
            <KeysScene />
          </div>
        </Rise>
      </section>

      {/* 4 — and nobody runs it */}
      <section className="beat">
        <Rise>
          <div className="eyebrow eyebrow-accent">And nobody runs it</div>
          <h2 className="claim">Twenty-five payments. No keeper.</h2>
          <Timeline />
        </Rise>
      </section>

      {/* 5 — what it refuses to be */}
      <section className="beat">
        <Rise>
          <div className="section-head center">
            <h2 className="claim centered">Four things it does not have.</h2>
          </div>
          <div className="cols-4">
            {NOT.map(([t, d]) => (
              <div key={t} className="have">
                <div className="eyebrow">{t}</div>
                <div className="text-2">{d}</div>
              </div>
            ))}
          </div>
          <p className="muted center limit">
            One limit, said out loud: 30 days after the end date, the funding wallet
            reclaims whatever nobody collected.
          </p>
        </Rise>
      </section>

      {/* the ask */}
      {live !== null && (
        <section className="live-cta">
          <div>
            <span className="live-dot">Live on Arc mainnet</span>
            <h2>Order #{live.toString()} is paying 0.01 USDC a day.</h2>
            <p>Press Pay and keep the tip. Or try to steal it and watch Arc refuse.</p>
          </div>
          <Link to={order} className="btn btn-primary btn-xl">
            Open order #{live.toString()} <ArrowRight size={18} />
          </Link>
        </section>
      )}
    </div>
  );
}
