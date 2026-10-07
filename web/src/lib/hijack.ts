// "Try to hijack this order": what a thief holding a wallet would try, run as
// free eth_call simulations against the live contract. Nothing is signed or
// sent. A forged 7,856-byte key card signature stands in for "I don't have the
// key card"; the real on-chain verifier rejects it.

import { BaseError, ContractFunctionRevertedError, bytesToHex, type Address, type PublicClient } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import type { Network } from "../config";
import { humanError } from "./errors";
import type { Order } from "./order";

export interface Attempt {
  label: string;
  blocked: boolean;
  reason: string;
}

const WHY: Record<string, string> = {
  BadSignature: "Needs this order's key card. A wallet can't do it.",
  NotPayer: "Only the wallet that funded the order may ask, and even it can't do this instantly.",
  NoCancelPending: "Needs 30 days' public notice first, which the key card can block.",
  CancelNotReady: "The 30-day notice period hasn't finished.",
  TooEarly: "Leftover money can only be taken back 30 days after the order ends.",
  NotActive: "This order isn't running.",
  NotQuarantined: "The recipient isn't frozen, so there's nothing to redirect.",
};

function revertName(e: unknown): string | undefined {
  if (!(e instanceof BaseError)) return undefined;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  return r instanceof ContractFunctionRevertedError ? r.data?.errorName : undefined;
}

export async function simulateHijack(client: PublicClient, net: Network, order: Order, attacker: Address, now: bigint): Promise<Attempt[]> {
  const fakeSig = bytesToHex(crypto.getRandomValues(new Uint8Array(7856)));
  const deadline = now + 600n;
  const end = order.endTime > now ? order.endTime : now + order.periodSeconds;
  const tries: { label: string; fn: string; args: readonly unknown[] }[] = [
    order.state === "Quarantined"
      ? { label: "Send all future payments to my address", fn: "resolveQuarantine", args: [order.id, attacker, deadline, fakeSig] }
      : { label: "Send all future payments to my address", fn: "amend",
          args: [order.id, attacker, order.amountPerPeriod, order.periodSeconds, end, order.maxExecutorFee, deadline, fakeSig] },
    { label: "Cancel the order and refund it", fn: "cancelByPq", args: [order.id, deadline, fakeSig] },
    { label: "Replace the key card with my own", fn: "rotateKey", args: [order.id, bytesToHex(crypto.getRandomValues(new Uint8Array(32))), deadline, fakeSig] },
    { label: "Pull the money out right now", fn: "finalizeWalletCancel", args: [order.id] },
  ];

  return Promise.all(tries.map(async (t): Promise<Attempt> => {
    try {
      await client.simulateContract({
        account: attacker, address: net.writ, abi: writAbi, functionName: t.fn as never, args: t.args as never,
      });
      return { label: t.label, blocked: false, reason: "The contract would allow this right now." };
    } catch (e) {
      const name = revertName(e);
      return { label: t.label, blocked: true, reason: (name && WHY[name]) ?? humanError(e, { order, now }) };
    }
  }));
}
