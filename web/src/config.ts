// The one place that knows about networks. Testnet is the default while we
// build; a page can be opened on mainnet with ?net=mainnet (the choice is
// remembered per browser).

import { defineChain, type Address, type Chain } from "viem";
import { createConfig, http, injected } from "wagmi";

export type NetworkName = "testnet" | "mainnet";

export const DEFAULT_NETWORK: NetworkName = "mainnet";

export interface Network {
  name: NetworkName;
  label: string;
  chain: Chain;
  writ: Address;
  explorer: string;
  rpc: string;
  /** A real, running order worth showing people (null if none yet). */
  featuredOrder: bigint | null;
}

const usdcNative = { name: "USDC", symbol: "USDC", decimals: 18 } as const; // gas is USDC (§3.2)

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: usdcNative,
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
  testnet: true,
});

export const arcMainnet = defineChain({
  id: 5042,
  name: "Arc",
  nativeCurrency: usdcNative,
  rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.arc.io" } },
});

export const NETWORKS: Record<NetworkName, Network> = {
  testnet: {
    name: "testnet",
    label: "Arc Testnet",
    chain: arcTestnet,
    writ: "0x720859E699B82b176e28C5182095d8FA9Bc94C87", // deployments/arc-testnet.json
    explorer: "https://explorer.testnet.arc.io",
    rpc: "https://rpc.testnet.arc.io",
    featuredOrder: 4n,
  },
  mainnet: {
    name: "mainnet",
    label: "Arc Mainnet",
    chain: arcMainnet,
    writ: "0xFF70bc435C29400Fe5c988B92dcc6c17d98B5652", // deployments/arc-mainnet.json
    explorer: "https://explorer.arc.io",
    rpc: "https://rpc.mainnet.arc.io",
    featuredOrder: 2n,
  },
};

export const USDC: Address = "0x3600000000000000000000000000000000000000";

/** EIP-712 domain of Arc's USDC (FiatTokenV2), verified on both networks. */
export const usdcDomain = (n: Network) =>
  ({ name: "USDC", version: "2", chainId: n.chain.id, verifyingContract: USDC }) as const;

export const MIN_PERIOD = 3600n;
export const MAX_PERIOD = 365n * 86400n;
export const RECLAIM_GRACE = 30n * 86400n;
export const WALLET_CANCEL_DELAY = 30n * 86400n;
export const EXECUTOR_TIP = 10_000n; // 0.01 USDC, 6dp
export const REIMBURSE_OVERHEAD = 30_000n;
export const EXECUTE_GAS = 125_696n; // measured on Arc testnet, ARCHITECTURE.md §6.1

/**
 * This app is mainnet-only.
 *
 * It used to offer a network switcher. A judge opening the site landed on
 * testnet by default and saw play money, which undersells the one fact worth
 * selling: the contract is deployed, funded and running on Arc mainnet. A
 * chooser also asks a visitor to make a decision before they know what the
 * product is.
 *
 * The testnet entry stays in NETWORKS because the test harness and the deploy
 * scripts target it, but nothing in the UI can reach it, and `?net=testnet` is
 * ignored rather than honoured.
 */
export function networkFromUrl(_search: string): NetworkName {
  return "mainnet";
}

export const wagmiConfig = createConfig({
  chains: [arcTestnet, arcMainnet],
  connectors: [injected()], // injected wallet only
  transports: {
    [arcTestnet.id]: http("https://rpc.testnet.arc.io", { retryCount: 4 }),
    [arcMainnet.id]: http("https://rpc.mainnet.arc.io", { retryCount: 4 }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export type ChainId = typeof arcTestnet.id | typeof arcMainnet.id;
/** The network's chain id, typed for wagmi. */
export const chainIdOf = (n: Network) => n.chain.id as ChainId;
