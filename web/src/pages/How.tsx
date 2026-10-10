// How it works: four pictures, and almost no sentences.
//
// The shape is Rialto's — a numbered chapter, one claim in the display face,
// one line under it, a figure that assembles itself, and three links that let
// the reader check the claim against the chain rather than take it.
//
// Text here is deliberately starved. Every sentence that could be a picture
// became one; everything a sceptic would want to verify became a link. If you
// are tempted to add a paragraph, add a figure instead.

import { ArrowRight } from "lucide-react";
import { NETWORKS } from "../config";
import { useNetwork } from "../hooks";
import { Rise } from "../lib/reveal";
import { NetLink } from "../ui";
import { Frozen, PaysItself, Signature, Timeline, TwoKeys } from "./figures";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;
const addr = MAINNET.writ;
const ex = MAINNET.explorer;

function Checks({ items }: { items: [string, string, string][] }) {
  return (
    <div className="checks">
      {items.map(([k, v, href]) => (
        <a key={k} href={href} target="_blank" rel="noreferrer">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </a>
      ))}
    </div>
  );
}

export function How() {
  const net = useNetwork();
  return (
    <div className="how">
      <section className="chapter lede">
        <Rise>
          <h1 className="claim">Three pictures. That is the whole thing.</h1>
          <p className="sub center">An order that pays itself, a key nobody else holds, and a recipient the issuer froze.</p>
        </Rise>
      </section>

      <section className="chapter">
        <Rise>
          <p className="num">One</p>
          <h2>It pays itself.</h2>
          <p className="sub">Fund it once. Any stranger can press Pay when a period is due, and keeps the tip.</p>
          <div className="plate">
            <PaysItself />
          </div>
          <p className="cap"><strong>There is no keeper.</strong></p>
          <Timeline />
          <Checks items={[
            ["What anyone calls", "execute(id)", `${ex}/address/${addr}`],
            ["What it costs them", "about $0.0022", `${ex}/address/${addr}`],
            ["Try it", live !== null ? `order #${live}` : "the live order", `/order/${live}?net=mainnet`],
          ]} />
        </Rise>
      </section>

      <section className="chapter">
        <Rise>
          <p className="num">Two</p>
          <h2>Only the key card can change it.</h2>
          <p className="sub">The wallet that funded the order cannot redirect it, reprice it or cancel it. There is no function for that.</p>
          <div className="plate">
            <TwoKeys />
          </div>
          <p className="cap"><strong>A stolen wallet is not a stolen payment.</strong></p>

          <p className="sub" style={{ marginTop: 38 }}>And it is the chain that checks, not our server: a 7,856-byte hash-based signature, verified by Arc itself.</p>
          <div className="plate">
            <Signature />
          </div>
          <p className="cap">
            <strong>Bound to the chain, the contract, the order, the action, a nonce and a deadline.</strong> Nothing replays.
          </p>

          <Checks items={[
            ["The standard", "NIST FIPS 205", "https://csrc.nist.gov/pubs/fips/205/final"],
            ["The precompile", "0x1800…0004", "https://docs.arc.io/arc/concepts/post-quantum-security"],
            ["Try to break it", live !== null ? `order #${live}` : "the live order", `/order/${live}`],
          ]} />
        </Rise>
      </section>

      <section className="chapter">
        <Rise>
          <p className="num">Three</p>
          <h2>A frozen recipient loses nothing.</h2>
          <p className="sub">On Arc, paying a blocklisted address reverts and burns the gas. Writ reads the blocklist first, for free, and parks the order instead.</p>
          <div className="plate">
            <Frozen />
          </div>
          <p className="cap"><strong>A freeze becomes a state, not an accident.</strong></p>
          <Checks items={[
            ["What it reads", "isBlacklisted(address)", `${ex}/address/0x3600000000000000000000000000000000000000`],
            ["What Arc's docs say", "reverts, consumes gas", "https://docs.arc.io/arc/references/evm-differences"],
            ["What Writ does", "Quarantined", `${ex}/address/${addr}`],
          ]} />
        </Rise>
      </section>

      <section className="chapter lede">
        <Rise>
          <h2 className="claim">Four things it does not have.</h2>
          <div className="cols-4" style={{ marginTop: 28 }}>
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
          <div className="hero-cta center" style={{ marginTop: 32, justifyContent: "center" }}>
            {live !== null && (
              <NetLink to={`/order/${live}`} className="btn btn-primary btn-lg">
                Try to hijack the live order <ArrowRight size={18} />
              </NetLink>
            )}
          </div>
          <p className="muted center readable" style={{ margin: "26px auto 0" }}>
            You are on {net.label}. The live order is on mainnet, and the hijack attempts are free
            simulations — nothing is signed and nothing is sent.
          </p>
        </Rise>
      </section>
    </div>
  );
}
