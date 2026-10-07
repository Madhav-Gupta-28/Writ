import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import {
  Ban, Check, CircleCheck, CircleX, Copy, ExternalLink, KeyRound, Snowflake, Wallet, type LucideIcon,
} from "lucide-react";
import { chainIdOf, type Network } from "./config";
import type { TxStatus } from "./hooks";
import { humanError } from "./lib/errors";
import { short } from "./lib/format";
import type { OrderState } from "./lib/order";
import { addressLink, txLink } from "./lib/tx";

/** The one-line explanation that goes next to "key card" everywhere a newcomer sees it. */
export const KEY_CARD_LINE = "a password-protected file that only you hold, and the only thing that can change who gets paid.";

/** A Link that keeps ?net= so the page stays on the same network. */
export function NetLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { search } = useLocation();
  const net = new URLSearchParams(search).get("net");
  return <Link className={className} to={net ? `${to}${to.includes("?") ? "&" : "?"}net=${net}` : to}>{children}</Link>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </span>
  );
}

export function StatusLine({ status, net }: { status: TxStatus; net: Network }) {
  if (status.kind === "idle") return null;
  if (status.kind === "busy") {
    return <div className="status busy"><span className="spinner" aria-hidden="true" /><span role="status">{status.label}</span></div>;
  }
  if (status.kind === "error") return <div className="status error" role="alert"><CircleX size={18} className="icon" />{status.message}</div>;
  return (
    <div className="status ok" role="status">
      <CircleCheck size={18} className="icon" />
      <span>{status.message}{" "}{status.hash && <a href={txLink(net, status.hash)} target="_blank" rel="noreferrer">View transaction</a>}</span>
    </div>
  );
}

export function Note({ icon: Icon, kind, children }: { icon?: LucideIcon; kind?: "warn" | "ice" | "ok"; children: ReactNode }) {
  return <div className={`note ${kind ?? ""}`}>{Icon && <Icon size={18} className="icon" />}<div>{children}</div></div>;
}

/** Short address with a copy button and an explorer link. */
export function Addr({ net, a, full }: { net: Network; a: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(a); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  return (
    <span className="addr" title={a}>
      <a href={addressLink(net, a)} target="_blank" rel="noreferrer">{full ? a : short(a)}</a>
      <button className="icon-btn" onClick={copy} aria-label={copied ? "Copied" : "Copy address"} type="button">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <a className="icon-btn" href={addressLink(net, a)} target="_blank" rel="noreferrer" aria-label="View on explorer"><ExternalLink size={14} /></a>
    </span>
  );
}

const STATE: Record<OrderState, { text: string; icon: LucideIcon }> = {
  None: { text: "Not found", icon: Ban },
  Active: { text: "Paying", icon: CircleCheck },
  Quarantined: { text: "Frozen", icon: Snowflake },
  Cancelled: { text: "Cancelled", icon: Ban },
  Completed: { text: "Finished", icon: CircleCheck },
};
export function StateBadge({ state }: { state: OrderState }) {
  const { text, icon: Icon } = STATE[state];
  return <span className={`badge badge-${state.toLowerCase()}`}><Icon size={14} />{text}</span>;
}

export function Card({ title, children, className, eyebrow }: { title?: ReactNode; children: ReactNode; className?: string; eyebrow?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(eyebrow || title) && (
        <div style={{ marginBottom: 16, display: "grid", gap: 4 }}>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          {title && <h2>{title}</h2>}
        </div>
      )}
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

export function KeyCardHint() {
  return (
    <span className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap" }}>
      <KeyRound size={16} className="icon" style={{ marginTop: 3, color: "var(--accent)" }} />
      <span className="muted"><strong className="text-2">Key card:</strong> {KEY_CARD_LINE}</span>
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; icon: LucideIcon }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button key={key} role="tab" type="button" aria-selected={value === key} className={value === key ? "tab on" : "tab"} onClick={() => onChange(key)}>
          <Icon size={16} />{label}
        </button>
      ))}
    </div>
  );
}

export function Skel({ w, h = 16, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <span className="skel" style={{ display: "block", width: w ?? "100%", height: h, ...style }} />;
}

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected && address) {
    return (
      <button className="btn btn-sm wallet-chip" onClick={() => disconnect()} title="Disconnect">
        <span className="dot" /> <span className="mono">{short(address)}</span>
      </button>
    );
  }
  const injected = connectors[0];
  return (
    <button className="btn btn-sm" disabled={isPending || !injected} onClick={() => injected && connect({ connector: injected })}>
      <Wallet size={16} />{isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}

/** Renders children only when a wallet is connected on this page's network. */
export function WalletGate({ net, children, why }: { net: Network; children: ReactNode; why?: string }) {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain, isPending: switching, error } = useSwitchChain();
  const hasWallet = typeof window !== "undefined" && "ethereum" in window;

  if (!hasWallet) {
    return <Note icon={Wallet}>{why ?? "This needs a wallet."} Install a browser wallet such as MetaMask or Rabby, then reload this page.</Note>;
  }
  if (!isConnected) {
    return (
      <div className="gate">
        {why && <p className="muted">{why}</p>}
        <button className="btn" disabled={isPending} onClick={() => connect({ connector: connectors[0], chainId: chainIdOf(net) })}>
          <Wallet size={16} />{isPending ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    );
  }
  if (chainId !== net.chain.id) {
    return (
      <div className="gate">
        <p className="muted">Your wallet is on another network. Switch to {net.label} (your wallet will offer to add it if needed).</p>
        <button className="btn" disabled={switching} onClick={() => switchChain({ chainId: chainIdOf(net) })}>
          {switching ? "Switching…" : `Switch to ${net.label}`}
        </button>
        {error && <p className="field-error">{humanError(error)}</p>}
      </div>
    );
  }
  return <>{children}</>;
}
