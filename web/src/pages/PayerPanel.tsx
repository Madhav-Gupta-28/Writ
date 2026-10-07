import { useState } from "react";
import { useAccount } from "wagmi";
import type { PublicClient } from "viem";
import { CalendarClock, Clock, Undo2, Wallet } from "lucide-react";
import type { Network } from "../config";
import { useAction } from "../hooks";
import { formatDate, relative, short, usdc } from "../lib/format";
import { reclaimOpensAt, type Order } from "../lib/order";
import { events, sendWrit } from "../lib/write";
import { Addr, Note, StatusLine, WalletGate } from "../ui";

/** What the wallet that funded the order can do: slow, public exits only. */
export function PayerPanel({ net, client, order, now, refetch }: { net: Network; client: PublicClient; order: Order; now: bigint; refetch: () => void }) {
  const { address } = useAccount();
  const action = useAction();
  const [sure, setSure] = useState(false);
  const isPayer = address?.toLowerCase() === order.payer.toLowerCase();
  const live = order.state === "Active" || order.state === "Quarantined";
  const pending = order.cancelReadyAt > 0n;
  const reclaimAt = reclaimOpensAt(order);

  const tx = (fn: string, done: (refund: bigint) => string, kind: "beginCancel" | "finalize" | "reclaim") =>
    action.run(async (step) => {
      const { hash, receipt } = await sendWrit(client, net, fn, [order.id], step);
      const ev = events(receipt).find((e) => e.eventName === "Cancelled" || e.eventName === "Reclaimed");
      refetch();
      return { message: done((ev?.args as { refunded?: bigint } | undefined)?.refunded ?? 0n), hash };
    }, { order, now, action: kind });

  return (
    <div className="card stack">
      <div className="panel-grid">
        <div className="stack">
          <h3 className="row"><Wallet size={18} /> The funding wallet</h3>
          <p className="text-2 readable">
            This order was funded by <Addr net={net} a={order.payer} />. That wallet can never change who gets paid or stop payments
            on the spot. That's the point: a stolen wallet can't redirect the money. Its only exits are slow and public.
          </p>
        </div>
        <WalletGate net={net} why="Connect the wallet that funded this order.">
          {isPayer ? <Note kind="ok" icon={Wallet}>You're connected as the funding wallet.</Note>
                   : <Note kind="warn" icon={Wallet}>You're connected as {short(address ?? "")}, not the funding wallet. These actions will be refused.</Note>}
        </WalletGate>
      </div>

      {live && (
        <div className="panel-grid">
          <div className="stack">
            <h3 className="row"><CalendarClock size={18} /> Cancel with 30 days' notice</h3>
            <p className="text-2 readable">Payments keep going during the notice, and the key card can block it. After 30 days you can finish the cancellation and the balance comes back to you.</p>
          </div>
          <div className="stack">
            {!pending ? (
              <>
                <label className="check-row"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> Start the 30-day notice for order #{order.id.toString()}</label>
                <WalletGate net={net}><div><button className="btn" disabled={!sure || action.busy} onClick={() => tx("beginWalletCancel", () => "Notice started. You can finish cancelling in 30 days unless the key card blocks it.", "beginCancel")}>Start notice</button></div></WalletGate>
              </>
            ) : now < order.cancelReadyAt ? (
              <Note icon={Clock}>Notice given. You can finish cancelling {relative(order.cancelReadyAt, now)} ({formatDate(order.cancelReadyAt)}), unless the key card blocks it first.</Note>
            ) : (
              <>
                <p>The notice period is over. Finish cancelling to stop the order and get {usdc(order.balance)} back.</p>
                <WalletGate net={net}><div><button className="btn btn-primary" disabled={action.busy} onClick={() => tx("finalizeWalletCancel", (r) => `Order cancelled. ${usdc(r)} returned to your wallet.`, "finalize")}>Finish cancelling</button></div></WalletGate>
              </>
            )}
          </div>
        </div>
      )}

      {(live || order.state === "Completed") && (
        <div className="panel-grid">
          <div className="stack">
            <h3 className="row"><Undo2 size={18} /> Take back leftovers</h3>
            <p className="text-2 readable">Whatever is left after the order ends can come back to you, starting 30 days after the end date.</p>
          </div>
          <div className="stack">
            {now < reclaimAt ? (
              <Note icon={Clock}>Available {relative(reclaimAt, now)} ({formatDate(reclaimAt)}). Current balance: {usdc(order.balance)}.</Note>
            ) : (
              <WalletGate net={net}><div><button className="btn btn-primary" disabled={action.busy || order.balance === 0n} onClick={() => tx("reclaim", (r) => `Took back ${usdc(r)}.`, "reclaim")}>Take back {usdc(order.balance)}</button></div></WalletGate>
            )}
          </div>
        </div>
      )}
      <StatusLine status={action.status} net={net} />
    </div>
  );
}
