import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import {
  ChevronDown, CircleCheck, CirclePlus, Clock, FileText, HandCoins, KeyRound, ShieldAlert, ShieldX, Snowflake, Wallet, XCircle,
} from "lucide-react";
import type { Network } from "../config";
import { useAction, useClient, useNetwork, useOrder, useParamId } from "../hooks";
import { humanError } from "../lib/errors";
import { duration, formatDate, formatDay, formatUsdc, intervalLabel, relative, short, usdc } from "../lib/format";
import { simulateHijack, type Attempt } from "../lib/hijack";
import { costPerPayment, estimateReward, isFunded, paymentsLeft, reclaimOpensAt, runway, type Order } from "../lib/order";
import { events, sendWrit } from "../lib/write";
import { Addr, Note, Skel, StateBadge, StatusLine, Tabs, WalletGate } from "../ui";
import { KeyCardPanel } from "./KeyCardPanel";
import { PayerPanel } from "./PayerPanel";
import { countdown, useLiveNow } from "../lib/clock";
import { TopUp } from "./TopUp";

type Tab = "funds" | "keycard" | "payer" | "details";

function OrderHero({ net, order, now }: { net: Network; order: Order; now: bigint }) {
  const rw = runway(order);
  const live = order.state === "Active" || order.state === "Quarantined";
  const total = order.periodsPaid + Number(live ? paymentsLeft(order) : 0n);
  const pct = total > 0 ? Math.round((order.periodsPaid / total) * 100) : 100;
  return (
    <>
      <p className="order-sum">
        Pays <strong>{usdc(order.amountPerPeriod)}</strong> to <Addr net={net} a={order.beneficiary} />{" "}
        {intervalLabel(order.periodSeconds)}
      </p>

      {/* Rialto's request shape: label on the left, value on the right, a
          hairline between. What was here before was a banner, a progress bar,
          three metric tiles and a four-line paragraph — the same facts, spread
          over four visual languages. */}
      <div className="slabs">
        <section className="slab">
          <div className="slab-head"><span>Terms</span></div>
          <dl className="rows">
            <div><dt>Pays</dt><dd className="mono">{usdc(order.amountPerPeriod)}</dd></div>
            <div><dt>Every</dt><dd className="mono">{duration(order.periodSeconds)}</dd></div>
            <div><dt>To</dt><dd className="mono"><Addr net={net} a={order.beneficiary} /></dd></div>
            <div><dt>Ends</dt><dd className="mono">{formatDay(order.endTime)}</dd></div>
          </dl>
        </section>

        <section className="slab">
          <div className="slab-head">
            <span>Progress</span>
            <span className="num">{order.periodsPaid} of {total}</span>
          </div>
          <div className="slab-bar">
            <div className="progress" role="progressbar" aria-valuenow={order.periodsPaid} aria-valuemin={0} aria-valuemax={total}>
              <span style={{ width: `${Math.max(pct, order.periodsPaid > 0 ? 3 : 0)}%` }} />
            </div>
          </div>
          <dl className="rows">
            <div><dt>Balance</dt><dd className="mono">{formatUsdc(order.balance)} USDC</dd></div>
            <div>
              <dt>Covers</dt>
              <dd className={!live ? "mono" : rw.fullyFunded ? "mono" : "mono warnv"}>
                {!live ? "nothing further"
                  : rw.needed === 0n ? "no payments left"
                  : rw.fullyFunded ? "every remaining payment"
                  : rw.funded === 0n ? "not the next one"
                  : `${rw.funded} more, to ${formatDay(rw.lastFundedAt!)}`}
              </dd>
            </div>
            <div><dt>Left to pay</dt><dd className="mono">{live ? rw.needed.toString() : "0"}</dd></div>
          </dl>
        </section>
      </div>

      {live && !rw.fullyFunded && rw.needed > 0n && (
        <Note icon={ShieldAlert} kind="warn">{usdc(rw.shortfall)} more covers every remaining payment. Anyone can add it.</Note>
      )}
      {order.state === "Quarantined" && (
        <Note icon={Snowflake} kind="ice">Circle froze the recipient, so this order paused itself rather than failing. Nothing is lost — the key card can pick a new recipient or refund.</Note>
      )}
      {live && order.cancelReadyAt > 0n && (
        <Note icon={Clock} kind="warn">The funding wallet asked to cancel. Payments continue until it is final {relative(order.cancelReadyAt, now)}, and the key card can block it.</Note>
      )}
      {/* Writ does not settle unpaid periods before a reclaim: 30 days after
          the end date the funding wallet can take back whatever is left,
          including money for payments that came due and were never collected.
          Anyone can press Pay, so it is avoidable — but only if someone knows,
          so it is stated here rather than left in the spec. */}
      {live && order.periodsPaid < total && (
        <Note icon={Clock} kind="warn">
          Collect before {formatDay(reclaimOpensAt(order))} — after that the funding wallet
          can reclaim anything nobody collected.
        </Note>
      )}
    </>
  );
}

