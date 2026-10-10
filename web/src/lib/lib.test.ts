import { describe, expect, it } from "vitest";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import { BaseError, ContractFunctionRevertedError, bytesToHex, encodeErrorResult, type Address } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { humanError } from "./errors";
import { duration, formatUsdc, parseUsdc, relative } from "./format";
import { decryptKeyCard, encryptKeyCard, KeyCardError, parseKeyCardFile, checkPassword } from "./keycard";
import { costPerPayment, estimateReward, isFunded, paymentsLeft, runway, type Order } from "./order";
import { suggestedFeeCap } from "../pages/Open";
import { EXECUTE_GAS, EXECUTOR_TIP, REIMBURSE_OVERHEAD } from "../config";

const A = "0x00000000000000000000000000000000000000a1" as Address;

const order = (o: Partial<Order> = {}): Order => ({
  id: 2n, payer: A, beneficiary: A, amountPerPeriod: 10_000n, balance: 360_000n, maxExecutorFee: 5_000n,
  periodSeconds: 86_400n, nextDueAt: 1_000_000n, endTime: 1_000_000n + 23n * 86_400n + 3600n, pqNonce: 0n,
  cancelReadyAt: 0n, periodsPaid: 1, state: "Active", pqKey: "0x00", ref: "0x00", ...o,
});

