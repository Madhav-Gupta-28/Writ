import { useState } from "react";
import { bytesToHex, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { CircleCheck, Lock, ShieldAlert, Snowflake } from "lucide-react";
import { Action, EMPTY_PAYLOAD, amendPayload, resolveQuarantinePayload, rotateKeyPayload } from "../../../shared/digest.ts";
import { MAX_PERIOD, MIN_PERIOD, type Network } from "../config";
import { useAction, useClient, type TxStatus } from "../hooks";
import { KeyCardCreator, KeyCardUnlock } from "../keycardUi";
import type { ErrorContext } from "../lib/errors";
import { formatDate, formatUsdc, INTERVALS, parseUsdc, relative, short, usdc } from "../lib/format";
import type { KeyCard } from "../lib/keycard";
import type { Order } from "../lib/order";
import { pqSign } from "../lib/tx";
import { sendWrit, type Step } from "../lib/write";
import { Field, KeyCardHint, Note, StatusLine, WalletGate } from "../ui";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (ts: bigint) => {
  const d = new Date(Number(ts) * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

type Done = (r: { message: string; hash: `0x${string}` }) => void;
type PqRun = (opts: {
  action: Action; payload: Hex; fn: string; args: (deadline: bigint, sig: Hex) => readonly unknown[];
  done: string; ctx: ErrorContext["action"];
}) => Promise<boolean>;

/**
 * Sign with the key card (in a worker), then send. Success is reported to the
 * panel via `onDone` BEFORE refetching: an action can remove its own sub-tab
 * (a veto clears the pending cancel), and the message must outlive it.
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
  const status: TxStatus = act.status.kind === "done" ? { kind: "idle" } : act.status;
  return { ...act, status, run };
}

interface P { net: Network; order: Order; card: KeyCard; refetch: () => void; onDone: Done }

function AmendForm({ net, order, card, refetch, onDone }: P) {
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
      <div className="cols-2">
        <Field label="Amount per payment (USDC)" error={errors.amount}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="How often" error={errors.period}>
          <select value={period.toString()} onChange={(e) => setPeriod(BigInt(e.target.value))}>
            {periods.map((i) => <option key={i.label} value={i.seconds.toString()}>{i.label}</option>)}
          </select>
        </Field>
        <Field label="Last payment on or before" error={errors.end}><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Max tip per payment (USDC)" error={errors.cap} hint="Whoever presses Pay gets their fee back plus a tip, up to this.">
          <input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
      </div>
      <p className="field-hint">The next payment stays on {formatDate(order.nextDueAt)}; a new interval starts after it.</p>
      <WalletGate net={net} why="Any wallet can send the key card's signature; it just pays the small network fee.">
        <div><button className="btn btn-primary" disabled={!valid} onClick={submit}>Sign and update order</button></div>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </fieldset>
  );
}

function RotateKey({ net, order, card, refetch, onRotated, onDone }: P & { onRotated: (c: KeyCard) => void }) {
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
  if (rotated) return <p className="done-line"><CircleCheck size={18} />The new key card is in charge and unlocked here. The old one no longer works.</p>;
  return (
    <div className="panel-grid">
      <p className="text-2 readable">Swap this key card for a new one, for example if you think the file or its password leaked. Your current card signs the handover, so nobody else can do this.</p>
      <div className="stack">
        <KeyCardCreator net={net} onReady={setNext} />
        {next && (
          <WalletGate net={net}>
            <div><button className="btn btn-primary" onClick={submit} disabled={pq.busy}>Sign handover to the new key card</button></div>
          </WalletGate>
        )}
        <StatusLine status={pq.status} net={net} />
      </div>
    </div>
  );
}

function CancelOrder({ net, order, card, refetch, onDone }: P) {
  const [sure, setSure] = useState(false);
  const pq = usePq(net, card, order, refetch, onDone);
  return (
    <div className="panel-grid">
      <p className="text-2 readable">Stops all future payments and sends the whole balance, <strong>{usdc(order.balance)}</strong>, back to the wallet that funded it ({short(order.payer)}). This can't be undone.</p>
      <div className="stack">
        <label className="check-row"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I want to cancel order #{order.id.toString()}</label>
        <WalletGate net={net}>
          <div><button className="btn btn-danger" disabled={!sure || pq.busy} onClick={() => pq.run({
            action: Action.Cancel, payload: EMPTY_PAYLOAD, fn: "cancelByPq",
            args: (dl, sig) => [order.id, dl, sig],
            done: `Order cancelled. ${usdc(order.balance)} went back to the payer.`, ctx: "cancel",
          })}>Sign and cancel order</button></div>
        </WalletGate>
        <StatusLine status={pq.status} net={net} />
      </div>
    </div>
  );
}

function Unfreeze({ net, order, card, refetch, onDone }: P) {
  const [mode, setMode] = useState<"redirect" | "cancel">("redirect");
  const [to, setTo] = useState("");
  const pq = usePq(net, card, order, refetch, onDone);
  const target = mode === "cancel" ? zeroAddress : (to as Address);
  const valid = mode === "cancel" || (isAddress(to) && to.toLowerCase() !== order.beneficiary.toLowerCase());
  return (
    <div className="stack">
      <Note icon={Snowflake} kind="ice">The recipient ({short(order.beneficiary)}) has been frozen by Circle, the issuer of USDC, so payments to them would fail. Choose what happens next.</Note>
      <label className="choice"><input type="radio" checked={mode === "redirect"} onChange={() => setMode("redirect")} /><span>Pay someone else instead. The missed payment goes to them first.</span></label>
      {mode === "redirect" && (
        <Field label="New recipient" error={to && !valid ? "Enter a valid address different from the frozen one." : null}>
          <input className="mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} spellCheck={false} />
        </Field>
      )}
      <label className="choice"><input type="radio" checked={mode === "cancel"} onChange={() => setMode("cancel")} /><span>Cancel and refund {usdc(order.balance)} to the payer</span></label>
      <WalletGate net={net}>
        <div><button className="btn btn-primary" disabled={!valid || pq.busy} onClick={() => pq.run({
          action: Action.ResolveQuarantine, payload: resolveQuarantinePayload(target), fn: "resolveQuarantine",
          args: (dl, sig) => [order.id, target, dl, sig],
          done: mode === "cancel" ? "Order cancelled and the payer refunded." : `Unfrozen: the order now pays ${short(to)}.`,
          ctx: "resolve",
        })}>Sign and continue</button></div>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </div>
  );
}

function BlockCancel({ net, order, card, refetch, onDone, now }: P & { now: bigint }) {
  const pq = usePq(net, card, order, refetch, onDone);
  return (
    <div className="stack">
      <Note icon={ShieldAlert} kind="warn">
        The wallet that funded this order asked to cancel it. That becomes final {relative(order.cancelReadyAt, now)} ({formatDate(order.cancelReadyAt)}).
        If that wasn't you, someone may have that wallet. Block it to keep the payments going.
      </Note>
      <WalletGate net={net}>
        <div><button className="btn btn-primary" disabled={pq.busy} onClick={() => pq.run({
          action: Action.VetoWalletCancel, payload: EMPTY_PAYLOAD, fn: "vetoWalletCancel",
          args: (dl, sig) => [order.id, dl, sig], done: "Cancellation blocked. The order keeps paying.", ctx: "veto",
        })}>Sign and block cancellation</button></div>
      </WalletGate>
      <StatusLine status={pq.status} net={net} />
    </div>
  );
}

type Sub = "resolve" | "veto" | "amend" | "rotate" | "cancel";

export function KeyCardPanel({ net, order, now, refetch }: { net: Network; order: Order; now: bigint; refetch: () => void }) {
  const [card, setCard] = useState<KeyCard | null>(null);
  const [sub, setSub] = useState<Sub>("amend");
  const [last, setLast] = useState<{ message: string; hash: `0x${string}` } | null>(null);
  const live = order.state === "Active" || order.state === "Quarantined";

  const subs = ([
    order.state === "Quarantined" && { key: "resolve", label: "Unfreeze" },
    live && order.cancelReadyAt > 0n && { key: "veto", label: "Block cancellation" },
    order.state === "Active" && { key: "amend", label: "Change recipient or amount" },
    live && { key: "rotate", label: "Replace key card" },
    live && { key: "cancel", label: "Cancel order" },
  ].filter(Boolean)) as { key: Sub; label: string }[];
  const active = subs.find((s) => s.key === sub)?.key ?? subs[0]?.key;

  return (
    <div className="card stack">
      {last && <StatusLine status={{ kind: "done", ...last }} net={net} />}
      {!live ? (
        <p className="text-2">This order is {order.state === "Completed" ? "finished" : "cancelled"}, so there's nothing left for the key card to do.</p>
      ) : !card ? (
        <div className="panel-grid">
          <div className="stack">
            <h3 className="row"><Lock size={18} /> Unlock your key card</h3>
            <KeyCardHint />
            <p className="text-2 readable">Unlock it to change who gets paid, block a cancellation, replace the card or cancel the order. The file and password stay in this browser. Only a signature is sent.</p>
          </div>
          <KeyCardUnlock expected={order.pqKey} onUnlock={setCard} />
        </div>
      ) : (
        <>
          <div className="row between">
            <span className="done-line"><CircleCheck size={18} />Key card unlocked for order #{order.id.toString()}</span>
            <button className="link" onClick={() => setCard(null)}>Lock</button>
          </div>
          <div className="subtabs" role="tablist">
            {subs.map((s) => (
              <button key={s.key} role="tab" aria-selected={active === s.key} className={active === s.key ? "subtab on" : "subtab"} onClick={() => setSub(s.key)}>{s.label}</button>
            ))}
          </div>
          {active === "amend" && <AmendForm net={net} order={order} card={card} refetch={refetch} onDone={setLast} />}
          {active === "rotate" && <RotateKey net={net} order={order} card={card} refetch={refetch} onRotated={setCard} onDone={setLast} />}
          {active === "cancel" && <CancelOrder net={net} order={order} card={card} refetch={refetch} onDone={setLast} />}
          {active === "resolve" && <Unfreeze net={net} order={order} card={card} refetch={refetch} onDone={setLast} />}
          {active === "veto" && <BlockCancel net={net} order={order} card={card} refetch={refetch} onDone={setLast} now={now} />}
        </>
      )}
    </div>
  );
}
