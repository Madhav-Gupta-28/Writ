// Shared setup for scripts that send real transactions to Arc: network
// selection, clients, the payer account from .env, fees and small helpers.
// Needs `forge build` (reads the ABI from contracts/out).
//
// NETWORK: testnet by default. Mainnet only with an explicit --mainnet flag.
// On mainnet, "MAINNET" is printed at start and again, with a 5-second pause,
// before the first transaction is sent.

import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi, parseGwei,
  type Address, type Hash, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const MAINNET = process.argv.includes("--mainnet");

const NETWORKS = {
  testnet: { id: 5042002, name: "Arc Testnet", rpc: process.env.RPC_URL ?? "https://rpc.testnet.arc.io",
             explorer: "https://explorer.testnet.arc.io", file: "deployments/arc-testnet.json" },
  mainnet: { id: 5042, name: "Arc Mainnet", rpc: process.env.MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
             explorer: "https://explorer.arc.io", file: "deployments/arc-mainnet.json" },
} as const;
export const NET = MAINNET ? NETWORKS.mainnet : NETWORKS.testnet;

if (MAINNET) console.log("\n================ MAINNET (chain 5042, real USDC) ================\n");
else console.log(`[testnet ${NETWORKS.testnet.id}] pass --mainnet to use mainnet`);

export const root = new URL("../", import.meta.url);
export const DEPLOYMENT_FILE = new URL(NET.file, root);
export const deployment = existsSync(DEPLOYMENT_FILE) ? JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8")) : null;
/** The Writ deployment on the selected network. Throws if there is none yet. */
export const WRIT: Address = deployment?.writ ?? ("0x" as Address);
export function requireWrit(): Address {
  if (!deployment?.writ) throw new Error(`no Writ deployment recorded in ${NET.file}`);
  return deployment.writ;
}
export const EXPLORER: string = NET.explorer;
export const USDC: Address = "0x3600000000000000000000000000000000000000";
export const CHAIN_ID = NET.id;

export const writArtifact = JSON.parse(readFileSync(new URL("contracts/out/Writ.sol/Writ.json", root), "utf8"));
export const writAbi = writArtifact.abi;
export const usdcAbi = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
]);

const pk = process.env.PRIVATE_KEY?.trim();
if (!pk) throw new Error("PRIVATE_KEY missing from .env (run with: node --env-file=.env ...)");
export const payer = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);

export const arcChain = defineChain({
  id: NET.id,
  name: NET.name,
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [NET.rpc] } },
});
// Retries with backoff: the public RPC occasionally drops a request.
const transport = () => http(undefined, { retryCount: 6, retryDelay: 1000 });
export const pub = createPublicClient({ chain: arcChain, transport: transport() });
const rawWallet = createWalletClient({ chain: arcChain, transport: transport(), account: payer });

export const usd = (v: bigint) => `${(Number(v) / 1e6).toFixed(6)} USDC`;
export const link = (h: Hash) => `${EXPLORER}/tx/${h}`;
export const addressLink = (a: Address) => `${EXPLORER}/address/${a}`;
export const now = async () => (await pub.getBlock()).timestamp;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const clock = (t: bigint) => new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z");

let armed = !MAINNET;
/** Must run before anything is broadcast. On mainnet: loud banner + 5 s to Ctrl-C. */
export async function beforeSend() {
  if (armed) return;
  console.log("\n>>> MAINNET: about to send real transactions from " + payer.address + ". Ctrl-C within 5 s to abort.");
  await sleep(5000);
  armed = true;
}

/** Wallet whose sending methods always go through beforeSend(). */
export const wallet = {
  ...rawWallet,
  account: payer,
  signTypedData: rawWallet.signTypedData,
  async writeContract(args: Parameters<typeof rawWallet.writeContract>[0]) {
    await beforeSend();
    return rawWallet.writeContract(args);
  },
  async deployContract(args: Parameters<typeof rawWallet.deployContract>[0]) {
    await beforeSend();
    return rawWallet.deployContract(args);
  },
};

// §3.2: maxFeePerGas must be >= the 20 gwei floor or the tx may never be included.
export async function fees() {
  const base = (await pub.getBlock()).baseFeePerGas ?? parseGwei("20");
  const floor = parseGwei("20");
  return { maxFeePerGas: base * 2n > floor ? base * 2n : floor, maxPriorityFeePerGas: parseGwei("1") };
}

export async function send(fn: string, args: unknown[], opts: { gas?: bigint; to?: Address; abi?: unknown } = {}) {
  const hash = await wallet.writeContract({
    address: opts.to ?? requireWrit(), abi: (opts.abi ?? writAbi) as never, functionName: fn as never, args: args as never,
    ...(opts.gas && { gas: opts.gas }), ...(await fees()),
  } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, receipt };
}

export async function obligation(id: bigint) {
  const o = (await pub.readContract({ address: requireWrit(), abi: writAbi, functionName: "obligations", args: [id] })) as unknown[];
  return {
    payer: o[0] as Address, beneficiary: o[1] as Address, amountPerPeriod: o[2] as bigint, balance: o[3] as bigint,
    maxExecutorFee: o[4] as bigint, periodSeconds: o[5] as bigint, nextDueAt: o[6] as bigint,
    endTime: o[7] as bigint, pqNonce: o[8] as bigint, cancelReadyAt: o[9] as bigint, periodsPaid: o[10] as number,
    state: ["None", "Active", "Quarantined", "Cancelled", "Completed"][Number(o[11])], pqKey: o[12] as Hex,
  };
}

export const balanceOf = (who: Address) =>
  pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [who] }) as Promise<bigint>;

/** Refuse to run if the RPC's chain id isn't the selected network. */
export async function assertChain() {
  const id = await pub.getChainId();
  if (id !== NET.id) throw new Error(`RPC ${NET.rpc} is chain ${id}, expected ${NET.id}`);
}
