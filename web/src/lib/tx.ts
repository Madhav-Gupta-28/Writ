// Sending transactions the way Arc needs them (§3.2: maxFeePerGas >= 20 gwei),
// plus the PQ signing helper shared by every key-card action.

import { bytesToHex, hexToBytes, parseGwei, type Hash, type Hex, type PublicClient } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { digestFor, type Action } from "../../../shared/digest.ts";
import type { Network } from "../config";
import type { KeyCard } from "./keycard";
import { signDigest } from "./signer";

export async function arcFees(client: PublicClient) {
  const block = await client.getBlock();
  const base = block.baseFeePerGas ?? parseGwei("20");
  const floor = parseGwei("20");
  return { maxFeePerGas: base * 2n > floor ? base * 2n : floor, maxPriorityFeePerGas: parseGwei("1") };
}

export async function chainNow(client: PublicClient): Promise<bigint> {
  return (await client.getBlock()).timestamp;
}

export interface PqSignature {
  deadline: bigint;
  digest: Hex;
  signature: Hex;
  ms: number;
}

/**
 * Build the digest exactly like Writ.digestFor (shared/digest.ts), check it
 * against the deployed contract, and sign it with the key card in a worker.
 */
export async function pqSign(
  client: PublicClient, net: Network, card: KeyCard, id: bigint, action: Action, payload: Hex,
): Promise<PqSignature> {
  const o = await client.readContract({ address: net.writ, abi: writAbi, functionName: "obligations", args: [id] });
  const pqNonce = o[8];
  const deadline = (await chainNow(client)) + 15n * 60n;
  const digest = digestFor({ chainId: BigInt(net.chain.id), writ: net.writ, id, action, payload, pqNonce, deadline });
  const onChain = await client.readContract({
    address: net.writ, abi: writAbi, functionName: "digestFor", args: [id, action, payload, deadline],
  });
  if (onChain !== digest) throw new Error("Safety check failed: this app and the contract disagree on what to sign. Nothing was sent.");
  const { signature, ms } = await signDigest(card, hexToBytes(digest));
  return { deadline, digest, signature: bytesToHex(signature), ms };
}

export const txLink = (net: Network, h: Hash) => `${net.explorer}/tx/${h}`;
export const addressLink = (net: Network, a: string) => `${net.explorer}/address/${a}`;
