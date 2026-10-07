// The full Writ demo on Arc testnet, with real transactions (ARCHITECTURE.md §7):
//
//   key card -> open an order paying A -> execute (A is paid)
//   -> sign an amend with the key card -> amend to pay B -> wait one period
//   -> execute (B is paid) -> the payer's wallet tries to amend and fails
//
// The period is 1 hour (MIN_PERIOD), and amend keeps the schedule (§5.6), so
// the run takes a little over an hour, almost all of it waiting.
//
// Needs `forge build` (reads the ABI from contracts/out) and a funded key in .env.
// Usage: node --env-file=.env scripts/flow.ts
//
// Writes deployments/flow-testnet.json with every transaction. The demo key
// card is saved under .keycards/ (git-ignored); it controls only this demo order.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, defineChain,
  http, keccak256, parseAbi, parseEventLogs, parseGwei, toHex, type Address, type Hash, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Action, amendPayload, digestFor } from "../shared/digest.ts";

// ------------------------------------------------------------------ setup

const root = new URL("../", import.meta.url);
const deployment = JSON.parse(readFileSync(new URL("deployments/arc-testnet.json", root), "utf8"));
const WRIT: Address = deployment.writ;
const EXPLORER = deployment.explorer as string;
const USDC: Address = "0x3600000000000000000000000000000000000000";

const writAbi = JSON.parse(readFileSync(new URL("contracts/out/Writ.sol/Writ.json", root), "utf8")).abi;
const usdcAbi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

const PERIOD = 3600n;            // MIN_PERIOD
const AMOUNT = 100_000n;         // 0.10 USDC per period (6dp)
const FEE_CAP = 20_000n;         // 0.02 USDC max executor fee
const FUNDING = 300_000n;        // 0.30 USDC: two periods + fees + headroom
const START_DELAY = 20n;         // startAt must not be in the past when open lands (StartInPast)

const pk = process.env.PRIVATE_KEY?.trim();
if (!pk) throw new Error("PRIVATE_KEY missing from .env");
const payer = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://rpc.testnet.arc.io"] } },
});
const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const wallet = createWalletClient({ chain: arcTestnet, transport: http(), account: payer });

const usd = (v: bigint) => `${(Number(v) / 1e6).toFixed(6)} USDC`;
const link = (h: Hash) => `${EXPLORER}/tx/${h}`;
const now = async () => (await pub.getBlock()).timestamp;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (t: bigint) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z");

// §3.2: maxFeePerGas must be >= the 20 gwei floor or the tx may never be included.
async function fees() {
  const base = (await pub.getBlock()).baseFeePerGas ?? parseGwei("20");
  const floor = parseGwei("20");
  return { maxFeePerGas: (base * 2n > floor ? base * 2n : floor), maxPriorityFeePerGas: parseGwei("1") };
}

const steps: { step: string; tx?: Hash; link?: string; note?: string }[] = [];
const record = () =>
  writeFileSync(new URL("deployments/flow-testnet.json", root),
    JSON.stringify({ writ: WRIT, payer: payer.address, steps }, null, 2) + "\n");

function log(step: string, tx?: Hash, note?: string) {
  steps.push({ step, ...(tx && { tx, link: link(tx) }), ...(note && { note }) });
  record();
  console.log(`\n[${new Date().toISOString().slice(11, 19)}] ${step}`);
  if (tx) console.log(`  tx   ${link(tx)}`);
  if (note) console.log(`  ${note}`);
}

