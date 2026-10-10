// The landing page: five beats, and the text is only ever a caption.
//
// The rule that governs every edit here: nobody reads a landing page. A judge
// arrives with thirty seconds and arrives sceptical. So every claim is either a
// picture, a number, or a link to the chain — and no paragraph runs past two
// lines.
//
// The headline used to be three imperatives ("Set it once. Steal the wallet.
// It still pays."). It was punchy and it explained nothing: you had to already
// know what the product was for it to land. This one states the product and
// the surprise in one sentence, and the plate beside it proves the surprise.

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { NETWORKS } from "../config";
import { Rise } from "../lib/reveal";
import { EXECUTE, PQ_ACTION, TESTS, fmtGas } from "../measured";
import { NetLink } from "../ui";
import { StandingOrder, Timeline, TwoKeys } from "./figures";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;
const order = live !== null ? `/order/${live}` : "/open";

// Every stat says where it came from. The first two are receipts of real
// transactions on Arc mainnet (see measured.ts); they used to be pre-launch
// estimates ($0.0022, 433,953 gas) that no transaction ever produced.
const ex = MAINNET.explorer;
const STATS: { v: string; k: string; src: string; href?: string }[] = [
  { v: EXECUTE.usd, k: "to make one payment", src: `${fmtGas(EXECUTE.gas)} gas · mainnet tx`, href: `${ex}/tx/${EXECUTE.tx}` },
  { v: fmtGas(PQ_ACTION.gas), k: "gas per key card action", src: `${PQ_ACTION.usd} · mainnet tx`, href: `${ex}/tx/${PQ_ACTION.tx}` },
  { v: String(TESTS.total), k: `tests, ${TESTS.live} against live Arc`, src: `passing as of ${TESTS.asOf}` },
  { v: "0", k: "servers, admins, upgrades", src: "verified source", href: `https://sourcify.dev/#/lookup/${MAINNET.writ}` },
];

// The problem, as three things that are true of every recurring payment that
// exists today. Each one is a single point of failure named out loud.
const TODAY: [string, string, string][] = [
  ["A card on file", "one phished login", "the payout address is theirs"],
  ["A multisig", "one signer short of threshold", "you are still negotiating"],
  ["A contract subscription", "whoever holds the owner key", "points it anywhere, instantly"],
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
      {/* 1 — what it is */}
      <section className="hero">
        <div className="hero-copy">
          <span className="pill pill-accent">Live on Arc mainnet</span>
          <h1>
            <span>A recurring USDC payment</span>
            <em>not even your wallet can redirect.</em>
          </h1>
          <p className="lead">
            Moving the money somewhere else needs a post-quantum key card you keep offline.
            Arc checks it inside the chain. There is no other way in.
          </p>
          <div className="hero-cta">
            <Link to={order} className="btn btn-primary btn-xl">
              Try to steal a live payment <ArrowRight size={18} />
            </Link>
          </div>
        </div>
        <div className="hero-art"><StandingOrder /></div>
      </section>

      {/* the numbers */}
      <section className="statband">
        {STATS.map(({ v, k, src, href }) => (
          <div key={k} className="stat">
            <div className="v num">{v}</div>
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
                Funding is your ordinary wallet. Redirecting is a separate key that was never
                online. Not a permission check — <strong>there is no function to call</strong>.
              </p>
              <div className="hero-cta">
                <NetLink to="/how" className="btn btn-lg">See how it works</NetLink>
              </div>
            </div>
            <TwoKeys />
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
            And one limit, said out loud: 30 days after the end date the funding wallet can
            reclaim whatever nobody collected.
          </p>
        </Rise>
      </section>

      {/* the ask */}
      {live !== null && (
        <section className="live-cta">
          <div>
            <span className="live-dot">Live on Arc mainnet</span>
            <h2>Order #{live.toString()} is paying 0.01 USDC a day.</h2>
            <p>Press Pay and keep the tip. Or try all four ways to steal it and watch Arc refuse you.</p>
          </div>
          <Link to={order} className="btn btn-primary btn-xl">
            Open order #{live.toString()} <ArrowRight size={18} />
          </Link>
        </section>
      )}
    </div>
  );
}
