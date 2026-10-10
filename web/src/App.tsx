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

/**
 * Minimal on purpose. This was a four-column sitemap, which is furniture a
 * site with three pages has not earned: it took a screen of height to repeat
 * the nav and list things the page above had already said. A footer here only
 * has to do two jobs — let a sceptic reach the chain, and name what the app
 * never does.
 */
function Footer() {
  const net = useNetwork();
  return (
    <footer className="footer">
      <div className="container foot-row">
        <span className="brand"><span className="brand-mark"><ScrollText size={15} /></span>Writ</span>
        <nav className="foot-links">
          <NetLink to="/how">How it works</NetLink>
          <NetLink to="/open">New order</NetLink>
          {live !== null && <NetLink to={`/order/${live}`}>Order #{live.toString()}</NetLink>}
          <a href={`${net.explorer}/address/${net.writ}`} target="_blank" rel="noreferrer">
            Contract <ArrowUpRight size={12} />
          </a>
          <a href={`https://sourcify.dev/#/lookup/${net.writ}`} target="_blank" rel="noreferrer">
            Source <ArrowUpRight size={12} />
          </a>
        </nav>
      </div>
      <div className="container foot-rule">
        <span>Arc mainnet · {net.writ}</span>
        <span>No servers. Your key card never leaves your browser.</span>
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
