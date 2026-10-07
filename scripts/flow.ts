// The full Writ demo on Arc testnet, with real transactions (ARCHITECTURE.md §7):
//
//   key card -> open an order paying A -> execute (A is paid)
//   -> key card signs an amend -> amend to pay B
//   -> rotate to a new key card (the old one stops working)
//   -> payer starts a 30-day wallet cancel -> new key card vetoes it
//   -> wait one period -> execute (B is paid; the veto kept payments running)
//   -> payer's wallet tries to amend and is rejected
//   -> new key card cancels the order; the payer is refunded
//
// The period is 1 hour (MIN_PERIOD), and amend keeps the schedule (§5.6), so
// the run takes a little over an hour, almost all of it waiting.
//
// Needs `forge build` and a funded key in .env.
// Usage: node --env-file=.env scripts/flow.ts [--mainnet]   (or: npm run flow)
// Testnet by default.
// Resume an interrupted run from the wait (steps 9-12), with the current key card:
//   node --env-file=.env scripts/flow.ts --resume <orderId> <.keycards/...-card2.json>
//
// Writes deployments/flow-<testnet|mainnet>.json with every transaction. Demo key cards
// are saved under .keycards/ (git-ignored); they control only this demo order.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import { BaseError, ContractFunctionRevertedError, keccak256, parseEventLogs, toHex, type Address, type Hash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Action, EMPTY_PAYLOAD, amendPayload, digestFor, rotateKeyPayload } from "../shared/digest.ts";
import {
  CHAIN_ID, MAINNET, USDC, WRIT, assertChain, balanceOf, clock, link, now, obligation, payer, pub, requireWrit, root, send,
  sleep, usd, usdcAbi, writAbi,
} from "./arc.ts";

const PERIOD = 3600n;            // MIN_PERIOD
const AMOUNT = 100_000n;         // 0.10 USDC per period (6dp)
const FEE_CAP = 20_000n;         // 0.02 USDC max executor fee
const FUNDING = 300_000n;        // 0.30 USDC: two periods + fees, the rest is refunded at the end
const START_DELAY = 20n;         // startAt must not be in the past when open lands (StartInPast)

const RESUME = process.argv.indexOf("--resume");
const recordFile = new URL(`deployments/flow-${MAINNET ? "mainnet" : "testnet"}.json`, root);
const steps: { step: string; tx?: Hash; link?: string; note?: string }[] =
  RESUME >= 0 && existsSync(recordFile) ? JSON.parse(readFileSync(recordFile, "utf8")).steps : [];
const record = () =>
  writeFileSync(recordFile,
    JSON.stringify({ writ: WRIT, payer: payer.address, steps }, null, 2) + "\n");

