// Turn anything a wallet, the RPC, USDC or Writ can throw into a sentence a
// normal person can act on. Never show a raw revert name.

import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { formatDate, relative, short, usdc } from "./format";
import { reclaimOpensAt, type Order } from "./order";

export interface ErrorContext {
  order?: Order | null;
  now?: bigint; // chain time, unix seconds
  action?: "open" | "fund" | "execute" | "amend" | "cancel" | "rotate" | "resolve" | "veto" | "beginCancel" | "finalize" | "reclaim";
}

function errorName(e: unknown): { name?: string; reason?: string; message: string } {
  if (!(e instanceof BaseError)) return { message: String((e as Error)?.message ?? e) };
  const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    if (reverted.data?.errorName) return { name: reverted.data.errorName, message: e.shortMessage };
    if (reverted.reason) return { reason: reverted.reason, message: e.shortMessage };
    const raw = (reverted as unknown as { raw?: Hex }).raw;
    if (raw) {
      try {
        return { name: decodeErrorResult({ abi: writAbi, data: raw }).errorName, message: e.shortMessage };
      } catch { /* not ours */ }
    }
  }
  // Some wallets put the revert data deeper, or only in the message.
  const m = /(?:reverted with the following reason:\s*|reason:\s*)([^\n]+)/i.exec(e.message);
  const sig = /custom error ['"]?(\w+)\(/.exec(e.message) ?? /error\s+(\w+)\(\)/.exec(e.message);
  return { name: sig?.[1], reason: m?.[1]?.trim(), message: e.shortMessage ?? e.message };
}

const NOT_ACTIVE: Record<string, string> = {
  None: "There's no order with this number on this network.",
  Cancelled: "This order has been cancelled, so it can't do that any more.",
  Completed: "This order has finished: its last payment has been made.",
  Quarantined: "This order is paused because the recipient's USDC was frozen. Its key card can point it at a new recipient or cancel it.",
  Active: "This order is running normally, so that action doesn't apply.",
};

export function humanError(e: unknown, ctx: ErrorContext = {}): string {
  const { name, reason, message } = errorName(e);
  const o = ctx.order ?? null;
  const now = ctx.now ?? BigInt(Math.floor(Date.now() / 1000));
  const lower = `${message} ${(e as Error)?.message ?? ""}`.toLowerCase();

  // ---- wallet & network
  if (lower.includes("user rejected") || lower.includes("user denied") || (e as { code?: number })?.code === 4001) {
    return "You cancelled this in your wallet. Nothing was sent.";
  }
  if (lower.includes("insufficient funds") || lower.includes("exceeds balance")) {
    return "Your wallet doesn't have enough USDC for this (on Arc, USDC also pays the network fee).";
  }
  if (lower.includes("chain mismatch") || lower.includes("does not match the target chain")) {
    return "Your wallet is on a different network. Switch to Arc and try again.";
  }
  if (lower.includes("http request failed") || lower.includes("fetch failed") || lower.includes("timed out")) {
    return "Couldn't reach the Arc network. Check your connection and try again.";
  }
  if (lower.includes("connector not connected") || lower.includes("no account")) {
    return "Connect your wallet first.";
  }

  // ---- USDC (FiatTokenV2) reasons
  if (reason) {
    const r = reason.toLowerCase();
    if (r.includes("invalid signature")) return "USDC rejected the payment authorization. Please sign it again.";
    if (r.includes("authorization is expired")) return "The USDC authorization expired. Please sign again.";
    if (r.includes("used or canceled")) return "That USDC authorization was already used. Please sign a new one.";
    if (r.includes("not yet valid")) return "The USDC authorization isn't valid yet. Wait a few seconds and try again.";
    if (r.includes("blacklisted")) return "One of the addresses involved is frozen by Circle, so USDC can't move.";
    if (r.includes("exceeds balance")) return "Not enough USDC in the paying wallet.";
    if (r.includes("allowance")) return "Writ isn't allowed to take that much USDC yet. Approve it first.";
  }

  // ---- Writ custom errors
  switch (name) {
    case "NotActive":
      return NOT_ACTIVE[o?.state ?? ""] ?? "This order isn't in a state that allows that.";
    case "NotQuarantined":
      return "This order isn't paused, so there's nothing to resolve.";
    case "NotFundable":
      return `You can only add money to a running or paused order${o ? `; this one is ${o.state.toLowerCase()}` : ""}.`;
    case "NotDue":
      return o ? `This payment isn't due yet. The next one is ${relative(o.nextDueAt, now)} (${formatDate(o.nextDueAt)}).`
               : "This payment isn't due yet.";
    case "Underfunded":
      return o ? `This order doesn't have enough USDC for the next payment of ${usdc(o.amountPerPeriod)}. Anyone can top it up.`
               : "This order doesn't have enough USDC for the next payment. Anyone can top it up.";
    case "TooEarly":
      return o ? `Leftover funds can be reclaimed from ${formatDate(reclaimOpensAt(o))}, 30 days after the end date (${relative(reclaimOpensAt(o), now)}).`
               : "It's too early to reclaim: that opens 30 days after the end date.";
    case "NotPayer":
      return o ? `Only the wallet that opened this order (${short(o.payer)}) can do this.` : "Only the wallet that opened this order can do this.";
    case "NoCancelPending":
      return "There's no wallet cancellation in progress for this order.";
    case "CancelNotReady":
      return o && o.cancelReadyAt > 0n
        ? `The 30-day notice isn't over yet. You can finalize ${relative(o.cancelReadyAt, now)} (${formatDate(o.cancelReadyAt)}).`
        : "The 30-day notice isn't over yet.";
    case "Expired":
      return "The key card signature expired before it reached the chain. Please sign again.";
    case "BadSignatureLength":
      return "The key card signature came out the wrong size. Please try again.";
    case "BadSignature":
      return "The chain didn't accept this key card's signature. Either this isn't the key card for this order, or the order changed while you were signing. Reload and try again.";
    case "InvalidBeneficiary":
      return "That recipient address can't be used: it's empty or it's the Writ contract itself.";
    case "BeneficiaryBlacklisted":
      return "That recipient's USDC is frozen by Circle, so it can't be paid. Choose another address.";
    case "InvalidPqKey":
      return "The key card is missing or invalid.";
    case "ZeroAmount":
      return "The amount has to be more than zero.";
    case "InvalidPeriod":
      return "The interval has to be between 1 hour and 365 days.";
    case "StartInPast":
      return "The first payment time has already passed. Pick a time a few minutes from now and try again.";
    case "InvalidEndTime":
      return "The end date has to leave room for at least one more payment, and can't be in the past.";
    case "InvalidExecutorFee":
      return "The executor reward cap has to be above zero and below the payment amount.";
    case "InsufficientInitialFunding":
      return "Fund at least the first payment.";
    case "BadAuthorizationNonce":
      return ctx.action === "fund"
        ? "The USDC authorization doesn't match this order. Please sign again."
        : "Someone opened another order at the same moment, so your signature no longer matches the next order number. Please sign again.";
    case "TransferFailed":
      return "The USDC transfer failed.";
    case "PayerBlacklisted":
      return "The payer's USDC is frozen by Circle, so the refund can't be sent right now. The money stays safely in the order.";
    case "Reentrancy":
      return "The transaction was rejected as a re-entrant call. Please try again.";
  }

  if (lower.includes("execution reverted")) return "The network rejected this transaction. Nothing was changed.";
  return message.length > 160 ? `${message.slice(0, 160)}…` : message;
}
