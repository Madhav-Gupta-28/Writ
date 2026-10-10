// The shell: a bar, the routes, and a footer that does real work.
//
// Two things used to live up here and no longer do. A network switcher, which
// asked a visitor to choose between mainnet and testnet before they knew what
// the product was and defaulted them to play money; and a standing mainnet
// warning banner, which cost a strip of vertical space on every page to say
// something that is now simply always true. Both are in the footer's one line
// instead (see config.ts for why the app is mainnet-only).

import { useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, ScrollText, Search } from "lucide-react";
import { NETWORKS } from "./config";
import { useNetwork } from "./hooks";
import { Home } from "./pages/Home";
import { How } from "./pages/How";
import { OpenOrder } from "./pages/Open";
import { OrderView } from "./pages/OrderView";
import { ConnectButton, NetLink } from "./ui";

const MAINNET = NETWORKS.mainnet;
const live = MAINNET.featuredOrder;

function FindOrder() {
  const [id, setId] = useState("");
  const nav = useNavigate();
  const { search } = useLocation();
  return (
    <form className="find" onSubmit={(e) => { e.preventDefault(); if (/^\d+$/.test(id)) nav(`/order/${id}${search}`); }}>
      <Search size={15} />
      <input inputMode="numeric" placeholder="Find order #" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} aria-label="Order number" />
    </form>
  );
}

/** Every column is a way to check a claim the site makes, or a way to act on it. */
function Footer() {
  const net = useNetwork();
  return (
    <footer className="footer">
      <div className="container">
        <div className="foot-grid">
          <div className="foot-brand">
            <span className="brand"><span className="brand-mark"><ScrollText size={16} /></span>Writ</span>
            <p>A standing USDC order on Arc that only an offline key can redirect.</p>
          </div>

          <div className="foot-col">
            <div className="eyebrow">Use it</div>
            <NetLink to="/open">Create an order</NetLink>
            {live !== null && <NetLink to={`/order/${live}`}>Live order #{live.toString()}</NetLink>}
            <NetLink to="/how">How it works</NetLink>
          </div>

          <div className="foot-col">
            <div className="eyebrow">Check it</div>
            <a href={`${net.explorer}/address/${net.writ}`} target="_blank" rel="noreferrer">
              Contract on Arc <ArrowUpRight size={12} />
            </a>
            <a href={`https://sourcify.dev/#/lookup/${net.writ}`} target="_blank" rel="noreferrer">
              Verified source <ArrowUpRight size={12} />
            </a>
            <a href="https://csrc.nist.gov/pubs/fips/205/final" target="_blank" rel="noreferrer">
              NIST FIPS 205 <ArrowUpRight size={12} />
            </a>
          </div>

          <div className="foot-col">
            <div className="eyebrow">What it never does</div>
            <span>Hold your money</span>
            <span>Run a server</span>
            <span>See your key card</span>
          </div>
        </div>

        <div className="foot-rule">
          <span>Arc mainnet · chain 5042 · real money</span>
          <span className="mono">{net.writ}</span>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <NetLink to="/" className="brand"><span className="brand-mark"><ScrollText size={18} /></span>Writ</NetLink>
          <nav className="nav">
            <NetLink to="/how">How it works</NetLink>
            <NetLink to="/open">New order</NetLink>
            <FindOrder />
          </nav>
          <div className="topbar-right">
            <span className="net-badge">Arc mainnet</span>
            <ConnectButton />
          </div>
        </div>
      </header>
      <main className="main">
        <div className="container">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/how" element={<How />} />
            <Route path="/open" element={<OpenOrder />} />
            <Route path="/order/:id" element={<OrderView />} />
            <Route path="/order/:id/manage" element={<OrderView initialTab="keycard" />} />
            <Route path="/order/:id/payer" element={<OrderView initialTab="payer" />} />
            <Route path="*" element={<div className="card"><h2>Page not found</h2><p style={{ marginTop: 8 }}><NetLink to="/">Go home</NetLink></p></div>} />
          </Routes>
        </div>
      </main>
      <Footer />
    </div>
  );
}
