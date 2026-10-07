// Reading an order, and the arithmetic the UI shows about it (§6.2, §6.3).

import type { Address, Hex, PublicClient } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { EXECUTE_GAS, EXECUTOR_TIP, REIMBURSE_OVERHEAD, RECLAIM_GRACE } from "../config";

export const STATES = ["None", "Active", "Quarantined", "Cancelled", "Completed"] as const;
export type OrderState = (typeof STATES)[number];

export interface Order {
  id: bigint;
  payer: Address;
  beneficiary: Address;
  amountPerPeriod: bigint;
  balance: bigint;
  maxExecutorFee: bigint;
  periodSeconds: bigint;
  nextDueAt: bigint;
  endTime: bigint;
  pqNonce: bigint;
  cancelReadyAt: bigint;
  periodsPaid: number;
  state: OrderState;
  pqKey: Hex;
  ref: Hex;
}

export async function readOrder(client: PublicClient, writ: Address, id: bigint): Promise<Order> {
  const o = await client.readContract({ address: writ, abi: writAbi, functionName: "obligations", args: [id] });
  return {
    id, payer: o[0], beneficiary: o[1], amountPerPeriod: o[2], balance: o[3], maxExecutorFee: o[4],
    periodSeconds: o[5], nextDueAt: o[6], endTime: o[7], pqNonce: o[8], cancelReadyAt: o[9],
    periodsPaid: o[10], state: STATES[o[11]] ?? "None", pqKey: o[12], ref: o[13],
  };
}

/** Payments still to come before endTime (counting the next one). */
export function paymentsLeft(o: Order): bigint {
  if (o.state !== "Active" && o.state !== "Quarantined") return 0n;
  if (o.nextDueAt > o.endTime) return 0n;
  return (o.endTime - o.nextDueAt) / o.periodSeconds + 1n;
}

/** How many payments the balance covers, budgeting the max executor fee each time (§6.3). */
export function paymentsFunded(o: Order): bigint {
  const per = o.amountPerPeriod + o.maxExecutorFee;
  return per === 0n ? 0n : o.balance / per;
}

export interface Runway {
  funded: bigint;       // payments the balance covers
  needed: bigint;       // payments left until endTime
  fullyFunded: boolean;
  lastFundedAt: bigint | null; // date of the last payment the balance covers
  shortfall: bigint;    // USDC (6dp) needed to fund every remaining payment
}

export function runway(o: Order): Runway {
  const funded = paymentsFunded(o);
  const needed = paymentsLeft(o);
  const covered = funded < needed ? funded : needed;
  const per = o.amountPerPeriod + o.maxExecutorFee;
  return {
    funded,
    needed,
    fullyFunded: funded >= needed,
    lastFundedAt: covered > 0n ? o.nextDueAt + (covered - 1n) * o.periodSeconds : null,
    shortfall: funded >= needed ? 0n : (needed - funded) * per - (o.balance - funded * per),
  };
}

/** The executor reward `execute` would pay right now (§5.5), and the caller's gas cost. */
export function estimateReward(o: Order, gasPriceWei: bigint) {
  const gasCost = (EXECUTE_GAS * gasPriceWei) / 10n ** 12n;
  let fee = ((EXECUTE_GAS + REIMBURSE_OVERHEAD) * gasPriceWei) / 10n ** 12n + EXECUTOR_TIP;
  if (fee > o.maxExecutorFee) fee = o.maxExecutorFee;
  const left = o.balance > o.amountPerPeriod ? o.balance - o.amountPerPeriod : 0n;
  if (fee > left) fee = left;
  return { fee, gasCost, profit: fee - gasCost };
}

export function reclaimOpensAt(o: Order) {
  return o.endTime + RECLAIM_GRACE;
}