function log(step: string, tx?: Hash, note?: string) {
  steps.push({ step, ...(tx && { tx, link: link(tx) }), ...(note && { note }) });
  record();
  console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${step}`);
  if (tx) console.log(`  tx   ${link(tx)}`);
  if (note) console.log(`  ${note}`);
}

function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.shortMessage;
    return e.shortMessage;
  }
  return String(e);
}

async function waitUntil(t: bigint, what: string) {
  let lastBeat = 0;
  for (;;) {
    let n: bigint;
    try {
      n = await now();
    } catch (e) {
      // One failed poll must not kill an hour-long run (it did once).
      console.log(`  ... RPC error while waiting (${revertName(e)}); retrying in 10 s`);
      await sleep(10_000);
      continue;
    }
    if (n >= t) return;
    const left = Number(t - n);
    if (Date.now() - lastBeat > 5 * 60_000) {
      console.log(`  ... waiting for ${what}: due ${clock(t)}, ${Math.ceil(left / 60)} min left`);
      lastBeat = Date.now();
    }
    await sleep(Math.min(left, 30) * 1000);
  }
}

/** Sign a PQ action for order `id` with `secretKey`, at the order's current nonce. */
async function pqSign(id: bigint, action: Action, payload: Hex, secretKey: Uint8Array) {
  const { pqNonce } = await obligation(id);
  const deadline = (await now()) + 900n;
  const digest = digestFor({ chainId: BigInt(CHAIN_ID), writ: WRIT, id, action, payload, pqNonce, deadline });
  const onChain = await pub.readContract({ address: WRIT, abi: writAbi, functionName: "digestFor", args: [id, action, payload, deadline] });
  if (onChain !== digest) throw new Error(`digest mismatch: TS ${digest} vs chain ${onChain}`);
  const t0 = performance.now();
  const sig = toHex(S.sign(Buffer.from(digest.slice(2), "hex"), secretKey)); // pure FIPS-205 (§3.4)
  return { deadline, digest, sig, ms: Math.round(performance.now() - t0), pqNonce };
}

function saveCard(name: string, card: { publicKey: Uint8Array; secretKey: Uint8Array }) {
  mkdirSync(new URL(".keycards/", root), { recursive: true });
  const file = `.keycards/flow-${Date.now()}-${name}.json`;
  writeFileSync(new URL(file, root), JSON.stringify({ publicKey: toHex(card.publicKey), secretKey: toHex(card.secretKey) }, null, 2));
  return file;
}

async function main() {
  requireWrit();
  await assertChain();
  console.log(`Writ    ${WRIT}`);
  console.log(`payer   ${payer.address}  (${usd(await balanceOf(payer.address))})`);

  // 1. Key card. Generated locally; only the 32-byte public key goes on chain.
  const card1 = S.keygen();
  const A = privateKeyToAccount(generatePrivateKey()).address;
  const B = privateKeyToAccount(generatePrivateKey()).address;
  log("1. key card generated", undefined,
    `public key ${toHex(card1.publicKey)} (secret saved to ${saveCard("card1", card1)}). A = ${A}, B = ${B}`);

  // 2. Approve the funding, then open an order paying A.
  const ap = await send("approve", [WRIT, FUNDING], { to: USDC, abi: usdcAbi });
  log("2a. approve USDC for open", ap.hash, `allow Writ to pull ${usd(FUNDING)}`);

  const startAt = (await now()) + START_DELAY;
  const terms = {
    beneficiary: A, amountPerPeriod: AMOUNT, periodSeconds: PERIOD, startAt,
    endTime: startAt + 24n * PERIOD, maxExecutorFee: FEE_CAP,
    pqKey: toHex(card1.publicKey), ref: keccak256(toHex(`WRIT-DEMO-${Date.now()}`)),
  };
  const op = await send("open", [terms, FUNDING]);
  const opened = parseEventLogs({ abi: writAbi, logs: op.receipt.logs, eventName: "Opened" }) as unknown as { args: { id: bigint } }[];
  const id = opened[0].args.id;
  log(`2b. open order #${id} paying A`, op.hash,
    `${usd(AMOUNT)} every ${PERIOD}s, first due ${clock(startAt)}, funded ${usd(FUNDING)}, gas ${op.receipt.gasUsed}`);

  // 3. Execute the first period: A is paid.
  await waitUntil(startAt, "the first period");
  const ex1 = await send("execute", [id]);
  log("3. execute: A is paid", ex1.hash, `A balance ${usd(await balanceOf(A))}, gas ${ex1.receipt.gasUsed}`);

  // 4-5. The key card signs an amend; the order now pays B.
  const o1 = await obligation(id);
  const amendArgs = { newBeneficiary: B, newAmount: AMOUNT, newPeriodSeconds: PERIOD, newEndTime: o1.endTime, newMaxExecutorFee: FEE_CAP };
  const am = await pqSign(id, Action.Amend, amendPayload(amendArgs), card1.secretKey);
  log("4. key card signs the amend", undefined,
    `digest ${am.digest} (matches on-chain digestFor), 7856-byte SLH-DSA signature in ${am.ms} ms`);
  const amTx = await send("amend", [id, B, AMOUNT, PERIOD, o1.endTime, FEE_CAP, am.deadline, am.sig]);
  const o2 = await obligation(id);
  log("5. amend: order now pays B", amTx.hash,
    `beneficiary ${o2.beneficiary}, pqNonce ${o2.pqNonce}, nextDueAt unchanged (${clock(o2.nextDueAt)}), gas ${amTx.receipt.gasUsed}`);

  // 6. Rotate to a new key card, signed by the old one. The old card stops working.
  const card2 = S.keygen();
  const card2File = saveCard("card2", card2);
  const rot = await pqSign(id, Action.RotateKey, rotateKeyPayload(toHex(card2.publicKey)), card1.secretKey);
  const rotTx = await send("rotateKey", [id, toHex(card2.publicKey), rot.deadline, rot.sig]);
  const o3 = await obligation(id);
  const old = await pqSign(id, Action.Cancel, EMPTY_PAYLOAD, card1.secretKey);
  let oldCard = "unexpectedly accepted";
  try {
    await pub.simulateContract({ account: payer, address: WRIT, abi: writAbi, functionName: "cancelByPq", args: [id, old.deadline, old.sig] });
  } catch (e) {
    oldCard = revertName(e);
  }
  if (oldCard !== "BadSignature") throw new Error(`old key card after rotation: ${oldCard}`);
  log("6. rotateKey: new key card takes over", rotTx.hash,
    `on-chain key now ${o3.pqKey} (secret saved to ${card2File}); the OLD card's cancel signature is rejected: ${oldCard} (simulated, no tx); gas ${rotTx.receipt.gasUsed}`);

  // 7. The payer's wallet starts the 30-day cancel.
  const bw = await send("beginWalletCancel", [id]);
  const o4 = await obligation(id);
  log("7. beginWalletCancel: payer starts the 30-day exit", bw.hash,
    `cancel would be ready at ${clock(o4.cancelReadyAt)}; payments continue meanwhile; gas ${bw.receipt.gasUsed}`);

  // 8. The new key card vetoes it.
  const veto = await pqSign(id, Action.VetoWalletCancel, EMPTY_PAYLOAD, card2.secretKey);
  const vetoTx = await send("vetoWalletCancel", [id, veto.deadline, veto.sig]);
  const o5 = await obligation(id);
  log("8. vetoWalletCancel: new key card stops it", vetoTx.hash,
    `cancelReadyAt ${o5.cancelReadyAt} (cleared), pqNonce ${o5.pqNonce}, gas ${vetoTx.receipt.gasUsed}`);

  log("9. waiting for the 1-hour interval", undefined, `next payment due ${clock(o5.nextDueAt)}`);
  await finish(id, B, A, card2.secretKey);
}

