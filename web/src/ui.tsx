import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chainIdOf, type Network } from "./config";
import type { TxStatus } from "./hooks";
import { humanError } from "./lib/errors";
import { short } from "./lib/format";
import type { OrderState } from "./lib/order";
import { addressLink, txLink } from "./lib/tx";

/** A Link that keeps ?net= so the page stays on the same network. */
export function NetLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { search } = useLocation();
  const net = new URLSearchParams(search).get("net");
  return <Link className={className} to={net ? `${to}${to.includes("?") ? "&" : "?"}net=${net}` : to}>{children}</Link>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function StatusLine({ status, net }: { status: TxStatus; net: Network }) {
  if (status.kind === "idle") return null;
  if (status.kind === "busy") return <div className="status busy"><Spinner label={status.label} /></div>;
  if (status.kind === "error") return <div className="status error" role="alert">{status.message}</div>;
  return (
    <div className="status ok" role="status">
      {status.message}{" "}
      {status.hash && <a href={txLink(net, status.hash)} target="_blank" rel="noreferrer">View transaction ↗</a>}
    </div>
  );
}

export function Addr({ net, a, label }: { net: Network; a: string; label?: string }) {
  return (
    <a className="mono" href={addressLink(net, a)} target="_blank" rel="noreferrer" title={a}>
      {label ?? short(a)}
    </a>
  );
}

const STATE_TEXT: Record<OrderState, string> = {
  None: "Not found", Active: "Running", Quarantined: "Paused: recipient frozen", Cancelled: "Cancelled", Completed: "Finished",
};
export function StateBadge({ state }: { state: OrderState }) {
  return <span className={`badge badge-${state.toLowerCase()}`}>{STATE_TEXT[state]}</span>;
}

export function Card({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected && address) {
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => disconnect()} title="Disconnect">
        <span className="dot" /> {short(address)}
      </button>
    );
  }
  const injected = connectors[0];
  return (
    <span className="connect">
      <button className="btn btn-sm" disabled={isPending || !injected} onClick={() => injected && connect({ connector: injected })}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
      {error && <span className="field-error">{humanError(error)}</span>}
    </span>
  );
}

/** Renders children only when a wallet is connected on this page's network. */
export function WalletGate({ net, children, why }: { net: Network; children: ReactNode; why?: string }) {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain, isPending: switching, error } = useSwitchChain();
  const hasWallet = typeof window !== "undefined" && "ethereum" in window;

  if (!hasWallet) {
    return (
      <div className="gate">
        <p>{why ?? "This needs a wallet."} Install a browser wallet such as MetaMask or Rabby, then reload this page.</p>
      </div>
    );
  }
  if (!isConnected) {
    return (
      <div className="gate">
        <p>{why ?? "Connect a wallet to continue."}</p>
        <button className="btn" disabled={isPending} onClick={() => connect({ connector: connectors[0], chainId: chainIdOf(net) })}>
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    );
  }
  if (chainId !== net.chain.id) {
    return (
      <div className="gate">
        <p>Your wallet is on another network. Switch to {net.label}. If your wallet doesn't know Arc yet, it will offer to add it.</p>
        <button className="btn" disabled={switching} onClick={() => switchChain({ chainId: chainIdOf(net) })}>
          {switching ? "Switching…" : `Switch to ${net.label}`}
        </button>
        {error && <p className="field-error">{humanError(error)}</p>}
      </div>
    );
  }
  return <>{children}</>;
}
