import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useAction, useClient, useNetwork, useOrder, useParamId } from "../hooks";
import { humanError } from "../lib/errors";
import { formatDate, formatDay, intervalLabel, relative, short, usdc } from "../lib/format";
import { estimateReward, runway, type Order } from "../lib/order";
import { events, sendWrit } from "../lib/write";
import { Addr, Card, NetLink, Spinner, StateBadge, StatusLine, WalletGate } from "../ui";
import { TopUp } from "./TopUp";

function ExecutePanel({ order, now, gasPrice, refetch }: { order: Order; now: bigint; gasPrice: bigint; refetch: () => void }) {
  const net = useNetwork();
  const client = useClient(net);
  const action = useAction();
  const due = order.state === "Active" && now >= order.nextDueAt;
  const reward = estimateReward(order, gasPrice);
  const underfunded = order.balance < order.amountPerPeriod;

  const execute = () =>
    action.run(async (step) => {
      const { hash, receipt } = await sendWrit(client, net, "execute", [order.id], step);
      const ev = events(receipt);
      const paid = ev.find((e) => e.eventName === "Paid")?.args as { amount: bigint; periodIndex: number } | undefined;
      const fee = (ev.find((e) => e.eventName === "ExecutorPaid")?.args as { fee: bigint } | undefined)?.fee ?? 0n;
      const quarantined = ev.some((e) => e.eventName === "Quarantined");
      refetch();
      if (quarantined) {
        return { message: `The recipient's USDC is frozen, so instead of failing the order paused itself. You earned ${usdc(fee)} for recording that.`, hash };
      }
      return { message: `Paid ${usdc(paid?.amount ?? order.amountPerPeriod)} to ${short(order.beneficiary)} (payment #${paid?.periodIndex ?? "?"}). You earned ${usdc(fee)}.`, hash };
    }, { order, now, action: "execute" });

  if (order.state !== "Active") return null;

  return (
    <Card className={due ? "execute due" : "execute"}>
      {due && underfunded ? (
        <>
          <h2>A payment is due, but the order is out of funds</h2>
          <p>It needs {usdc(order.amountPerPeriod)} for the next payment and holds {usdc(order.balance)}. Anyone can top it up below. Nothing is lost while it waits.</p>
        </>
      ) : due ? (
        <>
          <h2>A payment is due now</h2>
          <p>
            Anyone can send it. Press the button and the order pays {usdc(order.amountPerPeriod)} to {short(order.beneficiary)}.
            You'll be reimbursed about <strong>{usdc(reward.fee)}</strong> (your network fee is about {usdc(reward.gasCost)}).
          </p>
          <WalletGate net={net} why="Connect any wallet to execute this payment and earn the reward.">
            <button className="btn btn-xl" onClick={execute} disabled={action.busy}>Execute payment</button>
          </WalletGate>
          <StatusLine status={action.status} net={net} />
        </>
      ) : (
        <>
          <h2>Next payment {relative(order.nextDueAt, now)}</h2>
          <p className="muted">
            Due {formatDate(order.nextDueAt)}. When it's due, anyone can trigger it here and earn about {usdc(reward.fee)}.
          </p>
          {action.status.kind !== "idle" && <StatusLine status={action.status} net={net} />}
        </>
      )}
    </Card>
  );
}

