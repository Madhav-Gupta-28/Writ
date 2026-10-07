import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useAction, useClient, useNetwork, useOrder, useParamId } from "../hooks";
import { humanError } from "../lib/errors";
import { formatDate, relative, short, usdc } from "../lib/format";
import { reclaimOpensAt, runway } from "../lib/order";
import { events, sendWrit } from "../lib/write";
import { Addr, Card, NetLink, Spinner, StateBadge, StatusLine, WalletGate } from "../ui";
import { TopUp } from "./TopUp";

export function PayerActions() {
  const net = useNetwork();
  const client = useClient(net);
  const { address } = useAccount();
  const id = useParamId(useParams().id);
  const q = useOrder(net, id);
  const action = useAction();
  const [sure, setSure] = useState(false);

  if (id === null) return <Card title="Not an order number"><p>Order numbers are whole numbers, like 2.</p></Card>;
  if (q.isLoading) return <Card><Spinner label={`Loading order #${id}…`} /></Card>;
  if (q.error) return <Card title="Couldn't load this order"><p>{humanError(q.error)}</p></Card>;
  const { order, now } = q.data!;
  if (order.state === "None") return <Card title={`No order #${id} on ${net.label}`}><p>Check the number or the network.</p></Card>;

  const isPayer = address?.toLowerCase() === order.payer.toLowerCase();
  const live = order.state === "Active" || order.state === "Quarantined";
  const pending = order.cancelReadyAt > 0n;
  const reclaimAt = reclaimOpensAt(order);
  const ctx = { order, now };

  const tx = (fn: string, done: (refund: bigint) => string, kind: "beginCancel" | "finalize" | "reclaim") =>
    action.run(async (step) => {
      const { hash, receipt } = await sendWrit(client, net, fn, [order.id], step);
      const ev = events(receipt).find((e) => e.eventName === "Cancelled" || e.eventName === "Reclaimed");
      q.refetch();
      return { message: done((ev?.args as { refunded?: bigint } | undefined)?.refunded ?? 0n), hash };
    }, { ...ctx, action: kind });

  return (
    <div className="stack">
      <div className="order-head">
        <h1>Payer actions, order #{order.id.toString()}</h1>
        <StateBadge state={order.state} />
        <NetLink to={`/order/${order.id}`} className="link">Back to order</NetLink>
      </div>

      <Card>
        <p>This order was opened by <Addr net={net} a={order.payer} />. Only that wallet can use the actions below (anyone can top up).</p>
        <WalletGate net={net} why="Connect the payer's wallet.">
          {isPayer ? <p className="ok-line">You're connected as the payer.</p>
                   : <p className="warn-box">You're connected as {short(address ?? "")}, not the payer. These actions will be rejected.</p>}
        </WalletGate>
      </Card>

      {live && (
        <Card title="Cancel with 30 days' notice">
          {!pending ? (
            <>
              <p>
                Your wallet can't stop payments or change the recipient on its own. That's the point: a stolen wallet key can't
                redirect your money. It can give <strong>30 days' notice</strong>. Payments keep running during the notice, and the
                key card holder can veto it. After 30 days you can finalize, and the remaining balance comes back to you.
              </p>
              <label className="radio"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> Start the 30-day notice for order #{order.id.toString()}</label>
              <WalletGate net={net}>
                <button className="btn" disabled={!sure || action.busy} onClick={() => tx("beginWalletCancel", () => "Notice started. You can finalize in 30 days unless the key card vetoes it.", "beginCancel")}>Start notice</button>
              </WalletGate>
            </>
          ) : now < order.cancelReadyAt ? (
            <p>Notice given. You can finalize {relative(order.cancelReadyAt, now)} ({formatDate(order.cancelReadyAt)}), unless the key card vetoes it first. Payments continue until then.</p>
          ) : (
            <>
              <p>The 30-day notice is over. Finalize to stop the order and get the balance, {usdc(order.balance)}, back.</p>
              <WalletGate net={net}>
                <button className="btn" disabled={action.busy} onClick={() => tx("finalizeWalletCancel", (r) => `Order cancelled. ${usdc(r)} returned to your wallet.`, "finalize")}>Finalize cancellation</button>
              </WalletGate>
            </>
          )}
        </Card>
      )}

      {(live || order.state === "Completed") && (
        <Card title="Reclaim leftovers">
          {now < reclaimAt ? (
            <p className="muted">
              After the end date plus 30 days ({formatDate(reclaimAt)}, {relative(reclaimAt, now)}), you can take back whatever is left
              in the order. Current balance: {usdc(order.balance)}.
            </p>
          ) : (
            <>
              <p>The order ended more than 30 days ago. {usdc(order.balance)} is left and can come back to you.</p>
              <WalletGate net={net}>
                <button className="btn" disabled={action.busy || order.balance === 0n} onClick={() => tx("reclaim", (r) => `Reclaimed ${usdc(r)}.`, "reclaim")}>Reclaim {usdc(order.balance)}</button>
              </WalletGate>
            </>
          )}
        </Card>
      )}

      <StatusLine status={action.status} net={net} />

      {live && (
        <Card title="Top up">
          <TopUp net={net} client={client} order={order} suggested={runway(order).shortfall} onDone={() => q.refetch()} />
        </Card>
      )}
    </div>
  );
}
