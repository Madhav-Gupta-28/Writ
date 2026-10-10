// How it works, as three scenes you walk through.
//
// Rebuilt for the spatial design. The previous page put each idea in a small
// SVG on a centred plate, which scaled its own type down to a few pixels on a
// wide screen and looked "squeezed". Here each idea gets the full width: a
// headline, one sentence, and a stage of real, full-size objects at different
// depths (pages/spatial.tsx). The claims stay checkable: every scene ends in
// three links to the chain, the standard or the docs.

import type { ReactNode } from "react";
import { ArrowDown } from "lucide-react";
import { NETWORKS } from "../config";
import { Rise } from "../lib/reveal";
import { Words } from "../lib/motion";
import { EXECUTE } from "../measured";
import { Timeline } from "./figures";
import { FrozenScene, KeysScene, LiveCall, PaysScene, SignatureStats, Tilt } from "./spatial";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;
const addr = MAINNET.writ;
const ex = MAINNET.explorer;

function Checks({ items }: { items: [string, string, string][] }) {
  return (
    <div className="checks">
      {items.map(([k, v, href]) => (
        <a key={k} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer">
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </a>
      ))}
    </div>
  );
}

const PORTALS = [
  { id: "pays", n: "One", t: "It pays itself.", d: "Fund it once. Anyone can press Pay and keep a tip." },
  { id: "keys", n: "Two", t: "Only the key card can change it.", d: "A stolen wallet cannot redirect a single payment." },
  { id: "frozen", n: "Three", t: "A frozen recipient loses nothing.", d: "The order parks instead of burning gas." },
];

function Scene({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  const i = PORTALS.findIndex((p) => p.id === id);
  return (
    <section id={id} className="scene">
      <Rise>
        <header className="scene-head">
          <div>
            <p className="scene-num"><span>{String(i + 1).padStart(2, "0")}</span>{PORTALS[i].n}</p>
            <h2 className="scene-title">{title}</h2>
          </div>
          <p className="scene-sub">{sub}</p>
        </header>
        <div className="scene-body">{children}</div>
      </Rise>
    </section>
  );
}

export function How() {
  return (
    <div className="how-spatial">
      <section className="how-intro">
        <h1 className="mega"><Words text="How Writ works" step={90} /></h1>
        <p className="intro-sub">Three ideas. Check each one on the chain.</p>
        <div className="portals">
          {PORTALS.map((p, i) => (
            <Tilt key={p.id} className="portal-wrap">
              <a className="portal" href={`#${p.id}`}>
                <span className="portal-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="portal-t">{p.t}</span>
                <span className="portal-d">{p.d}</span>
                <span className="portal-go">See it <ArrowDown size={15} /></span>
              </a>
            </Tilt>
          ))}
        </div>
      </section>

      <Scene id="pays" title="It pays itself." sub="Fund it once. Anyone can press Pay when it is due, and keeps the fee plus a tip.">
        <PaysScene />
        <Timeline />
        <Checks items={[
          ["What anyone calls", "execute(id)", `${ex}/address/${addr}`],
          ["The fee they front", `about ${EXECUTE.usd}, refunded (mainnet tx)`, `${ex}/tx/${EXECUTE.tx}`],
          ["Try it", live !== null ? `order #${live}` : "the live order", `/order/${live}?net=mainnet`],
        ]} />
      </Scene>

      <Scene id="keys" title="Only the key card can change it." sub="The funding wallet cannot redirect, reprice or cancel it. There is no function for that — only an offline key, checked by Arc.">
        <KeysScene />
        <SignatureStats />
        <Checks items={[
          ["The standard", "NIST FIPS 205", "https://csrc.nist.gov/pubs/fips/205/final"],
          ["The precompile", "0x1800…0004", "https://docs.arc.io/arc/concepts/post-quantum-security"],
          ["Try to break it", live !== null ? `order #${live}` : "the live order", `/order/${live}?net=mainnet`],
        ]} />
      </Scene>

      <Scene id="frozen" title="A frozen recipient loses nothing." sub="Paying a frozen address reverts and burns the gas. Writ reads the blocklist first, for free, and parks the order instead.">
        <FrozenScene />
        <Checks items={[
          ["What it reads", "isBlacklisted(address)", `${ex}/address/0x3600000000000000000000000000000000000000`],
          ["What Arc's docs say", "reverts, consumes gas", "https://docs.arc.io/arc/references/evm-differences"],
          ["What Writ does", "Quarantined", `${ex}/address/${addr}`],
        ]} />
      </Scene>

      <section className="scene scene-close">
        <Rise>
          <h2 className="scene-title center">Four things it does not have.</h2>
          <div className="nothave">
            {[
              ["No admin", "nobody can pause it"],
              ["No upgrade path", "the code cannot change"],
              ["No custody", "we never hold your money"],
              ["No server", "delete us and it still pays"],
            ].map(([t, d]) => (
              <Tilt key={t} className="nothave-wrap" max={5}>
                <div className="nothave-tile">
                  <span className="nh-t">{t}</span>
                  <span className="nh-d">{d}</span>
                </div>
              </Tilt>
            ))}
          </div>
          <div className="close-cta">
            <LiveCall />
            <p className="muted">The live order is on Arc mainnet. Hijack attempts are free simulations: nothing is signed and nothing is sent.</p>
          </div>
        </Rise>
      </section>
    </div>
  );
}
