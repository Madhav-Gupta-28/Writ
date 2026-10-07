import { useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ScrollText, Search, TriangleAlert } from "lucide-react";
import { NETWORKS, type NetworkName } from "./config";
import { useNetwork } from "./hooks";
import { Home } from "./pages/Home";
import { OpenOrder } from "./pages/Open";
import { OrderView } from "./pages/OrderView";
import { Addr, ConnectButton, NetLink } from "./ui";

function NetworkSwitch() {
  const net = useNetwork();
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <label className="net-switch">
      <span className="sr-only">Network</span>
      <select value={net.name} onChange={(e) => nav(`${pathname}?net=${e.target.value as NetworkName}`)} className={net.name === "mainnet" ? "is-mainnet" : ""}>
        {Object.values(NETWORKS).map((n) => <option key={n.name} value={n.name}>{n.label}</option>)}
      </select>
    </label>
  );
}

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

export function App() {
  const net = useNetwork();
  return (
    <div className="app">
      <header className="topbar">
        <div className="container topbar-inner">
          <NetLink to="/" className="brand"><span className="brand-mark"><ScrollText size={18} /></span>Writ</NetLink>
          <nav className="nav">
            <NetLink to="/open">New order</NetLink>
            <FindOrder />
          </nav>
          <div className="topbar-right">
            <NetworkSwitch />
            <ConnectButton />
          </div>
        </div>
      </header>
      {net.name === "mainnet" && (
        <div className="mainnet-banner"><div className="container"><TriangleAlert size={16} />You're on Arc mainnet. Anything you send here is real money.</div></div>
      )}
      <main className="main">
        <div className="container">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/open" element={<OpenOrder />} />
            <Route path="/order/:id" element={<OrderView />} />
            <Route path="/order/:id/manage" element={<OrderView initialTab="keycard" />} />
            <Route path="/order/:id/payer" element={<OrderView initialTab="payer" />} />
            <Route path="*" element={<div className="card"><h2>Page not found</h2><p style={{ marginTop: 8 }}><NetLink to="/">Go home</NetLink></p></div>} />
          </Routes>
        </div>
      </main>
      <footer className="footer">
        <div className="container">
          <span>Writ on {net.label} · contract <Addr net={net} a={net.writ} /></span>
          <span>No servers. No sign-ups. Your key card never leaves your browser.</span>
        </div>
      </footer>
    </div>
  );
}