async function send(fn: string, args: unknown[], opts: { gas?: bigint; to?: Address; abi?: unknown } = {}) {
  const hash = await wallet.writeContract({
    address: opts.to ?? WRIT, abi: (opts.abi ?? writAbi) as never, functionName: fn as never, args: args as never,
    ...(opts.gas && { gas: opts.gas }), ...(await fees()),
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

async function obligation(id: bigint) {
  const o = (await pub.readContract({ address: WRIT, abi: writAbi, functionName: "obligations", args: [id] })) as unknown[];
  return { beneficiary: o[1] as Address, nextDueAt: o[6] as bigint, endTime: o[7] as bigint, pqNonce: o[8] as bigint, periodsPaid: o[10] as number };
}

const balanceOf = (who: Address) =>
  pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;

async function waitUntil(t: bigint, what: string) {
  let lastBeat = 0;
  for (;;) {
    const n = await now();
    if (n >= t) return;
    const left = Number(t - n);
    if (Date.now() - lastBeat > 5 * 60_000) {
      console.log(`  ... waiting for ${what}: due ${clock(t)}, ${Math.ceil(left / 60)} min left`);
      lastBeat = Date.now();
    }
    await sleep(Math.min(left, 30) * 1000);
  }
}

// ------------------------------------------------------------------ the demo

async function main() {
  if ((await pub.getChainId()) !== 5042002) throw new Error("RPC is not Arc testnet");
  console.log(`Writ    ${WRIT}`);
  console.log(`payer   ${payer.address}  (${usd(await balanceOf(payer.address))})`);

  // 1. Key card. Generated locally; only the 32-byte public key goes on chain.
  const card = S.keygen();
  const A = privateKeyToAccount(generatePrivateKey()).address;
  const B = privateKeyToAccount(generatePrivateKey()).address;
  mkdirSync(new URL(".keycards/", root), { recursive: true });
  const cardFile = `.keycards/flow-${Date.now()}.json`;
  writeFileSync(new URL(cardFile, root), JSON.stringify({ publicKey: toHex(card.publicKey), secretKey: toHex(card.secretKey) }, null, 2));
  log("1. key card generated", undefined, `public key ${toHex(card.publicKey)} (secret saved to ${cardFile}). A = ${A}, B = ${B}`);

  // 2. Approve the funding, then open an order paying A.
  const ap = await send("approve", [WRIT, FUNDING], { to: USDC, abi: usdcAbi });
  log("2a. approve USDC for open", ap.hash, `allow Writ to pull ${usd(FUNDING)}`);

  const startAt = (await now()) + START_DELAY;
  const terms = {
    beneficiary: A, amountPerPeriod: AMOUNT, periodSeconds: PERIOD, startAt,
    endTime: startAt + 24n * PERIOD, maxExecutorFee: FEE_CAP,
    pqKey: toHex(card.publicKey), ref: keccak256(toHex(`WRIT-DEMO-${Date.now()}`)),
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

  // 4. Sign an amend with the key card.
  const o1 = await obligation(id);
  const amend = { newBeneficiary: B, newAmount: AMOUNT, newPeriodSeconds: PERIOD, newEndTime: o1.endTime, newMaxExecutorFee: FEE_CAP };
  const deadline = (await now()) + 900n;
  const payload = amendPayload(amend);
  const digest = digestFor({ chainId: 5042002n, writ: WRIT, id, action: Action.Amend, payload, pqNonce: o1.pqNonce, deadline });
  const onChain = await pub.readContract({ address: WRIT, abi: writAbi, functionName: "digestFor", args: [id, Action.Amend, payload, deadline] });
  if (onChain !== digest) throw new Error(`digest mismatch: TS ${digest} vs chain ${onChain}`);
  const t0 = performance.now();
  const sig = S.sign(Buffer.from(digest.slice(2), "hex"), card.secretKey); // pure FIPS-205 (§3.4)
  log("4. key card signs the amend", undefined,
    `digest ${digest} (matches on-chain digestFor), ${sig.length}-byte SLH-DSA signature in ${Math.round(performance.now() - t0)} ms`);

  // 5. Amend: pay B instead. Verified by Arc's PQ precompile.
  const am = await send("amend", [id, B, AMOUNT, PERIOD, o1.endTime, FEE_CAP, deadline, toHex(sig)]);
  const o2 = await obligation(id);
  log("5. amend: order now pays B", am.hash,
    `beneficiary ${o2.beneficiary}, pqNonce ${o2.pqNonce}, nextDueAt unchanged (${clock(o2.nextDueAt)}), gas ${am.receipt.gasUsed}`);

  // 6. Wait one period, then execute: B is paid.
  log("6. waiting for the 1-hour interval", undefined, `next payment due ${clock(o2.nextDueAt)}`);
  await waitUntil(o2.nextDueAt, "B's payment");
  const ex2 = await send("execute", [id]);
  log("7. execute: B is paid", ex2.hash, `B balance ${usd(await balanceOf(B))}, A balance ${usd(await balanceOf(A))}, gas ${ex2.receipt.gasUsed}`);

  // 7. The payer's wallet tries to redirect the order to itself. It has no key
  //    card for this order, so it signs with a key of its own. The contract
  //    rejects it: there is no wallet-only path to change the beneficiary.
  const fake = S.keygen();
  const o3 = await obligation(id);
  const dl2 = (await now()) + 900n;
  const evilArgs = [id, payer.address, AMOUNT, PERIOD, o3.endTime, FEE_CAP, dl2] as const;
  const evilDigest = digestFor({ chainId: 5042002n, writ: WRIT, id, action: Action.Amend,
    payload: amendPayload({ newBeneficiary: payer.address, newAmount: AMOUNT, newPeriodSeconds: PERIOD, newEndTime: o3.endTime, newMaxExecutorFee: FEE_CAP }),
    pqNonce: o3.pqNonce, deadline: dl2 });
  const evilSig = toHex(S.sign(Buffer.from(evilDigest.slice(2), "hex"), fake.secretKey));

  let reason = "unknown";
  try {
    await pub.simulateContract({ account: payer, address: WRIT, abi: writAbi, functionName: "amend", args: [...evilArgs, evilSig] });
    throw new Error("payer amend unexpectedly succeeded in simulation");
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    if (r instanceof ContractFunctionRevertedError) reason = r.data?.errorName ?? r.shortMessage;
    else throw e;
  }
  // Broadcast anyway, with a fixed gas limit, so the rejection is on chain.
  const bad = await send("amend", [...evilArgs, evilSig], { gas: 1_000_000n });
  const o4 = await obligation(id);
  if (bad.receipt.status !== "reverted") throw new Error("payer amend was not reverted");
  if (o4.beneficiary !== B) throw new Error("beneficiary changed!");
  log("8. payer wallet tries to amend: rejected", bad.hash,
    `reverted with ${reason}; beneficiary is still B, pqNonce still ${o4.pqNonce}`);

  console.log(`\nDone. Order #${id}: A got ${usd(await balanceOf(A))}, B got ${usd(await balanceOf(B))}. Record: deployments/flow-testnet.json`);
}

main().catch((e) => {
  console.error("\nFLOW FAILED:", e instanceof BaseError ? e.shortMessage : e);
  log("FAILED", undefined, String(e instanceof BaseError ? e.shortMessage : e));
  process.exit(1);
});
