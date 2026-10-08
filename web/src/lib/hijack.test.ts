// The hijack demo is the project's showcase: four things a thief holding only
// the wallet would try, run as free eth_call simulations. These tests drive it
// against a stubbed client so every branch is exercised without a network.
import { describe, expect, it, vi } from "vitest";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, type Address, type PublicClient } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { NETWORKS } from "../config";
import { simulateHijack } from "./hijack";
import type { Order } from "./order";

const ATTACKER = "0x00000000000000000000000000000000000000bad" .slice(0, 42) as Address;
const net = NETWORKS.testnet;
const NOW = 1_000_000n;

const order = (o: Partial<Order> = {}): Order =>
  ({
    id: 2n,
    payer: "0x00000000000000000000000000000000000000a1",
    beneficiary: "0x00000000000000000000000000000000000000a2",
    amountPerPeriod: 10_000n, balance: 360_000n, maxExecutorFee: 5_000n,
    periodSeconds: 86_400n, nextDueAt: NOW + 3600n, endTime: NOW + 30n * 86_400n,
    pqNonce: 0n, cancelReadyAt: 0n, periodsPaid: 1, state: "Active",
    pqKey: "0x00", ref: "0x00", ...o,
  }) as Order;

const revert = (errorName: string, functionName = "amend") =>
  new BaseError("Execution reverted", {
    cause: new ContractFunctionRevertedError({
      abi: writAbi,
      data: encodeErrorResult({ abi: writAbi, errorName: errorName as never }),
      functionName,
    }),
  });

/// A client whose simulateContract throws a chosen revert per function name.
function clientThatReverts(byFn: Record<string, string>): PublicClient {
  return {
    simulateContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      const name = byFn[functionName];
      if (name) throw revert(name, functionName);
      return { result: undefined };
    }),
  } as unknown as PublicClient;
}

describe("simulateHijack", () => {
  it("reports all four attempts as blocked, with a plain-language reason", async () => {
    const client = clientThatReverts({
      amend: "BadSignature",
      cancelByPq: "BadSignature",
      rotateKey: "BadSignature",
      finalizeWalletCancel: "NoCancelPending",
    });

    const out = await simulateHijack(client, net, order(), ATTACKER, NOW);

    expect(out).toHaveLength(4);
    expect(out.every((a) => a.blocked)).toBe(true);
    expect(out[0].label).toMatch(/future payments to my address/i);
    expect(out[0].reason).toMatch(/key card/i);
    expect(out[3].reason).toMatch(/30 days/i);
    // Nothing was signed or sent: only simulateContract was ever called.
    expect(client.simulateContract).toHaveBeenCalledTimes(4);
  });

  it("uses resolveQuarantine instead of amend when the order is frozen", async () => {
    const client = clientThatReverts({ resolveQuarantine: "BadSignature", cancelByPq: "BadSignature", rotateKey: "BadSignature", finalizeWalletCancel: "NoCancelPending" });
    await simulateHijack(client, net, order({ state: "Quarantined" }), ATTACKER, NOW);
    const fns = (client.simulateContract as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].functionName);
    expect(fns).toContain("resolveQuarantine");
    expect(fns).not.toContain("amend");
  });

  it("falls back to the human error when the revert is not in the table", async () => {
    const client = clientThatReverts({
      amend: "Expired", cancelByPq: "Expired", rotateKey: "Expired", finalizeWalletCancel: "Expired",
    });
    const out = await simulateHijack(client, net, order(), ATTACKER, NOW);
    expect(out.every((a) => a.blocked)).toBe(true);
    expect(out[0].reason.length).toBeGreaterThan(0);
  });

  it("says so loudly if the contract would ALLOW an attempt", async () => {
    const client = clientThatReverts({}); // nothing reverts
    const out = await simulateHijack(client, net, order(), ATTACKER, NOW);
    expect(out.every((a) => !a.blocked)).toBe(true);
    expect(out[0].reason).toMatch(/would allow this/i);
  });

  it("clamps the amend end time forward when the order has already ended", async () => {
    const client = clientThatReverts({ amend: "BadSignature", cancelByPq: "BadSignature", rotateKey: "BadSignature", finalizeWalletCancel: "NoCancelPending" });
    await simulateHijack(client, net, order({ endTime: NOW - 1n }), ATTACKER, NOW);
    const amend = (client.simulateContract as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .find((c) => c.functionName === "amend");
    // args: [id, attacker, amount, period, end, feeCap, deadline, sig]
    expect(amend.args[4]).toBeGreaterThan(NOW);
  });
});
