import { Link } from "react-router-dom";
import { NETWORKS } from "../config";
import { NetLink } from "../ui";

export function Home() {
  const live = NETWORKS.mainnet.featuredOrder;
  return (
    <div className="home">
      <section className="hero">
        <h1>A standing payment order that nobody can quietly redirect.</h1>
        <p className="lead">
          Writ pays a fixed amount of USDC to the same recipient on a schedule, for as long as you choose, on Arc.
          No server, no keeper, no one has to sign each payment. Changing <em>who</em> gets paid takes a
          post-quantum key card that only you hold.
        </p>
        <div className="hero-cta">
          <NetLink to="/open" className="btn btn-lg">Open an order</NetLink>
          {live !== null && (
            <Link to={`/order/${live}?net=mainnet`} className="btn btn-lg btn-ghost">See a live order on mainnet →</Link>
          )}
        </div>
      </section>

      <section className="grid3">
        <div className="card">
          <h3>Your wallet funds it</h3>
          <p>Your normal wallet puts USDC in. It can top up, or give 30 days' notice to cancel. It can never change the recipient or the amount. A stolen wallet key can't redirect your payments.</p>
        </div>
        <div className="card">
          <h3>Anyone can deliver it</h3>
          <p>When a payment is due, anyone can press "Execute payment" and earns a small reward, paid by the order. They can't choose who gets paid, how much, or when.</p>
        </div>
        <div className="card">
          <h3>Only your key card changes it</h3>
          <p>A separate SLH-DSA key, made in your browser, is the only way to change the terms or cancel. Arc checks it on-chain. It's built to stay secure even against future quantum computers.</p>
        </div>
      </section>

      {live !== null && (
        <section className="card featured">
          <div>
            <h2>A real order, running on Arc mainnet</h2>
            <p>
              Order #{live.toString()} pays 0.01 USDC every day until November 1. When a payment is due, you can execute it
              yourself, from any wallet, and earn the reward. Nobody here has to do anything for it to keep paying.
            </p>
          </div>
          <Link to={`/order/${live}?net=mainnet`} className="btn">Open order #{live.toString()} on mainnet</Link>
        </section>
      )}

      <section className="card how">
        <h2>How it works</h2>
        <ol>
          <li><strong>Make a key card.</strong> Your browser generates it, you download it encrypted with a password, and you prove you saved it.</li>
          <li><strong>Set the terms.</strong> Who, how much, how often, and when it ends. The end date is required: it's the backstop if you ever lose the key card.</li>
          <li><strong>Sign once.</strong> One USDC authorization and one transaction open and fund the order. No separate "approve" step.</li>
          <li><strong>It pays itself.</strong> Each payment is triggered by whoever wants the reward. If the recipient's USDC is ever frozen, the order pauses instead of failing, and your key card decides what happens next.</li>
        </ol>
      </section>
    </div>
  );
}
