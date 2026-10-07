import { useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { NETWORKS, type NetworkName } from "./config";
import { useNetwork } from "./hooks";
import { Home } from "./pages/Home";
import { Manage } from "./pages/Manage";
import { OpenOrder } from "./pages/Open";
import { OrderView } from "./pages/OrderView";
import { PayerActions } from "./pages/Payer";
import { ConnectButton, NetLink } from "./ui";

function NetworkSwitch() {
  const net = useNetwork();
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <label className="net-switch">
      <span className="sr-only">Network</span>
      <select
        value={net.name}
        onChange={(e) => nav(`${pathname}?net=${e.target.value as NetworkName}`)}
        className={net.name === "mainnet" ? "is-mainnet" : ""}
      >
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
      <input inputMode="numeric" placeholder="Order #" value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} aria-label="Order number" />
    </form>
  );
}

export function App() {
  const net = useNetwork();
  return (
    <div className="app">
      <header className="topbar">
        <NetLink to="/" className="brand"><img src="/favicon.svg" alt="" width="26" height="26" /> Writ</NetLink>
        <nav className="nav">
          <NetLink to="/open">Open an order</NetLink>
          <FindOrder />
        </nav>
        <div className="topbar-right">
          <NetworkSwitch />
          <ConnectButton />
        </div>
      </header>
      {net.name === "mainnet" && (
        <div className="mainnet-banner">You're on Arc <strong>mainnet</strong>. Transactions here move real USDC.</div>
      )}
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/open" element={<OpenOrder />} />
          <Route path="/order/:id" element={<OrderView />} />
          <Route path="/order/:id/manage" element={<Manage />} />
          <Route path="/order/:id/payer" element={<PayerActions />} />
          <Route path="*" element={<div className="card"><h2>Page not found</h2><NetLink to="/">Go home</NetLink></div>} />
        </Routes>
      </main>
      <footer className="footer">
        <span>Writ on {net.label}: contract <a className="mono" href={`${net.explorer}/address/${net.writ}`} target="_blank" rel="noreferrer">{net.writ.slice(0, 10)}…</a></span>
        <span>Static site. No backend. Your key card never leaves this browser.</span>
      </footer>
    </div>
  );
}
