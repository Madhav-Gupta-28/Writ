// §11.5 free rehearsal: run Writ's whole lifecycle against LIVE chain state in a
// single eth_call with state overrides. Nothing is broadcast, nothing is spent.
//
// Injected (state override, never deployed):
//   W  Writ runtime code, with storage slot 1 (nextId) = 1 because the
//      constructor does not run under injection
//   R  contracts/script/MainnetRehearsal.sol, with a 1 USDC native balance
// Real: USDC at 0x3600…, the PQ precompile at 0x1800…0004, the payer's USDC
// balance (for the EIP-3009 step), block context.
//
// R runs: open -> execute -> amend (real SLH-DSA) -> bad/short signatures ->
// cancelByPq (real SLH-DSA, refund) -> openWithAuthorization (real EIP-3009).
// Also estimates the real deployment's gas.
//
// Usage: node --env-file=.env scripts/rehearse.ts [--mainnet]   (testnet by default)

import { readFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import {
  decodeFunctionResult, encodeFunctionData, keccak256, parseSignature, toFunctionSelector, toHex, type Address, type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Action, EMPTY_PAYLOAD, amendPayload, digestFor } from "../shared/digest.ts";
import { openAuthNonce, type Terms } from "../shared/auth.ts";
import { CHAIN_ID, MAINNET, USDC, assertChain, balanceOf, payer, pub, root, usd, wallet, writArtifact } from "./arc.ts";

const harness = JSON.parse(readFileSync(new URL("contracts/out/MainnetRehearsal.sol/MainnetRehearsal.json", root), "utf8"));
const W: Address = "0x00000000000000000000000000000000005e4e01";
const R: Address = "0x00000000000000000000000000000000005e4e02";

const AMOUNT = 10_000n, FEE_CAP = 5_000n, FUNDING = 100_000n, AUTH_FUNDING = 20_000n;

async function main() {
  await assertChain();
  for (const a of [W, R]) {
    if ((await pub.getCode({ address: a })) !== undefined) throw new Error(`${a} is not empty on this chain; pick another injection address`);
  }
  const block = await pub.getBlock(); // pin one block so the timestamp is known
  const blockNumber = block.number;
  const overrides = [
    { address: W, code: writArtifact.deployedBytecode.object as Hex,
      stateDiff: [{ slot: toHex(1n, { size: 32 }), value: toHex(1n, { size: 32 }) }] },
    { address: R, code: harness.deployedBytecode.object as Hex, balance: 10n ** 18n }, // 1 USDC native
  ];
  const call = async (data: Hex) =>
    (await pub.call({ account: payer.address, to: R, data, blockNumber, gas: 25_000_000n, stateOverride: overrides })).data!;

  // block.timestamp the node uses for eth_call at this block
  const tsData = await call(encodeFunctionData({ abi: harness.abi, functionName: "ts" }));
  const startAt = BigInt(decodeFunctionResult({ abi: harness.abi, functionName: "ts", data: tsData }) as bigint);

  // Real SLH-DSA signatures over the digests W will compute (nonces 0 and 1).
  const card = S.keygen();
  const ben1 = privateKeyToAccount(generatePrivateKey()).address;
  const ben2 = privateKeyToAccount(generatePrivateKey()).address;
  const deadline = startAt + 3600n;
  const endTime = startAt + 7200n;
  const sign = (action: Action, payload: Hex, pqNonce: bigint) => {
    const d = digestFor({ chainId: BigInt(CHAIN_ID), writ: W, id: 1n, action, payload, pqNonce, deadline });
    return toHex(S.sign(Buffer.from(d.slice(2), "hex"), card.secretKey));
  };
  const amendSig = sign(Action.Amend,
    amendPayload({ newBeneficiary: ben2, newAmount: AMOUNT, newPeriodSeconds: 3600n, newEndTime: endTime, newMaxExecutorFee: FEE_CAP }), 0n);
  const cancelSig = sign(Action.Cancel, EMPTY_PAYLOAD, 1n);

  // Real EIP-3009 authorization from the payer's wallet, bound to (W, id 2, terms).
  const authTerms: Terms = {
    beneficiary: ben1, amountPerPeriod: AMOUNT, periodSeconds: 3600n, startAt, endTime,
    maxExecutorFee: FEE_CAP, pqKey: toHex(card.publicKey), ref: keccak256(toHex("REHEARSAL-AUTH")),
  };
  const nonce = openAuthNonce(W, 2n, authTerms);
  const signature = await wallet.signTypedData({
    domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC },
    types: { ReceiveWithAuthorization: [
      { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
    ] },
    primaryType: "ReceiveWithAuthorization",
    message: { from: payer.address, to: W, value: AUTH_FUNDING, validAfter: 0n, validBefore: startAt + 3600n, nonce },
  });
  const { r, s, v, yParity } = parseSignature(signature);
  const auth = { validAfter: 0n, validBefore: startAt + 3600n, nonce, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };

  const input = {
    writ: W, startAt, pqKey: toHex(card.publicKey), ben1, ben2, deadline, amendSig, cancelSig,
    authFrom: payer.address, authTerms, authFunding: AUTH_FUNDING, auth,
  };
  let res: Record<string, unknown>;
  try {
    const data = await call(encodeFunctionData({ abi: harness.abi, functionName: "run", args: [input] }));
    res = decodeFunctionResult({ abi: harness.abi, functionName: "run", data }) as Record<string, unknown>;
  } catch (e) {
    console.log(`\nREHEARSAL FAILED: the eth_call reverted.\n${(e as Error).message}`);
    process.exit(1);
  }

  const sel = (sig: string) => toFunctionSelector(sig);
  const fee = res.executorFee as bigint;
  const checks: [string, boolean, string][] = [
    ["R's native 1 USDC shows as 1.000000 on the ERC-20 interface (one balance, §2.6)", res.startBalance === 1_000_000n, usd(res.startBalance as bigint)],
    ["open: first id is 1 (nextId override worked)", res.id1 === 1n, String(res.id1)],
    ["execute: beneficiary received 0.01 USDC through real USDC", res.ben1Paid === AMOUNT, usd(res.ben1Paid as bigint)],
    ["execute: executor reimbursed, within the cap", fee > 0n && fee <= FEE_CAP, usd(fee)],
    ["amend: REAL precompile accepted the SLH-DSA signature; beneficiary changed", (res.beneficiaryAfterAmend as string).toLowerCase() === ben2.toLowerCase(), res.beneficiaryAfterAmend as string],
    ["amend: pqNonce consumed", res.nonceAfterAmend === 1n, String(res.nonceAfterAmend)],
    ["wrong 7,856-byte signature -> BadSignature (real precompile said false)", res.badSigError === sel("BadSignature()"), res.badSigError as string],
    ["7,855-byte signature -> BadSignatureLength (never reaches precompile)", res.shortSigError === sel("BadSignatureLength()"), res.shortSigError as string],
    ["cancelByPq (real signature): payer refunded the rest", res.refunded === FUNDING - AMOUNT - fee, usd(res.refunded as bigint)],
    ["cancelByPq: state Cancelled", res.stateAfterCancel === 3, String(res.stateAfterCancel)],
    ["openWithAuthorization: REAL USDC EIP-3009, id 2, payer = signer", res.id2 === 2n && (res.id2Payer as string).toLowerCase() === payer.address.toLowerCase(), `id ${res.id2}, payer ${res.id2Payer}`],
    ["openWithAuthorization: funded from the payer's real balance", res.id2Balance === AUTH_FUNDING, usd(res.id2Balance as bigint)],
    ["books: totalCommitted == Writ's USDC balance", res.totalCommitted === AUTH_FUNDING && res.writUsdcBalance === AUTH_FUNDING, `${usd(res.totalCommitted as bigint)} / ${usd(res.writUsdcBalance as bigint)}`],
  ];

  // The deployment itself: estimate gas for the real creation transaction.
  const deployGas = await pub.estimateGas({ account: payer.address, data: writArtifact.bytecode.object as Hex });
  const gasPrice = await pub.getGasPrice();

  console.log(`\nRehearsal on ${MAINNET ? "MAINNET" : "testnet"} (chain ${CHAIN_ID}) at block ${blockNumber}, timestamp ${startAt}. Nothing was sent.\n`);
  for (const [name, ok, v] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}  [${v}]`);
  console.log(`\nDeployment estimate: ${deployGas} gas at ${Number(gasPrice) / 1e9} gwei ≈ ${usd(deployGas * gasPrice / 10n ** 12n)}`);
  console.log(`Payer ${payer.address} balance: ${usd(await balanceOf(payer.address))}`);
  const ok = checks.every((c) => c[1]);
  console.log(`\n${ok ? "REHEARSAL PASSED" : "REHEARSAL FAILED"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("\nREHEARSAL ERROR:", e instanceof Error ? e.message : e);
  process.exit(1);
});
