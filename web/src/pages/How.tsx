// How it works: three questions a sceptic asks, answered with a picture each.
//
// The shape is Rialto's: a numbered chapter, one claim in the display face, one
// sentence under it, one figure that assembles itself, and three links that let
// the reader check the claim against something real rather than take it.

import { ArrowRight } from "lucide-react";
import { NETWORKS } from "../config";
import { useNetwork } from "../hooks";
import { Rise } from "../lib/reveal";
import { NetLink } from "../ui";
import { Frozen, PaysItself, TwoKeys } from "./figures";

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
          <p className="sub center">
            An order that pays itself, a key nobody else holds, and a recipient the issuer
            froze. Everything else in Writ follows from these three.
          </p>
        </Rise>
      </section>

      <section className="chapter">
        <Rise>
          <p className="num">One</p>
          <h2>It pays itself.</h2>
          <p className="sub">
            You fund the order once. From then on any stranger can press Pay when a period is
            due, and the order reimburses their gas plus a small tip for doing it.
          </p>
          <div className="plate">
            <PaysItself />
            <p className="cap">
              <strong>There is no keeper.</strong> Paying is permissionless and profitable, so
              the job gets done by whoever wants the tip — not by a server you have to keep alive.
            </p>
          </div>
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
          <p className="sub">
            Redirecting the recipient, changing the amount or cancelling needs an
            SLH-DSA-SHA2-128s signature, which Arc checks on-chain. The wallet that funded the
            order cannot do any of it. There is no function for it.
          </p>
          <div className="plate">
            <TwoKeys />
            <p className="cap">
              <strong>A stolen wallet is not a stolen payment.</strong> The authority to
              redirect money sits on different cryptography, on a key that was never on the
              machine that got compromised.
            </p>
          </div>
          <Checks items={[
            ["The precompile", "0x1800…0004", "https://docs.arc.io/arc/concepts/post-quantum-security"],
            ["What it costs", "433,953 gas · $0.0087", `${ex}/address/${addr}`],
            ["The standard", "NIST FIPS 205", "https://csrc.nist.gov/pubs/fips/205/final"],
          ]} />
        </Rise>
      </section>

      <section className="chapter">
        <Rise>
          <p className="num">Three</p>
          <h2>A frozen recipient loses nothing.</h2>
          <p className="sub">
            USDC can be frozen by its issuer. On Arc a payment to a frozen address reverts,
            burns the gas and leaves no receipt — so Writ reads the blocklist first, for free,
            and parks the order instead of failing it.
          </p>
          <div className="plate">
            <Frozen />
            <p className="cap">
              <strong>A freeze becomes a state, not an accident.</strong> It is logged with a
              timestamp an auditor can cite, and the key card picks a successor or cancels and
              refunds.
            </p>
          </div>
          <Checks items={[
            ["What it reads", "isBlacklisted(address)", `${ex}/address/0x3600000000000000000000000000000000000000`],
            ["What Arc's docs say", "reverts, consumes gas", "https://docs.arc.io/arc/references/evm-differences"],
            ["What Writ does instead", "Quarantined", `${ex}/address/${addr}`],
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
            <NetLink to="/open" className="btn btn-lg">Create an order</NetLink>
          </div>
          <p className="muted center readable" style={{ margin: "26px auto 0" }}>
            You are on {net.label}. The live order above is on mainnet, and the hijack attempts
            are free simulations — nothing is signed and nothing is sent.
          </p>
        </Rise>
      </section>
    </div>
  );
}
