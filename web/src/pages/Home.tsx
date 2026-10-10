// The landing page: four beats, and the text is only ever a caption.
//
// The shape is Rialto's — what it is, why you cannot do it today, how we get
// around it, what has already happened — with Tally's hero furniture on top:
// three pills, a headline in three short lines, and one real artifact beside
// it rather than a diagram of roles.
//
// The rule that governs every edit to this file: nobody reads a landing page.
// A judge arrives with thirty seconds and arrives sceptical. So every claim is
// either a picture, a number, or a link to the chain — and the longest piece of
// prose on the page is two sentences.

import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { NETWORKS } from "../config";
import { Rise } from "../lib/reveal";
import { NetLink } from "../ui";
import { StandingOrder, Timeline, TwoKeys } from "./figures";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;
const ex = MAINNET.explorer;
const order = live !== null ? `/order/${live}?net=mainnet` : "/open";

const STATS: [string, string][] = [
  ["$0.0022", "to make one payment"],
  ["433,953", "gas to prove authority"],
  ["197", "tests, 7 against live Arc"],
  ["0", "servers, admins, upgrades"],
];

// The problem, as three things that are true of every recurring payment that
// exists today. Numbers rather than adjectives.
const TODAY: [string, string, string][] = [
  ["A card on file", "one phished login", "and the payout address is theirs"],
  ["A multisig", "one compromised signer short of threshold", "and you are still negotiating"],
  ["A smart-contract subscription", "whoever holds the owner key", "can point it anywhere, instantly"],
];

export function Home() {
  return (
    <div className="stack-lg">
      {/* 1 — what it is */}
      <section className="hero">
        <div>
          <div className="pills">
            <span className="pill pill-accent">Live on Arc mainnet</span>
            <span className="pill">NIST FIPS 205</span>
            <span className="pill">No server</span>
          </div>
          <h1>
            <span>Set it once.</span>
            <span>Steal the wallet.</span>
            <em>It still pays.</em>
          </h1>
          <p className="lead">
            A standing USDC order that <strong>your own wallet cannot redirect</strong>. Moving the
            money somewhere else needs a post-quantum key card — and Arc checks it inside the chain.
          </p>
          <div className="hero-cta">
            <Link to={order} className="btn btn-primary btn-lg">
              Try to hijack it <ArrowRight size={18} />
            </Link>
            <NetLink to="/how" className="btn btn-lg">How it works</NetLink>
          </div>
          <div className="dont-trust">
            <div className="eyebrow">Don&rsquo;t take our word for it</div>
            <a className="link" href={`${ex}/address/${MAINNET.writ}`} target="_blank" rel="noreferrer">
              Read the contract on Arc <ArrowUpRight size={14} />
            </a>
            <span className="muted">There is no function that redirects an order. Look.</span>
          </div>
        </div>
        <StandingOrder />
      </section>

      {/* the numbers */}
      <section className="statband">
        {STATS.map(([v, k]) => (
          <div key={k} className="stat">
            <div className="v num">{v}</div>
            <div className="eyebrow">{k}</div>
          </div>
        ))}
      </section>

      {/* 2 — why you cannot do this today */}
      <section>
        <Rise>
          <div className="eyebrow eyebrow-accent">The problem</div>
          <h2 className="claim">Every recurring payment has one key that can reroute it.</h2>
          <div className="cols-3" style={{ marginTop: 28 }}>
            {TODAY.map(([what, one, then]) => (
              <div key={what} className="card today">
                <div className="eyebrow">{what}</div>
                <div className="t-one">{one}</div>
                <div className="t-then">{then}</div>
              </div>
            ))}
          </div>
          <p className="lead" style={{ marginTop: 26, maxWidth: "46ch" }}>
            Salaries, rent, vesting, payroll. The money is correct right up to the moment somebody
            else holds the key.
          </p>
        </Rise>
      </section>

      {/* 3 — how we get around it */}
      <section>
        <Rise>
          <div className="beside">
            <div>
              <div className="eyebrow eyebrow-accent">What Writ does</div>
              <h2 className="claim">So we take that power away from everyone.</h2>
              <p className="lead" style={{ marginTop: 18 }}>
                Funding is your ordinary wallet. <strong>Redirecting is a separate key</strong>,
                generated in your browser and never online.
              </p>
              <p className="lead" style={{ marginTop: 14 }}>
                Not a permission check. There is no function to call.
              </p>
              <div className="hero-cta" style={{ marginTop: 26 }}>
                <NetLink to="/how" className="btn btn-lg">See all three pictures</NetLink>
              </div>
            </div>
            <TwoKeys />
          </div>
        </Rise>
      </section>

      {/* and it runs itself */}
      <section>
        <Rise>
          <div className="eyebrow eyebrow-accent">And nobody runs it</div>
          <h2 className="claim">Twenty-five payments. No keeper.</h2>
          <Timeline />
        </Rise>
      </section>

      {/* 4 — what has already happened */}
      {live !== null && (
        <section className="live-cta">
          <div>
            <span className="live-dot">Live on Arc mainnet</span>
            <h2 style={{ marginTop: 10 }}>Order #{live.toString()} pays 0.01 USDC a day, right now.</h2>
            <p>
              Press Pay and keep the tip. Or try all four ways to steal it and watch Arc refuse you.
              Both are free.
            </p>
          </div>
          <Link to={order} className="btn btn-primary btn-lg">
            Open order #{live.toString()} <ArrowRight size={18} />
          </Link>
        </section>
      )}

      <section className="haves">
        <div className="section-head center">
          <h2>Four things it does not have.</h2>
        </div>
        <div className="cols-4">
          {[
            ["No admin", "nobody can pause it"],
            ["No upgrade path", "the code cannot change"],
            ["No custody", "we never hold your money"],
            ["No server", "delete us and it still pays"],
          ].map(([t, d]) => (
            <div key={t} className="have">
              <div className="eyebrow">{t}</div>
              <div className="text-2">{d}</div>
            </div>
          ))}
        </div>
        <p className="muted center readable" style={{ margin: "22px auto 0" }}>
          And one it does have: 30 days after the end date the funding wallet can take back whatever
          is left, including payments nobody collected. Anyone can press Pay, so collecting on time
          is the answer — but it is a real limit, so it is written here.
        </p>
      </section>
    </div>
  );
}