export function OrderView() {
  const net = useNetwork();
  const client = useClient(net);
  const { address } = useAccount();
  const id = useParamId(useParams().id);
  const q = useOrder(net, id);

  if (id === null) return <Card title="Not an order number"><p>Order numbers are whole numbers, like 2.</p></Card>;
  if (q.isLoading) return <Card><Spinner label={`Loading order #${id} from ${net.label}…`} /></Card>;
  if (q.error) return <Card title="Couldn't load this order"><p>{humanError(q.error)}</p><button className="btn" onClick={() => q.refetch()}>Try again</button></Card>;
  const { order, now, gasPrice } = q.data!;
  if (order.state === "None") {
    return (
      <Card title={`No order #${id} on ${net.label}`}>
        <p>Check the number, or switch network at the top of the page.</p>
      </Card>
    );
  }

  const rw = runway(order);
  const isPayer = address?.toLowerCase() === order.payer.toLowerCase();
  const live = order.state === "Active" || order.state === "Quarantined";

  return (
    <div className="stack">
      <div className="order-head">
        <h1>Order #{order.id.toString()}</h1>
        <StateBadge state={order.state} />
        <span className="net-tag">{net.label}</span>
      </div>

      <Card>
        <p className="order-sentence">
          Pays <strong>{usdc(order.amountPerPeriod)}</strong> {intervalLabel(order.periodSeconds)} to{" "}
          <Addr net={net} a={order.beneficiary} />, until {formatDay(order.endTime)}.
        </p>
        <dl className="stats">
          <div><dt>Balance</dt><dd>{usdc(order.balance)}</dd></div>
          <div><dt>Payments made</dt><dd>{order.periodsPaid}</dd></div>
          <div>
            <dt>Next payment</dt>
            <dd>{order.state === "Active" ? <>{formatDate(order.nextDueAt)}<small>{relative(order.nextDueAt, now)}</small></> : "None scheduled"}</dd>
          </div>
          <div>
            <dt>Balance lasts</dt>
            <dd>
              {!live ? "No more payments"
                : rw.needed === 0n ? "No payments left"
                : rw.fullyFunded ? <>Every remaining payment<small>{rw.needed.toString()} to go</small></>
                : rw.funded === 0n ? <span className="warn">Not enough for the next payment</span>
                : <span className={rw.funded < 3n ? "warn" : ""}>{rw.funded.toString()} more payment{rw.funded === 1n ? "" : "s"}<small>until {formatDay(rw.lastFundedAt!)}</small></span>}
            </dd>
          </div>
        </dl>
        {live && !rw.fullyFunded && rw.needed > 0n && (
          <p className="warn-box">
            {rw.funded < 3n ? "Running low. " : ""}The balance covers {rw.funded.toString()} of the {rw.needed.toString()} payments left.
            {" "}{usdc(rw.shortfall)} more would fund every one.
          </p>
        )}
      </Card>

      {order.state === "Quarantined" && (
        <Card title="Paused: the recipient's USDC is frozen" className="alert">
          <p>
            Circle has blocklisted the recipient, so a transfer to them would fail. Instead of burning gas on failures, Writ paused
            the order and recorded it on-chain. Nothing is lost. The holder of the key card can point the order at a new recipient,
            or cancel it and refund the payer.
          </p>
          <NetLink to={`/order/${order.id}/manage`} className="btn">Resolve with key card</NetLink>
        </Card>
      )}

      {live && order.cancelReadyAt > 0n && (
        <Card title="The payer has given notice to cancel" className="alert">
          <p>
            The payer's wallet started a 30-day cancellation. Payments continue meanwhile. It can be finalized{" "}
            {relative(order.cancelReadyAt, now)} ({formatDate(order.cancelReadyAt)}) unless the key card vetoes it.
          </p>
        </Card>
      )}

      <ExecutePanel order={order} now={now} gasPrice={gasPrice} refetch={() => q.refetch()} />

      {live && (
        <Card title="Add funds">
          <p className="muted">Anyone can top up an order. The money can only ever go to the recipient, to executors (capped), or back to the payer.</p>
          <TopUp net={net} client={client} order={order} suggested={rw.shortfall} onDone={() => q.refetch()} />
        </Card>
      )}

      <div className="grid2">
        <Card title="Key card holder">
          <p className="muted">Change the recipient or amount, rotate the key card, cancel, resolve a pause, or veto a wallet cancellation.</p>
          <NetLink to={`/order/${order.id}/manage`} className="btn btn-ghost">Manage with key card</NetLink>
        </Card>
        <Card title="Payer">
          <p className="muted">
            Opened by <Addr net={net} a={order.payer} />{isPayer ? " (you)" : ""}. The payer can give 30 days' notice to cancel, reclaim
            leftovers after the end date, or top up.
          </p>
          <NetLink to={`/order/${order.id}/payer`} className="btn btn-ghost">Payer actions</NetLink>
        </Card>
      </div>

      <details className="card details">
        <summary>Details</summary>
        <dl className="kv">
          <dt>Recipient</dt><dd className="mono break">{order.beneficiary}</dd>
          <dt>Payer</dt><dd className="mono break">{order.payer}</dd>
          <dt>Ends</dt><dd>{formatDate(order.endTime)}</dd>
          <dt>Max executor reward</dt><dd>{usdc(order.maxExecutorFee)} per payment</dd>
          <dt>Key card fingerprint</dt><dd className="mono break">{order.pqKey}</dd>
          <dt>Key card actions used</dt><dd>{order.pqNonce.toString()}</dd>
          <dt>Reference hash</dt><dd className="mono break">{order.ref}</dd>
          <dt>Contract</dt><dd><Addr net={net} a={net.writ} label={net.writ} /></dd>
        </dl>
      </details>
    </div>
  );
}
