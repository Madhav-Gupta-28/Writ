import { Link } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, CalendarClock, ChevronDown, CircleUser, Coins, HandCoins, KeyRound, Lock, ScrollText,
  ServerOff, ShieldCheck, ShieldX, Skull, Wallet,
} from "lucide-react";
import { NETWORKS } from "../config";
import { NetLink } from "../ui";

function RolesDiagram() {
  return (
    <div className="diagram" aria-label="How the roles fit together">
      <div className="flow">
        <div className="node">
          <span className="ico"><Wallet size={22} /></span>
          <strong>Your wallet</strong>
          <small>adds money</small>
        </div>
        <span className="arrow"><ArrowRight size={22} /></span>
        <div className="node writ">
          <span className="ico"><ScrollText size={22} /></span>
          <strong>Writ order</strong>
          <small>holds it, pays on schedule</small>
        </div>
        <span className="arrow"><ArrowRight size={22} /></span>
        <div className="node">
          <span className="ico"><CircleUser size={22} /></span>
          <strong>Recipient</strong>
          <small>gets paid</small>
        </div>
      </div>
      <div className="connector" aria-hidden="true"><span /><span /></div>
      <div className="side-row">
        <div className="side">
          <span className="ico"><HandCoins size={20} /></span>
          <div><strong>Anyone</strong><small>presses Pay when it's due and earns a small tip</small></div>
        </div>
        <div className="side key">
          <span className="ico"><KeyRound size={20} /></span>
          <div><strong>Your key card</strong><small>the only thing that can change the recipient, kept offline</small></div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Coins, title: "Fund it", text: "Choose who gets paid, how much and how often. Sign once, and the money goes into the order." },
  { icon: CalendarClock, title: "It pays on schedule", text: "Every time a payment is due, anyone can press Pay and earn a small tip. No server, no subscription." },
  { icon: KeyRound, title: "Only your key card can change it", text: "Your key card is a password-protected file only you hold. Without it, nobody can redirect the money. Not even your own wallet." },
];

export function Home() {
  const live = NETWORKS.mainnet.featuredOrder;
  return (
    <div className="stack-lg">
      <section className="hero">
        <div>
          <h1>Recurring USDC payments <em>a hacker can't redirect.</em></h1>
          <p className="lead">Set up a payment once and it keeps paying the same person on schedule. Even someone who steals your wallet can't send it anywhere else.</p>
          <div className="hero-cta">
            {live !== null && (
              <Link to={`/order/${live}?net=mainnet`} className="btn btn-primary btn-lg">See a live order <ArrowRight size={18} /></Link>
            )}
            <NetLink to="/open" className="btn btn-lg">Create an order</NetLink>
          </div>
          <div className="trust">
            <span><ShieldCheck size={16} /> Checked by the blockchain itself</span>
            <span><ServerOff size={16} /> No servers, no sign-up</span>
          </div>
        </div>
        <RolesDiagram />
      </section>

      <section>
        <div className="section-head">
          <div className="eyebrow">How it works</div>
          <h2>Three steps, then it runs itself</h2>
        </div>
        <div className="cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="card step">
              <span className="ico"><Icon size={24} /></span>
              <span className="n">STEP {i + 1}</span>
              <h3>{title}</h3>
              <p className="text-2">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card hacker">
        <div>
          <div className="eyebrow">The hacker test</div>
          <h2 style={{ marginTop: 6, fontSize: "1.6rem" }}>What happens if someone steals your wallet?</h2>
          <p className="text-2 readable" style={{ marginTop: 12 }}>
            With most payment tools, a stolen wallet means stolen payments. With Writ, your wallet can add money but it can never
            change who gets paid. That takes your key card, which was never on the hacked device.
          </p>
          {live !== null && (
            <p style={{ marginTop: 16 }}>
              <Link to={`/order/${live}?net=mainnet`} className="link">Try it yourself on a live order <ArrowRight size={14} style={{ verticalAlign: -2 }} /></Link>
            </p>
          )}
        </div>
        <div className="attack">
          <div className="attack-row bad"><span className="ico"><Skull size={18} /></span><div><strong>Hacker has your wallet</strong><div className="muted">and tries: "send all future payments to me"</div></div></div>
          <div className="attack-row blocked"><span className="ico"><ShieldX size={18} /></span><div><strong>Blocked</strong><div className="muted" style={{ color: "#ffc2c8" }}>Changing the recipient needs the key card. The wallet alone is refused.</div></div></div>
          <div className="attack-row safe"><span className="ico"><BadgeCheck size={18} /></span><div><strong>Payments keep going to the right person</strong><div className="muted" style={{ color: "var(--accent)" }}>Nothing to undo, nothing lost.</div></div></div>
        </div>
      </section>

      {live !== null && (
        <section className="live-cta">
          <div>
            <span className="live-dot">Live on Arc mainnet</span>
            <h2 style={{ marginTop: 10 }}>Order #{live.toString()} pays 0.01 USDC every day</h2>
            <p>It's real and running right now. Watch the countdown, press Pay when it's due and earn the tip, or try to hijack it and see it get blocked.</p>
          </div>
          <Link to={`/order/${live}?net=mainnet`} className="btn btn-primary btn-lg">Open order #{live.toString()} <ArrowRight size={18} /></Link>
        </section>
      )}

      <details className="tech more">
        <summary><Lock size={16} /> How it works: the technical version <ChevronDown size={16} /></summary>
        <div className="more-body">
          <dl>
            <dt>Three separate powers</dt>
            <dd>Funding is your normal (ECDSA) wallet. Paying is permissionless: anyone can call <span className="mono">execute</span> and is reimbursed gas plus a capped tip. Changing terms requires an SLH-DSA-SHA2-128s signature (NIST FIPS 205, hash-based, post-quantum).</dd>
            <dt>Verified on-chain</dt>
            <dd>Arc checks the key card signature with its built-in post-quantum precompile at <span className="mono">0x1800…0004</span>. Every signature is bound to the chain, the contract, the order, the action, a nonce and a deadline, so it can't be replayed.</dd>
            <dt>Frozen recipients</dt>
            <dd>Before each payment the contract checks USDC's blocklist. If the recipient is frozen, the order is marked frozen instead of failing; the key card can then pick a new recipient or cancel and refund.</dd>
            <dt>The wallet's only exits</dt>
            <dd>A 30-day public notice to cancel (the key card can veto it), and reclaiming leftovers 30 days after the end date.</dd>
            <dt>No backend</dt>
            <dd>This site is static. It reads the chain directly; your key card is generated, encrypted (PBKDF2 + AES-GCM) and used only in your browser.</dd>
          </dl>
        </div>
      </details>
    </div>
  );
}
