import { useState } from "react";
import { useParams } from "react-router-dom";
import { bytesToHex, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { Action, EMPTY_PAYLOAD, amendPayload, resolveQuarantinePayload, rotateKeyPayload } from "../../../shared/digest.ts";
import { MAX_PERIOD, MIN_PERIOD, type Network } from "../config";
import { useAction, useClient, useNetwork, useOrder, useParamId, type TxStatus } from "../hooks";
import { KeyCardCreator, KeyCardUnlock } from "../keycardUi";
import { humanError, type ErrorContext } from "../lib/errors";
import { formatDate, formatUsdc, INTERVALS, parseUsdc, relative, short, usdc } from "../lib/format";
import type { KeyCard } from "../lib/keycard";
import type { Order } from "../lib/order";
import { pqSign, txLink } from "../lib/tx";
import { sendWrit, type Step } from "../lib/write";
import { Card, Field, NetLink, Spinner, StateBadge, StatusLine, WalletGate } from "../ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (ts: bigint) => {
  const d = new Date(Number(ts) * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type PqRun = (opts: {
  action: Action; payload: Hex; fn: string; args: (deadline: bigint, sig: Hex) => readonly unknown[];
  done: string; ctx: ErrorContext["action"];
}) => Promise<boolean>;

type Done = (r: { message: string; hash: `0x${string}` }) => void;

/**
 * Sign with the key card, then send. The result is reported to the page via
 * `onDone` BEFORE refetching: a successful action can remove its own tab (e.g.
 * veto clears the pending cancel), and the message must outlive the tab.
 */
function usePq(net: Network, card: KeyCard | null, order: Order, refetch: () => void, onDone: Done) {
  const client = useClient(net);
  const act = useAction();
  const run: PqRun = (o) =>
    act.run(async (step: Step) => {
      if (!card) throw new Error("Unlock your key card first.");
      step("Signing with your key card (about 2 seconds)…");
      const sig = await pqSign(client, net, card, order.id, o.action, o.payload);
      const { hash } = await sendWrit(client, net, o.fn, o.args(sig.deadline, sig.signature), step);
      const r = { message: o.done, hash };
      onDone(r);
      refetch();
      return r;
    }, { order, action: o.ctx });
  // Success is shown once, at page level (see onDone); inline lines show progress and errors.
  const status: TxStatus = act.status.kind === "done" ? { kind: "idle" } : act.status;
  return { ...act, status, run };
}

function AmendForm({ net, order, card, refetch, onDone }: { net: Network; order: Order; card: KeyCard; refetch: () => void; onDone: Done }) {
  const [ben, setBen] = useState<string>(order.beneficiary);
  const [amount, setAmount] = useState(formatUsdc(order.amountPerPeriod, { min: 0 }));
  const [period, setPeriod] = useState(order.periodSeconds);
  const [end, setEnd] = useState(toDateInput(order.endTime));
  const [cap, setCap] = useState(formatUsdc(order.maxExecutorFee, { min: 0 }));
  const pq = usePq(net, card, order, refetch, onDone);

  const amt = parseUsdc(amount);
  const capV = parseUsdc(cap);
  const endTime = BigInt(Math.floor(new Date(`${end}T23:59:59`).getTime() / 1000));
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  const errors = {
    ben: !isAddress(ben) ? "That isn't a valid address." : ben.toLowerCase() === net.writ.toLowerCase() ? "That's the Writ contract itself." : null,
    amount: !amt ? "Enter an amount above zero." : null,
    cap: capV === null || capV === 0n || (amt !== null && capV >= amt) ? "Must be above zero and below the payment amount." : null,
    end: endTime < order.nextDueAt || endTime < nowS ? `Must be on or after the next payment (${formatDate(order.nextDueAt)}).` : null,
    period: period < MIN_PERIOD || period > MAX_PERIOD ? "Between 1 hour and 365 days." : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const periods = INTERVALS.some((i) => i.seconds === order.periodSeconds)
    ? INTERVALS : [...INTERVALS, { label: `Current (${order.periodSeconds}s)`, seconds: order.periodSeconds }];

  const submit = () => pq.run({
    action: Action.Amend,
    payload: amendPayload({ newBeneficiary: ben as Address, newAmount: amt!, newPeriodSeconds: period, newEndTime: endTime, newMaxExecutorFee: capV! }),
    fn: "amend",
    args: (dl, sig) => [order.id, ben as Address, amt!, period, endTime, capV!, dl, sig],
    done: `Order updated: now pays ${usdc(amt!)} to ${short(ben)}.`,
    ctx: "amend",
  });

  return (
    <fieldset disabled={pq.busy}>
      <Field label="Recipient" error={errors.ben}><input className="mono" value={ben} onChange={(e) => setBen(e.target.value.trim())} spellCheck={false} /></Field>
      <div className="row2">
        <Field label="Amount per payment (USDC)" error={errors.amount}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="How often" error={errors.period}>
          <select value={period.toString()} onChange={(e) => setPeriod(BigInt(e.target.value))}>
            {periods.map((i) => <option key={i.label} value={i.seconds.toString()}>{i.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="row2">
        <Field label="Last payment on or before" error={errors.end}><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Max executor reward (USDC)" error={errors.cap}><input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
      </div>
      <p className="field-hint">The next payment stays on {formatDate(order.nextDueAt)}; a new interval applies after it.</p>
      <WalletGate net={net} why="Any connected wallet can submit the key card's signature (it pays the network fee).">
        <button className="btn" disabled={!valid} onClick={submit}>Sign and update order</button>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </fieldset>
  );
}

function RotateKey({ net, order, card, refetch, onRotated, onDone }: { net: Network; order: Order; card: KeyCard; refetch: () => void; onRotated: (c: KeyCard) => void; onDone: Done }) {
  const [next, setNext] = useState<KeyCard | null>(null);
  const [rotated, setRotated] = useState(false);
  const pq = usePq(net, card, order, refetch, onDone);
  const submit = async () => {
    const ok = await pq.run({
      action: Action.RotateKey,
      payload: rotateKeyPayload(bytesToHex(next!.publicKey)),
      fn: "rotateKey",
      args: (dl, sig) => [order.id, bytesToHex(next!.publicKey), dl, sig],
      done: "Done. From now on only the new key card controls this order. The old one no longer works.",
      ctx: "rotate",
    });
    if (ok) {
      setRotated(true);
      onRotated(next!);
    }
  };
  if (rotated) {
    return <p className="ok-line">The new key card is now in charge and unlocked here. Keep its file and password safe; the old card no longer works.</p>;
  }
  return (
    <div>
      <p className="muted">Replace this key card with a new one, for example if you think the file or password leaked. The current card signs the handover.</p>
      <KeyCardCreator net={net} onReady={setNext} intro="Create and save the new key card first." />
      {next && (
        <WalletGate net={net}>
          <button className="btn" onClick={submit} disabled={pq.busy}>Sign handover to the new key card</button>
        </WalletGate>
      )}
      <StatusLine status={pq.status} net={net} />
    </div>
  );
}

function CancelOrder({ net, order, card, refetch, onDone }: { net: Network; order: Order; card: KeyCard; refetch: () => void; onDone: Done }) {
  const [sure, setSure] = useState(false);
  const pq = usePq(net, card, order, refetch, onDone);
  return (
    <div>
      <p className="muted">Stops all future payments and sends the whole balance, {usdc(order.balance)}, back to the payer ({short(order.payer)}). This can't be undone.</p>
      <label className="radio"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I want to cancel order #{order.id.toString()}</label>
      <WalletGate net={net}>
        <button className="btn btn-danger" disabled={!sure || pq.busy} onClick={() => pq.run({
          action: Action.Cancel, payload: EMPTY_PAYLOAD, fn: "cancelByPq",
          args: (dl, sig) => [order.id, dl, sig],
          done: `Order cancelled. ${usdc(order.balance)} went back to the payer.`, ctx: "cancel",
        })}>Sign and cancel order</button>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </div>
  );
}

function ResolveQuarantine({ net, order, card, refetch, onDone }: { net: Network; order: Order; card: KeyCard; refetch: () => void; onDone: Done }) {
  const [mode, setMode] = useState<"redirect" | "cancel">("redirect");
  const [to, setTo] = useState("");
  const pq = usePq(net, card, order, refetch, onDone);
  const target = mode === "cancel" ? zeroAddress : (to as Address);
  const valid = mode === "cancel" || (isAddress(to) && to.toLowerCase() !== order.beneficiary.toLowerCase());
  return (
    <div>
      <p className="muted">The current recipient ({short(order.beneficiary)}) is frozen. Choose what happens to this order.</p>
      <label className="radio"><input type="radio" checked={mode === "redirect"} onChange={() => setMode("redirect")} /> Pay a new recipient. The missed payment goes to them next.</label>
      {mode === "redirect" && (
        <Field label="New recipient" error={to && !valid ? "Enter a valid address different from the frozen one." : null}>
          <input className="mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} spellCheck={false} />
        </Field>
      )}
      <label className="radio"><input type="radio" checked={mode === "cancel"} onChange={() => setMode("cancel")} /> Cancel and refund {usdc(order.balance)} to the payer</label>
      <WalletGate net={net}>
        <button className="btn" disabled={!valid || pq.busy} onClick={() => pq.run({
          action: Action.ResolveQuarantine, payload: resolveQuarantinePayload(target), fn: "resolveQuarantine",
          args: (dl, sig) => [order.id, target, dl, sig],
          done: mode === "cancel" ? "Order cancelled and the payer refunded." : `Resumed: the order now pays ${short(to)}.`,
          ctx: "resolve",
        })}>Sign and resolve</button>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </div>
  );
}

function VetoCancel({ net, order, card, refetch, now, onDone }: { net: Network; order: Order; card: KeyCard; refetch: () => void; now: bigint; onDone: Done }) {
  const pq = usePq(net, card, order, refetch, onDone);
  return (
    <div>
      <p>The payer's wallet started a 30-day cancellation that becomes final {relative(order.cancelReadyAt, now)} ({formatDate(order.cancelReadyAt)}). If you didn't expect this, the payer's wallet may be compromised. Veto it to keep the order running.</p>
      <WalletGate net={net}>
        <button className="btn" disabled={pq.busy} onClick={() => pq.run({
          action: Action.VetoWalletCancel, payload: EMPTY_PAYLOAD, fn: "vetoWalletCancel",
          args: (dl, sig) => [order.id, dl, sig], done: "Cancellation vetoed. The order keeps running.", ctx: "veto",
        })}>Sign veto</button>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </div>
  );
}

export function Manage() {
  const net = useNetwork();
  const id = useParamId(useParams().id);
  const q = useOrder(net, id);
  const [card, setCard] = useState<KeyCard | null>(null);
  const [tab, setTab] = useState<string>("amend");
  const [last, setLast] = useState<{ message: string; hash: `0x${string}` } | null>(null);

  if (id === null) return <Card title="Not an order number"><p>Order numbers are whole numbers, like 2.</p></Card>;
  if (q.isLoading) return <Card><Spinner label={`Loading order #${id}…`} /></Card>;
  if (q.error) return <Card title="Couldn't load this order"><p>{humanError(q.error)}</p></Card>;
  const { order, now } = q.data!;
  if (order.state === "None") return <Card title={`No order #${id} on ${net.label}`}><p>Check the number or the network.</p></Card>;
  const refetch = () => q.refetch();
  const live = order.state === "Active" || order.state === "Quarantined";

  const tabs = [
    order.state === "Quarantined" && { key: "resolve", label: "Resolve pause" },
    live && order.cancelReadyAt > 0n && { key: "veto", label: "Veto cancellation" },
    order.state === "Active" && { key: "amend", label: "Change terms" },
    live && { key: "rotate", label: "Rotate key card" },
    live && { key: "cancel", label: "Cancel order" },
  ].filter(Boolean) as { key: string; label: string }[];
  const active = tabs.find((t) => t.key === tab)?.key ?? tabs[0]?.key;

  return (
    <div className="stack">
      <div className="order-head">
        <h1>Manage order #{order.id.toString()}</h1>
        <StateBadge state={order.state} />
        <NetLink to={`/order/${order.id}`} className="link">Back to order</NetLink>
      </div>

      {last && (
        <div className="status ok" role="status">
          {last.message}{" "}<a href={txLink(net, last.hash)} target="_blank" rel="noreferrer">View transaction ↗</a>
        </div>
      )}

      {!live ? (
        <Card><p>This order is {order.state.toLowerCase()}. There's nothing left for the key card to do.</p></Card>
      ) : !card ? (
        <Card title="Unlock your key card">
          <p className="muted">Your key card file and password stay in this browser. Signing happens here, and only the signature is sent.</p>
          <KeyCardUnlock expected={order.pqKey} onUnlock={setCard} />
        </Card>
      ) : (
        <Card>
          <div className="unlocked"><span className="check" aria-hidden="true">✓</span> Key card unlocked for order #{order.id.toString()}.
            <button className="link" onClick={() => setCard(null)}>Lock</button></div>
          <div className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={active === t.key} className={active === t.key ? "tab on" : "tab"} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="tab-body">
            {active === "amend" && <AmendForm net={net} order={order} card={card} refetch={refetch} onDone={setLast} />}
            {active === "rotate" && <RotateKey net={net} order={order} card={card} refetch={refetch} onRotated={setCard} onDone={setLast} />}
            {active === "cancel" && <CancelOrder net={net} order={order} card={card} refetch={refetch} onDone={setLast} />}
            {active === "resolve" && <ResolveQuarantine net={net} order={order} card={card} refetch={refetch} onDone={setLast} />}
            {active === "veto" && <VetoCancel net={net} order={order} card={card} refetch={refetch} now={now} onDone={setLast} />}
          </div>
        </Card>
      )}
    </div>
  );
}