function PayCard({ net, order, now, gasPrice, refetch }: { net: Network; order: Order; now: bigint; gasPrice: bigint; refetch: () => void }) {
  const client = useClient(net);
  const action = useAction();
  const due = order.state === "Active" && now >= order.nextDueAt;
  // One source of truth with the contract: execute() reserves the executor fee
  // alongside the payment (§6.3), so an order holding between amount and
  // amount+fee is NOT payable.
  const needed = costPerPayment(order);
  const underfunded = !isFunded(order);
  const reward = estimateReward(order, gasPrice);

  const pay = () =>
    action.run(async (step) => {
      const { hash, receipt } = await sendWrit(client, net, "execute", [order.id], step);
      const ev = events(receipt);
      const paid = ev.find((e) => e.eventName === "Paid")?.args as { amount: bigint } | undefined;
      const fee = (ev.find((e) => e.eventName === "ExecutorPaid")?.args as { fee: bigint } | undefined)?.fee ?? 0n;
      refetch();
      if (ev.some((e) => e.eventName === "Quarantined")) {
        return { message: `The recipient is frozen, so the order paused itself instead of failing. You earned a ${usdc(fee)} tip.`, hash };
      }
      return { message: `Paid ${usdc(paid?.amount ?? order.amountPerPeriod)} to ${short(order.beneficiary)}. You earned a ${usdc(fee)} tip.`, hash };
    }, { order, now, action: "execute" });

  return (
    <section className="card pay-card">
      <div className="eyebrow">Next payment</div>
      {order.state === "Active" ? (
        <>
          <div className={`countdown ${due ? "due" : ""}`} aria-live="off">{due ? "Due now" : countdown(order.nextDueAt - now)}</div>
          <div className="countdown-sub">{due ? `Was due ${formatDate(order.nextDueAt)}` : formatDate(order.nextDueAt)}</div>
          {due && underfunded ? (
            <Note icon={Wallet} kind="warn">It needs {usdc(needed)} ({usdc(order.amountPerPeriod)} plus up to {usdc(order.maxExecutorFee)} for whoever presses Pay) and holds {usdc(order.balance)}. Add money below and anyone can pay it.</Note>
          ) : !due ? (
            <button className="btn btn-primary btn-xl" disabled><HandCoins size={20} />Pay now</button>
          ) : (
            <WalletGate net={net} why="Connect any wallet to send this payment and earn the tip.">
              <button className="btn btn-primary btn-xl" onClick={pay} disabled={action.busy}><HandCoins size={20} />Pay now</button>
            </WalletGate>
          )}
          <div className="reward"><HandCoins size={16} className="icon" /><span>{due ? "Anyone can press it." : "When the timer ends, anyone can press it."} You'd earn a <strong>{usdc(reward.fee)}</strong> tip (network fee ≈ {usdc(reward.gasCost)}).</span></div>
          <StatusLine status={action.status} net={net} />
        </>
      ) : (
        <>
          <div className="countdown" style={{ fontSize: "1.8rem" }}>
            {order.state === "Quarantined" ? "Frozen" : order.state === "Completed" ? "All paid" : "Cancelled"}
          </div>
          <p className="text-2">
            {order.state === "Quarantined" ? "Payments are on hold until the key card picks a new recipient or cancels."
              : order.state === "Completed" ? "Every payment has been made." : "This order won't pay again."}
          </p>
          <StatusLine status={action.status} net={net} />
        </>
      )}
    </section>
  );
}

