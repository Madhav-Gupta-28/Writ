// Open one long-running order and execute its first payment, so there is a
// real Paid event. The order is left running.
//
//   0.01 USDC per day, until 2026-11-01T00:00:00Z, executor fee cap 0.005 USDC,
//   funded for every payment plus a capped executor fee each time.
//   Opened with openWithAuthorization (one tx, no approve).
//
// A new key card (the order's amendment authority) and a new beneficiary key
// are written to .keycards/ BEFORE anything is sent. Back that file up: the key
// card is the only way to amend, rotate, veto or cancel this order.
//
// Usage: node --env-file=.env scripts/open-order.ts [--mainnet]   (testnet by default)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import { keccak256, parseEventLogs, parseSignature, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openAuthNonce, type Terms } from "../shared/auth.ts";
import {
  CHAIN_ID, DEPLOYMENT_FILE, MAINNET, USDC, WRIT, assertChain, balanceOf, clock, link, now, obligation, payer, pub,
  requireWrit, root, send, sleep, usd, wallet, writAbi,
} from "./arc.ts";

const AMOUNT = 10_000n;                                       // 0.01 USDC per period
const PERIOD = 86_400n;                                       // 1 day
const END = BigInt(Date.UTC(2026, 10, 1) / 1000);             // 2026-11-01T00:00:00Z
const FEE_CAP = 5_000n;                                       // 0.005 USDC: covers ~0.003 of gas at the floor
const MAX_FUNDING = 600_000n;                                 // stop if more than 0.6 USDC is needed
const START_DELAY = 90n;                                      // leaves time to sign and land the tx

async function main() {
  requireWrit();
  await assertChain();
  const balance = await balanceOf(payer.address);
  console.log(`Writ ${WRIT}\npayer ${payer.address} (${usd(balance)})`);

  const startAt = (await now()) + START_DELAY;
  if (startAt > END) throw new Error("start is after the end date");
  const payments = (END - startAt) / PERIOD + 1n;             // due at startAt + k·PERIOD while <= END
  const funding = payments * (AMOUNT + FEE_CAP);
  console.log(`\n${payments} payments of ${usd(AMOUNT)} from ${clock(startAt)} to ${clock(startAt + (payments - 1n) * PERIOD)}`);
  console.log(`funding = ${payments} × (${usd(AMOUNT)} + ${usd(FEE_CAP)} max executor fee) = ${usd(funding)}`);
  if (funding > MAX_FUNDING) {
    console.log(`\nSTOP: funding ${usd(funding)} is above the ${usd(MAX_FUNDING)} limit. Nothing sent.`);
    process.exit(2);
  }
  if (funding + 20_000n > balance) throw new Error("not enough USDC for funding plus gas");

  // Key card + beneficiary, saved before anything is sent.
  const card = S.keygen();
  const benKey = generatePrivateKey();
  const ben = privateKeyToAccount(benKey);
  mkdirSync(new URL(".keycards/", root), { recursive: true });
  const cardFile = new URL(`.keycards/${MAINNET ? "mainnet" : "testnet"}-live-order-${Date.now()}.json`, root);
  const saved = {
    WARNING: "Controls a live Writ order. Back this file up somewhere safe. Never commit it.",
    chainId: CHAIN_ID, writ: WRIT, pqPublicKey: toHex(card.publicKey), pqSecretKey: toHex(card.secretKey),
    beneficiary: ben.address, beneficiaryPrivateKey: benKey, orderId: null as string | null,
  };
  writeFileSync(cardFile, JSON.stringify(saved, null, 2));
  console.log(`key card + beneficiary key saved to ${cardFile.pathname.split("/").slice(-2).join("/")}`);

  const terms: Terms = {
    beneficiary: ben.address, amountPerPeriod: AMOUNT, periodSeconds: PERIOD, startAt, endTime: END,
    maxExecutorFee: FEE_CAP, pqKey: toHex(card.publicKey), ref: keccak256(toHex("WRIT-LIVE-ORDER-1")),
  };
  const id = (await pub.readContract({ address: WRIT, abi: writAbi, functionName: "nextId" })) as bigint;
  const nonce = openAuthNonce(WRIT, id, terms);
  const validBefore = (await now()) + 3600n;
  const signature = await wallet.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: { ReceiveWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "ReceiveWithAuthorization",
    message: { from: payer.address, to: WRIT, value: funding, validAfter: 0n, validBefore, nonce },
  });
  const { r, s, v, yParity } = parseSignature(signature);
  const auth = { validAfter: 0n, validBefore, nonce, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };

  const op = await send("openWithAuthorization", [terms, payer.address, funding, auth]);
  const opened = parseEventLogs({ abi: writAbi, logs: op.receipt.logs, eventName: "Opened" }) as unknown as { args: { id: bigint } }[];
  if (op.receipt.status !== "success" || opened[0]?.args.id !== id) throw new Error("open failed");
  saved.orderId = id.toString();
  writeFileSync(cardFile, JSON.stringify(saved, null, 2));
  console.log(`\nopened order #${id}\n  ${link(op.hash)}`);

  // First payment.
  while ((await now()) < startAt) await sleep(5000);
  const ex = await send("execute", [id]);
  const paid = parseEventLogs({ abi: writAbi, logs: ex.receipt.logs, eventName: "Paid" }) as unknown as { args: { amount: bigint; periodIndex: number } }[];
  const fee = parseEventLogs({ abi: writAbi, logs: ex.receipt.logs, eventName: "ExecutorPaid" }) as unknown as { args: { fee: bigint } }[];
  if (ex.receipt.status !== "success" || !paid[0]) throw new Error("execute failed");
  const o = await obligation(id);
  console.log(`\nfirst payment: Paid(#${id}, ${ben.address}, ${usd(paid[0].args.amount)}, period ${paid[0].args.periodIndex})`);
  console.log(`  ${link(ex.hash)}`);
  console.log(`  executor fee ${usd(fee[0]?.args.fee ?? 0n)} (to the payer, who executed); order balance ${usd(o.balance)}; next due ${clock(o.nextDueAt)}; state ${o.state}`);

  // Record in the deployment file.
  const dep = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
  dep.liveOrder = {
    id: id.toString(), beneficiary: ben.address, amountPerPeriod: AMOUNT.toString(), periodSeconds: PERIOD.toString(),
    startAt: clock(startAt), endTime: clock(END), maxExecutorFee: FEE_CAP.toString(), funding: funding.toString(),
    payments: payments.toString(), pqKey: toHex(card.publicKey),
    openTx: op.hash, openLink: link(op.hash), firstPaymentTx: ex.hash, firstPaymentLink: link(ex.hash),
    note: "Left running. Key card and beneficiary key are in .keycards/ (git-ignored), not in the repo.",
  };
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(dep, null, 2) + "\n");
  console.log(`\npayer balance now ${usd(await balanceOf(payer.address))}`);
  if (!existsSync(cardFile)) throw new Error("key card file missing!");
}

main().catch((e) => {
  console.error("\nOPEN ORDER FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
