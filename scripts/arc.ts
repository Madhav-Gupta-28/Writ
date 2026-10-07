// Shared setup for scripts that send real transactions to Arc testnet:
// chain, clients, the payer account from .env, fees and small helpers.
// Needs `forge build` (reads the ABI from contracts/out).

import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi, parseGwei,
  type Address, type Hash, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const root = new URL("../", import.meta.url);
export const deployment = JSON.parse(readFileSync(new URL("deployments/arc-testnet.json", root), "utf8"));
export const WRIT: Address = deployment.writ;
export const EXPLORER: string = deployment.explorer;
export const USDC: Address = "0x3600000000000000000000000000000000000000";
export const CHAIN_ID = 5042002;

export const writAbi = JSON.parse(readFileSync(new URL("contracts/out/Writ.sol/Writ.json", root), "utf8")).abi;
export const usdcAbi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
]);

const pk = process.env.PRIVATE_KEY?.trim();
if (!pk) throw new Error("PRIVATE_KEY missing from .env (run with: node --env-file=.env ...)");
export const payer = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://rpc.testnet.arc.io"] } },
});
// Retries with backoff: the public RPC occasionally drops a request.
const transport = () => http(undefined, { retryCount: 6, retryDelay: 1000 });
export const pub = createPublicClient({ chain: arcTestnet, transport: transport() });
export const wallet = createWalletClient({ chain: arcTestnet, transport: transport(), account: payer });

export const usd = (v: bigint) => `${(Number(v) / 1e6).toFixed(6)} USDC`;
export const link = (h: Hash) => `${EXPLORER}/tx/${h}`;
export const now = async () => (await pub.getBlock()).timestamp;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const clock = (t: bigint) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z");

// §3.2: maxFeePerGas must be >= the 20 gwei floor or the tx may never be included.
export async function fees() {
  const base = (await pub.getBlock()).baseFeePerGas ?? parseGwei("20");
  const floor = parseGwei("20");
  return { maxFeePerGas: base * 2n > floor ? base * 2n : floor, maxPriorityFeePerGas: parseGwei("1") };
}

export async function send(fn: string, args: unknown[], opts: { gas?: bigint; to?: Address; abi?: unknown } = {}) {
  const hash = await wallet.writeContract({
    address: opts.to ?? WRIT, abi: (opts.abi ?? writAbi) as never, functionName: fn as never, args: args as never,
    ...(opts.gas && { gas: opts.gas }), ...(await fees()),
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function obligation(id: bigint) {
  const o = (await pub.readContract({ address: WRIT, abi: writAbi, functionName: "obligations", args: [id] })) as unknown[];
  return {
    payer: o[0] as Address, beneficiary: o[1] as Address, balance: o[3] as bigint, nextDueAt: o[6] as bigint,
    endTime: o[7] as bigint, pqNonce: o[8] as bigint, cancelReadyAt: o[9] as bigint, periodsPaid: o[10] as number,
    state: ["None", "Active", "Quarantined", "Cancelled", "Completed"][Number(o[11])], pqKey: o[12] as Hex,
  };
}

export const balanceOf = (who: Address) =>
  pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;
