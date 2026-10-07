// Live check of openWithAuthorization against the REAL Arc testnet USDC
// (ARCHITECTURE.md §5.8 ASSUMPTION / §11.3 row 7). No mock anywhere.
//
//   1. sign an EIP-3009 ReceiveWithAuthorization against the real USDC domain,
//      with the nonce bound to (Writ, next id, terms)
//   2. openWithAuthorization -> USDC moves from the payer to Writ, no approve
//   3. the same authorization replayed -> rejected
//   4. cancelByPq with the order's key card -> refund, so no test funds stay locked
//
// Usage: node --env-file=.env scripts/auth-check.ts
// Writes deployments/auth-check-testnet.json.

import { writeFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import {
  BaseError, ContractFunctionRevertedError, keccak256, parseEventLogs, parseSignature, toHex, type Hash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Action, EMPTY_PAYLOAD, digestFor } from "../shared/digest.ts";
import { openAuthNonce, type Terms } from "../shared/auth.ts";
import {
  CHAIN_ID, USDC, WRIT, balanceOf, link, now, obligation, payer, pub, root, send, usd, usdcAbi, wallet, writAbi,
} from "./arc.ts";

const results: { check: string; ok: boolean; tx?: Hash; link?: string; note?: string }[] = [];
function report(check: string, ok: boolean, note?: string, tx?: Hash) {
  results.push({ check, ok, ...(tx && { tx, link: link(tx) }), ...(note && { note }) });
  writeFileSync(new URL("deployments/auth-check-testnet.json", root),
    JSON.stringify({ writ: WRIT, usdc: USDC, payer: payer.address, results }, null, 2) + "\n");
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${check}`);
  if (tx) console.log(`      ${link(tx)}`);
  if (note) console.log(`      ${note}`);
}

function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? r.shortMessage;
    return e.shortMessage;
  }
  return String(e);
}

const gasCost = (r: { gasUsed: bigint; effectiveGasPrice: bigint }) => (r.gasUsed * r.effectiveGasPrice) / 10n ** 12n;

async function main() {
  console.log(`Writ ${WRIT}\nUSDC ${USDC} (real Arc testnet USDC)\npayer ${payer.address}`);

  const card = S.keygen();
  const id = (await pub.readContract({ address: WRIT, abi: writAbi, functionName: "nextId" })) as bigint;
  const startAt = (await now()) + 60n;
  const terms: Terms = {
    beneficiary: privateKeyToAccount(generatePrivateKey()).address,
    amountPerPeriod: 100_000n, periodSeconds: 3600n, startAt, endTime: startAt + 3600n,
    maxExecutorFee: 10_000n, pqKey: toHex(card.publicKey), ref: keccak256(toHex(`AUTH-CHECK-${Date.now()}`)),
  };
  const FUNDING = 120_000n;

  // The nonce from shared/auth.ts must equal the contract's own view.
  const nonce = openAuthNonce(WRIT, id, terms);
  const onChainNonce = await pub.readContract({ address: WRIT, abi: writAbi, functionName: "openAuthNonce", args: [id, terms] });
  report("TS openAuthNonce matches the deployed contract", nonce === onChainNonce, `id ${id}, nonce ${nonce}`);
  if (nonce !== onChainNonce) process.exit(1);

  // 1. Sign against the real USDC EIP-712 domain.
  const validAfter = 0n;
  const validBefore = (await now()) + 3600n;
  const signature = await wallet.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: payer.address, to: WRIT, value: FUNDING, validAfter, validBefore, nonce },
  });
  const { v, r, s, yParity } = parseSignature(signature);
  const auth = { validAfter, validBefore, nonce, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };

  // Simulate first so a failure reports the real reason.
  try {
    await pub.simulateContract({ account: payer, address: WRIT, abi: writAbi, functionName: "openWithAuthorization", args: [terms, payer.address, FUNDING, auth] });
  } catch (e) {
    report("openWithAuthorization (simulation) with real USDC", false, `reverted: ${revertName(e)}`);
    process.exit(1);
  }

  // 2. Send it for real.
  const usedBefore = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [payer.address, nonce] });
  const payerBefore = await balanceOf(payer.address);
  const writBefore = await balanceOf(WRIT);
  const tx = await send("openWithAuthorization", [terms, payer.address, FUNDING, auth]);
  const opened = parseEventLogs({ abi: writAbi, logs: tx.receipt.logs, eventName: "Opened" }) as unknown as { args: { id: bigint } }[];
  const o = await obligation(id);
  const usedAfter = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "authorizationState", args: [payer.address, nonce] });
  const writDelta = (await balanceOf(WRIT)) - writBefore;
  const payerDelta = payerBefore - (await balanceOf(payer.address));
  const ok = tx.receipt.status === "success" && opened[0]?.args.id === id && o.state === "Active" &&
    o.payer === payer.address && o.balance === FUNDING && writDelta === FUNDING && !usedBefore && usedAfter;
  report("openWithAuthorization with REAL testnet USDC (no approve)", ok,
    `order #${id} ${o.state}, payer ${o.payer}, balance ${usd(o.balance)}; Writ received ${usd(writDelta)}; ` +
    `payer paid ${usd(payerDelta)} (= ${usd(FUNDING)} funding + ${usd(gasCost(tx.receipt))} gas; on Arc gas is USDC); ` +
    `USDC authorizationState ${usedBefore} -> ${usedAfter}; gas ${tx.receipt.gasUsed}`, tx.hash);

  // 3. Replaying the same signed authorization must fail.
  try {
    await pub.simulateContract({ account: payer, address: WRIT, abi: writAbi, functionName: "openWithAuthorization", args: [terms, payer.address, FUNDING, auth] });
    report("replayed authorization is rejected", false, "replay simulation succeeded");
  } catch (e) {
    const name = revertName(e);
    report("replayed authorization is rejected", name === "BadAuthorizationNonce", `reverted: ${name} (simulation only, no tx)`);
  }

  // 4. Clean up: the key card cancels the order and the payer is refunded.
  const deadline = (await now()) + 900n;
  const d = digestFor({ chainId: BigInt(CHAIN_ID), writ: WRIT, id, action: Action.Cancel, payload: EMPTY_PAYLOAD, pqNonce: 0n, deadline });
  const sig = S.sign(Buffer.from(d.slice(2), "hex"), card.secretKey);
  const c = await send("cancelByPq", [id, deadline, toHex(sig)]);
  const cancelled = parseEventLogs({ abi: writAbi, logs: c.receipt.logs, eventName: "Cancelled" }) as unknown as { args: { refunded: bigint } }[];
  const refunded = cancelled[0]?.args.refunded ?? 0n;
  report("cancelByPq refunds the test order",
    c.receipt.status === "success" && (await obligation(id)).state === "Cancelled" && refunded === FUNDING,
    `refund ${usd(refunded)}, gas ${c.receipt.gasUsed}`, c.hash);

  const allOk = results.every((x) => x.ok);
  console.log(`\n${allOk ? "RESULT: openWithAuthorization WORKS with real Arc testnet USDC." : "RESULT: FAILED — see above."}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("\nAUTH CHECK FAILED:", revertName(e));
  process.exit(1);
});