function HijackCard({ net, order, now }: { net: Network; order: Order; now: bigint }) {
  const client = useClient(net);
  const { address } = useAccount();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ who: Address; asPayer: boolean; attempts: Attempt[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const who = (address ?? order.payer) as Address;

  const run = async () => {
    setBusy(true); setErr(null); setRes(null);
    try {
      const attempts = await simulateHijack(client, net, order, who, now);
      setRes({ who, asPayer: who.toLowerCase() === order.payer.toLowerCase(), attempts });
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  };
  const allBlocked = res?.attempts.every((a) => a.blocked);

  return (
    <section className="card hijack-card">
      <h3><ShieldX size={18} style={{ color: "var(--danger)" }} /> Try to hijack this order</h3>
      <p className="text-2" style={{ fontSize: "0.93rem" }}>
        Play the thief with {address ? <strong>your wallet</strong> : <strong>the wallet that funded it</strong>}.
        It's a free simulation: nothing is signed or sent.
      </p>
      <button className="btn btn-danger btn-block" onClick={run} disabled={busy}>
        {busy ? <><span className="spinner" /> Trying…</> : <><ShieldX size={18} /> Try to hijack</>}
      </button>
      {err && <div className="status error"><XCircle size={18} />{err}</div>}
      {res && (allBlocked ? (
        <div className="result-blocked" role="status">
          <div className="big"><ShieldX size={24} /> BLOCKED</div>
          <div className="blocked-sub">{res.attempts.length} of {res.attempts.length} attempts refused by the contract, as {res.asPayer ? "the funding wallet" : "your wallet"} <span className="mono">{short(res.who)}</span>.</div>
          <ul className="attempts">
            {res.attempts.map((a) => (
              <li key={a.label}><XCircle size={16} className="icon" /><span><strong>{a.label}</strong><span className="why">{a.reason}</span></span></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="result-open">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {res.attempts.map((a) => <li key={a.label}><strong>{a.label}:</strong> {a.blocked ? `blocked: ${a.reason}` : a.reason}</li>)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Details({ net, order }: { net: Network; order: Order }) {
  return (
    <div className="card stack">
      <dl className="kv">
        <dt>Recipient</dt><dd><Addr net={net} a={order.beneficiary} full /></dd>
        <dt>Funded by</dt><dd><Addr net={net} a={order.payer} full /></dd>
        <dt>Amount</dt><dd>{usdc(order.amountPerPeriod)} {intervalLabel(order.periodSeconds)}</dd>
        <dt>Ends</dt><dd>{formatDate(order.endTime)}</dd>
        <dt>Max tip per payment</dt><dd>{usdc(order.maxExecutorFee)}</dd>
        <dt>Contract</dt><dd><Addr net={net} a={net.writ} full /></dd>
      </dl>
      <details className="more">
        <summary>Technical details <ChevronDown size={16} /></summary>
        <div className="more-body">
          <dl className="kv">
            <dt>Key card public key</dt><dd className="mono">{order.pqKey}</dd>
            <dt>Key card actions used (nonce)</dt><dd>{order.pqNonce.toString()}</dd>
            <dt>Reference hash</dt><dd className="mono">{order.ref}</dd>
            <dt>Signature scheme</dt><dd>SLH-DSA-SHA2-128s (FIPS 205), checked by Arc's precompile at <span className="mono">0x1800…0004</span></dd>
            <dt>Next payment (unix)</dt><dd className="mono">{order.nextDueAt.toString()}</dd>
          </dl>
        </div>
      </details>
    </div>
  );
}

function SkeletonOrder() {
  return (
    <div aria-busy="true" aria-label="Loading order">
      <div className="order-head"><Skel w={180} h={32} /><Skel w={80} h={24} /></div>
      <div className="order-layout">
        <div className="stack">
          <section className="card order-hero stack">
            <Skel w="80%" h={30} />
            <Skel h={10} style={{ marginTop: 18 }} />
            <div className="metrics" style={{ marginTop: 10 }}>{[0, 1, 2].map((i) => <div key={i} className="metric"><Skel w="50%" h={12} /><Skel w="70%" h={28} style={{ marginTop: 10 }} /></div>)}</div>
          </section>
          <Skel h={48} />
        </div>
        <div className="side-col">
          <section className="card pay-card"><Skel w="40%" h={12} /><Skel w="80%" h={40} /><Skel h={56} /></section>
          <section className="card hijack-card"><Skel w="70%" h={18} /><Skel h={44} /></section>
        </div>
      </div>
    </div>
  );
}

export function OrderView({ initialTab }: { initialTab?: Tab }) {
  const net = useNetwork();
  const client = useClient(net);
  const id = useParamId(useParams().id);
  const q = useOrder(net, id);
  const now = useLiveNow(q.data?.now, q.dataUpdatedAt);
  const [tab, setTab] = useState<Tab>(initialTab ?? "funds");
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);

  if (id === null) return <div className="card"><h2>That isn't an order number</h2><p className="text-2" style={{ marginTop: 8 }}>Order numbers are whole numbers, like 2.</p></div>;
  if (q.isLoading || !q.data || now === undefined) {
    if (q.error) return <div className="card stack"><h2>Couldn't load this order</h2><p className="text-2">{humanError(q.error)}</p><div><button className="btn" onClick={() => q.refetch()}>Try again</button></div></div>;
    return <SkeletonOrder />;
  }
  const { order, gasPrice } = q.data;
  if (order.state === "None") {
    return <div className="card"><h2>No order #{id.toString()}</h2><p className="text-2" style={{ marginTop: 8 }}>Check the number.</p></div>;
  }
  const refetch = () => q.refetch();

  const tabs: { key: Tab; label: string; icon: typeof CirclePlus }[] = [
    { key: "funds", label: "Add money", icon: CirclePlus },
    { key: "keycard", label: "Key card", icon: KeyRound },
    { key: "payer", label: "Funding wallet", icon: Wallet },
    { key: "details", label: "Details", icon: FileText },
  ];

  return (
    <div>
      <div className="order-head">
        <h1>Order #{order.id.toString()}</h1>
        <StateBadge state={order.state} />
        
      </div>
      <div className="order-layout">
        <div className="area-hero"><OrderHero net={net} order={order} now={now} /></div>
          <div className="area-tabs">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
            <div className="tab-panel" role="tabpanel">
              {tab === "funds" && (
                <div className="card panel-grid">
                  <div className="stack">
                    <h3 className="row"><CirclePlus size={18} /> Add money</h3>
                    <p className="text-2 readable">Anyone can top up. The money can only reach the recipient, whoever presses Pay, or the wallet that funded it.</p>
                  </div>
                  <TopUp net={net} client={client} order={order} suggested={runway(order).shortfall} onDone={refetch} />
                </div>
              )}
              {tab === "keycard" && (
                <KeyCardPanel net={net} order={order} now={now} refetch={refetch} />
              )}
              {tab === "payer" && <PayerPanel net={net} client={client} order={order} now={now} refetch={refetch} />}
              {tab === "details" && <Details net={net} order={order} />}
            </div>
          </div>
        <aside className="side-col area-side">
          <PayCard net={net} order={order} now={now} gasPrice={gasPrice} refetch={refetch} />
          <HijackCard net={net} order={order} now={now} />
          {order.state === "Active" && <p className="muted row" style={{ fontSize: "0.85rem", gap: 6 }}><CircleCheck size={14} /> Live from the chain, refreshed every 10 seconds.</p>}
        </aside>
      </div>
    </div>
  );
}
