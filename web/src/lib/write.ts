// Writes through the connected wallet. Every call is simulated first, so a
// revert becomes a readable message before the wallet even opens.

import { getAccount, signTypedData, simulateContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { parseEventLogs, parseSignature, toHex, type Address, type Hash, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { chainIdOf, usdcDomain, wagmiConfig, type Network } from "../config";
import { arcFees, chainNow } from "./tx";

export type Step = (label: string) => void;

export async function sendWrit(
  client: PublicClient, net: Network, functionName: string, args: readonly unknown[], step: Step,
): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  const account = getAccount(wagmiConfig).address;
  if (!account) throw new Error("Connect your wallet first.");
  step("Checking the transaction…");
  const fees = await arcFees(client);
  const { request } = await simulateContract(wagmiConfig, {
    address: net.writ, abi: writAbi, functionName: functionName as never, args: args as never,
    account, chainId: chainIdOf(net), ...fees,
  } as never);
  step("Confirm the transaction in your wallet…");
  const hash = await writeContract(wagmiConfig, request as never);
  step("Waiting for the network to confirm…");
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: chainIdOf(net) });
  if (receipt.status !== "success") throw new Error("The transaction was included but failed. Nothing changed.");
  return { hash, receipt };
}

export interface Authorization {
  validAfter: bigint; validBefore: bigint; nonce: Hex; v: number; r: Hex; s: Hex;
}

/** EIP-3009 ReceiveWithAuthorization to Writ, signed by the connected wallet. */
export async function signReceiveAuth(
  client: PublicClient, net: Network, from: Address, value: bigint, nonce: Hex, step: Step,
): Promise<Authorization> {
  step("Approve the USDC payment authorization in your wallet…");
  const validBefore = (await chainNow(client)) + 3600n;
  const signature = await signTypedData(wagmiConfig, {
    account: from,
    domain: usdcDomain(net),
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from, to: net.writ, value, validAfter: 0n, validBefore, nonce },
  });
  const { r, s, v, yParity } = parseSignature(signature);
  return { validAfter: 0n, validBefore, nonce, v: Number(v ?? BigInt(27 + (yParity ?? 0))), r, s };
}

export const randomSalt = (): Hex => toHex(crypto.getRandomValues(new Uint8Array(32)));

export function events(receipt: TransactionReceipt) {
  return parseEventLogs({ abi: writAbi, logs: receipt.logs });
}