/** Steps 9-12: wait one period, B is paid, payer can't amend, key card cancels. */
async function finish(id: bigint, B: Address, A: Address, card2Secret: Uint8Array) {
  const card2 = { secretKey: card2Secret };
  const o5 = await obligation(id);
  await waitUntil(o5.nextDueAt, "B's payment");
  const ex2 = await send("execute", [id]);
  log("10. execute: B is paid", ex2.hash,
    `B balance ${usd(await balanceOf(B))}, A balance ${usd(await balanceOf(A))}, gas ${ex2.receipt.gasUsed}`);

  // 11. The payer's wallet tries to redirect the order to itself. It has no key
  //     card for this order, so it signs with a key of its own. Rejected.
  const fake = S.keygen();
  const o6 = await obligation(id);
  const evilPayload = amendPayload({ newBeneficiary: payer.address, newAmount: AMOUNT, newPeriodSeconds: PERIOD, newEndTime: o6.endTime, newMaxExecutorFee: FEE_CAP });
  const evil = await pqSign(id, Action.Amend, evilPayload, fake.secretKey);
  const evilArgs = [id, payer.address, AMOUNT, PERIOD, o6.endTime, FEE_CAP, evil.deadline, evil.sig];
  let reason = "unknown";
  try {
    await pub.simulateContract({ account: payer, address: WRIT, abi: writAbi, functionName: "amend", args: evilArgs });
    throw new Error("payer amend unexpectedly succeeded in simulation");
  } catch (e) {
    reason = revertName(e);
  }
  // Broadcast anyway, with a fixed gas limit, so the rejection is on chain.
  const bad = await send("amend", evilArgs, { gas: 1_000_000n });
  const o7 = await obligation(id);
  if (bad.receipt.status !== "reverted") throw new Error("payer amend was not reverted");
  if (o7.beneficiary !== B) throw new Error("beneficiary changed!");
  log("11. payer wallet tries to amend: rejected", bad.hash,
    `reverted with ${reason}; beneficiary is still B, pqNonce still ${o7.pqNonce}`);

  // 12. The new key card cancels the order; the remaining balance goes back to the payer.
  const cancel = await pqSign(id, Action.Cancel, EMPTY_PAYLOAD, card2.secretKey);
  const cTx = await send("cancelByPq", [id, cancel.deadline, cancel.sig]);
  const cancelled = parseEventLogs({ abi: writAbi, logs: cTx.receipt.logs, eventName: "Cancelled" }) as unknown as { args: { refunded: bigint } }[];
  const o8 = await obligation(id);
  log("12. cancelByPq: order cancelled, payer refunded", cTx.hash,
    `refunded ${usd(cancelled[0]?.args.refunded ?? 0n)} to the payer, state ${o8.state}, order balance ${usd(o8.balance)}, gas ${cTx.receipt.gasUsed}`);

  console.log(`\nDone. Order #${id}: A got ${usd(await balanceOf(A))}, B got ${usd(await balanceOf(B))}, ` +
    `payer refunded ${usd(cancelled[0]?.args.refunded ?? 0n)}. Record: ${recordFile.pathname.split("/").slice(-2).join("/")}`);
}

async function resume() {
  const id = BigInt(process.argv[RESUME + 1]);
  const card = JSON.parse(readFileSync(new URL(process.argv[RESUME + 2], root), "utf8"));
  const o = await obligation(id);
  if (o.pqKey.toLowerCase() !== card.publicKey.toLowerCase()) throw new Error("key card does not match the order's on-chain key");
  const A = (steps.find((x) => x.step.startsWith("1."))?.note?.match(/A = (0x[0-9a-fA-F]{40})/)?.[1] ?? o.beneficiary) as Address;
  log(`9b. resumed order #${id} after an RPC failure during the wait`, undefined,
    `state ${o.state}, beneficiary ${o.beneficiary}, pqNonce ${o.pqNonce}, next payment due ${clock(o.nextDueAt)}`);
  const sk = card.secretKey as Hex;
  await finish(id, o.beneficiary, A, Buffer.from(sk.slice(2), "hex"));
}

(RESUME >= 0 ? resume() : main()).catch((e) => {
  console.error("\nFLOW FAILED:", revertName(e));
  log("FAILED", undefined, revertName(e));
  process.exit(1);
});
