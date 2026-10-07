import { useState } from "react";
import { useAccount } from "wagmi";
import type { PublicClient } from "viem";
import { fundAuthNonce } from "../../../shared/auth.ts";
import type { Network } from "../config";
import { useAction } from "../hooks";
import { parseUsdc, usdc } from "../lib/format";
import type { Order } from "../lib/order";
import { randomSalt, sendWrit, signReceiveAuth } from "../lib/write";
import { Field, StatusLine, WalletGate } from "../ui";

/** Anyone can add USDC to a running or frozen order (one signature + one transaction, no approve). */
export function TopUp({ net, client, order, suggested, onDone }: {
  net: Network; client: PublicClient; order: Order; suggested?: bigint; onDone: () => void;
}) {
  const { address } = useAccount();
  const [text, setText] = useState("");
  const action = useAction();
  const amount = parseUsdc(text);
  const live = order.state === "Active" || order.state === "Quarantined";

  if (!live) return <p className="text-2">This order is {order.state === "Completed" ? "finished" : "cancelled"}, so it can't take more money.</p>;

  const submit = () =>
    action.run(async (step) => {
      if (!address || !amount) return;
      const salt = randomSalt();
      const nonce = fundAuthNonce(net.writ, order.id, salt);
      const auth = await signReceiveAuth(client, net, address, amount, nonce, step);
      const { hash } = await sendWrit(client, net, "fundWithAuthorization", [order.id, address, amount, salt, auth], step);
      setText("");
      onDone();
      return { message: `Added ${usdc(amount)} to order #${order.id}.`, hash };
    }, { order, action: "fund" });

  return (
    <div className="stack">
      <Field label="Amount (USDC)" error={text && !amount ? "Enter an amount like 5 or 0.25." : null}
             hint={suggested && suggested > 0n ? <>To cover every remaining payment: <button className="link" type="button" onClick={() => setText((Number(suggested) / 1e6).toFixed(6).replace(/\.?0+$/, ""))}>{usdc(suggested)}</button></> : undefined}>
        <input inputMode="decimal" placeholder="10.00" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <WalletGate net={net} why="Connect a wallet to add money.">
        <div><button className="btn btn-primary" disabled={!amount || action.busy} onClick={submit}>Add money</button></div>
      </WalletGate>
      <StatusLine status={action.status} net={net} />
    </div>
  );
}