describe("key card file", () => {
  const kp = S.keygen(new Uint8Array(48).fill(7));
  const card = { publicKey: kp.publicKey, secretKey: kp.secretKey };

  it("round-trips with the right password", async () => {
    const f = await encryptKeyCard(card, "correct horse battery");
    const back = await decryptKeyCard(parseKeyCardFile(JSON.stringify(f)), "correct horse battery");
    expect(bytesToHex(back.secretKey)).toBe(bytesToHex(card.secretKey));
    expect(f.publicKey).toBe(bytesToHex(card.publicKey));
    expect(JSON.stringify(f)).not.toContain(bytesToHex(card.secretKey).slice(2)); // secret is not in the clear
  }, 30_000);

  it("rejects a wrong password", async () => {
    const f = await encryptKeyCard(card, "correct horse battery");
    await expect(decryptKeyCard(f, "wrong password!!")).rejects.toThrow(KeyCardError);
  }, 30_000);

  it("rejects a file whose public key was swapped", async () => {
    const f = await encryptKeyCard(card, "correct horse battery");
    const other = S.keygen(new Uint8Array(48).fill(9)).publicKey;
    const tampered = { ...f, publicKey: bytesToHex(other) };
    await expect(decryptKeyCard(tampered, "correct horse battery")).rejects.toThrow(/Wrong password|changed/);
  }, 30_000);

  it("rejects a tampered ciphertext", async () => {
    const f = await encryptKeyCard(card, "correct horse battery");
    const flipped = f.ciphertext.slice(0, -2) + (f.ciphertext.endsWith("00") ? "01" : "00");
    await expect(decryptKeyCard({ ...f, ciphertext: flipped as `0x${string}` }, "correct horse battery")).rejects.toThrow(KeyCardError);
  }, 30_000);

  it("refuses files that aren't key cards", () => {
    expect(() => parseKeyCardFile("not json")).toThrow(/isn't a Writ key card/);
    expect(() => parseKeyCardFile('{"format":"something"}')).toThrow(/isn't a Writ key card/);
  });

  it("password rules", () => {
    expect(checkPassword("short")).toMatch(/at least 10/);
    expect(checkPassword("long enough pw", "different pw!")).toMatch(/don't match/);
    expect(checkPassword("long enough pw", "long enough pw")).toBeNull();
  });
});

describe("money and time", () => {
  it("parses USDC with at most 6 decimals", () => {
    expect(parseUsdc("12.5")).toBe(12_500_000n);
    expect(parseUsdc("0.01")).toBe(10_000n);
    expect(parseUsdc(".5")).toBe(500_000n);
    expect(parseUsdc("1,000")).toBe(1_000_000_000n);
    expect(parseUsdc("0.0000001")).toBeNull();
    expect(parseUsdc("abc")).toBeNull();
    expect(parseUsdc("-1")).toBeNull();
  });
  it("formats USDC", () => {
    expect(formatUsdc(10_000n)).toBe("0.01");
    expect(formatUsdc(1_234_567_890n)).toBe("1,234.56789");
    expect(formatUsdc(5_000_000n)).toBe("5.00");
  });
  it("relative times read naturally", () => {
    expect(relative(1000n + 42n * 60n, 1000n)).toBe("in 42 min");
    expect(relative(1000n, 1000n + 3n * 86400n)).toBe("3 days ago");
    expect(duration(3600 + 300)).toBe("1 h 5 min");
  });
});

describe("order arithmetic", () => {
  it("counts remaining payments and runway", () => {
    const o = order();
    expect(paymentsLeft(o)).toBe(24n);               // due day 0..23
    const r = runway(o);
    expect(r.funded).toBe(24n);                      // 360,000 / 15,000
    expect(r.fullyFunded).toBe(true);
    const low = runway(order({ balance: 40_000n }));
    expect(low.funded).toBe(2n);
    expect(low.fullyFunded).toBe(false);
    expect(low.shortfall).toBe(22n * 15_000n - 10_000n);
  });
  it("estimates the executor reward with the cap and the 1e12 conversion", () => {
    const r = estimateReward(order(), 20_000_000_000n);
    expect(r.fee).toBe(5_000n);                      // meter+tip ~13,100 capped at 5,000
    expect(r.gasCost).toBe((EXECUTE_GAS * 20_000_000_000n) / 10n ** 12n);
    // meter: (execute gas + 30k overhead) × 20 gwei / 1e12, plus the 0.01 tip
    expect(estimateReward(order({ maxExecutorFee: 50_000n }), 20_000_000_000n).fee)
      .toBe(EXECUTOR_TIP + ((EXECUTE_GAS + REIMBURSE_OVERHEAD) * 20_000_000_000n) / 10n ** 12n);
  });
  it("suggests a fee cap below the amount", () => {
    expect(suggestedFeeCap(10_000n)).toBe(5_000n);
    expect(suggestedFeeCap(4_000n)).toBe(2_000n);
    expect(suggestedFeeCap(100_000_000n)).toBe(50_000n);
  });
});

describe("human errors", () => {
  const revert = (errorName: string) => {
    const data = encodeErrorResult({ abi: writAbi, errorName: errorName as never });
    const inner = new ContractFunctionRevertedError({ abi: writAbi, data, functionName: "execute" });
    return new BaseError("Execution reverted", { cause: inner });
  };
  it("NotDue says when the next payment is", () => {
    const msg = humanError(revert("NotDue"), { order: order({ nextDueAt: 1000n + 42n * 60n }), now: 1000n });
    expect(msg).toMatch(/isn't due yet\. The next one is in 42 min/);
  });
  it("no raw revert names leak for any Writ error", () => {
    const names = writAbi.filter((x) => x.type === "error").map((x) => x.name);
    for (const n of names) {
      const msg = humanError(revert(n), { order: order(), now: 1000n });
      expect(msg, n).not.toContain(n);
      expect(msg.length, n).toBeGreaterThan(15);
    }
  });
  it("wallet rejection", () => {
    expect(humanError(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toMatch(/cancelled this in your wallet/);
  });
});

// The contract reserves the executor fee alongside the payment, so "payable"
// is balance >= amount + fee, not balance >= amount. Comparing against the
// amount alone is how a UI ends up offering a button that reverts Underfunded.
describe("costPerPayment / isFunded", () => {
  it("costs the payment plus the fee cap", () => {
    expect(costPerPayment(order({ amountPerPeriod: 10_000n, maxExecutorFee: 5_000n }))).toBe(15_000n);
  });

  it("is not funded between the amount and the amount plus the fee", () => {
    for (const balance of [0n, 9_999n, 10_000n, 12_000n, 14_999n]) {
      expect(isFunded(order({ balance, amountPerPeriod: 10_000n, maxExecutorFee: 5_000n }))).toBe(false);
    }
  });

  it("is funded at exactly the amount plus the fee, and above", () => {
    for (const balance of [15_000n, 15_001n, 360_000n]) {
      expect(isFunded(order({ balance, amountPerPeriod: 10_000n, maxExecutorFee: 5_000n }))).toBe(true);
    }
  });

  it("agrees with paymentsFunded at the boundary", () => {
    const o = order({ balance: 15_000n, amountPerPeriod: 10_000n, maxExecutorFee: 5_000n });
    expect(isFunded(o)).toBe(true);
    expect(runway(o).funded).toBe(1n);
  });
});

describe("estimateReward", () => {
  const GAS = 20_000_000_010n;

  it("never exceeds the fee cap", () => {
    const r = estimateReward(order({ maxExecutorFee: 1_000n }), GAS);
    expect(r.fee).toBeLessThanOrEqual(1_000n);
  });

  it("is profitable at the floor gas price", () => {
    const r = estimateReward(order(), GAS);
    expect(r.profit).toBeGreaterThan(0n);
  });

  it("uses the whole balance on a quarantined order, where no payment is deducted", () => {
    const base = { balance: 4_000n, amountPerPeriod: 10_000n, maxExecutorFee: 50_000n };
    // Active: the clamp is balance - amount, which floors at 0.
    expect(estimateReward(order({ ...base, state: "Active" }), GAS).fee).toBe(0n);
    // Quarantined: execute makes no payment, so the whole balance is available.
    expect(estimateReward(order({ ...base, state: "Quarantined" }), GAS).fee).toBe(4_000n);
  });
});
