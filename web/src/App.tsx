// The shell: a bar, the routes, and a footer.
//
// Three things used to live in the bar and no longer do. A network switcher,
// which asked a visitor to choose between mainnet and testnet before they knew
// what the product was, and defaulted them to play money. A standing "real
// money" banner. And an ARC MAINNET badge beside the connect button.
//
// All three said the same thing, and the site is mainnet-only (see config.ts),
// so the network is now stated exactly once, in the footer. A fact repeated on
// every page in three places is furniture, not information.

import { useLayoutEffect, useState } from "react";
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
 * Every page opens at its top. The router swaps pages without a reload, so the
 * browser would otherwise keep the old page's scroll position, and on Back it
 * restores one. A link to a section (#pays on /how) keeps its jump.
 */
if (typeof history !== "undefined" && "scrollRestoration" in history) history.scrollRestoration = "manual";

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useLayoutEffect(() => {
    if (!hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
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
      <ScrollToTop />
      <header className="topbar">
        <div className="container topbar-inner">
          <NetLink to="/" className="brand"><span className="brand-mark"><ScrollText size={18} /></span>Writ</NetLink>
          <nav className="nav">
            <NetLink to="/how">How it works</NetLink>
            <NetLink to="/open">New order</NetLink>
            <FindOrder />
          </nav>
          <div className="topbar-right">
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
