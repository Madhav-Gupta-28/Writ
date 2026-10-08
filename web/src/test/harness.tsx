// Test harness for the page components. The pages sit inside three providers
// (router, wagmi, react-query); this renders them with all three, against a
// wagmi config whose only connector is a mock account, so nothing touches a
// real wallet or a real RPC.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { http, createConfig } from "wagmi";
import { mock } from "wagmi/connectors";
import { WagmiProvider } from "wagmi";
import { arcMainnet, arcTestnet, NETWORKS, type Network } from "../config";
import type { Order } from "../lib/order";

export const TEST_PAYER = "0x4163CfEC8eC6cF2f59bB5706533bC3841f8eDb8e" as const;
export const TEST_BENEFICIARY = "0x1258B1672e410636B2330cB9e7e6370F43B6C6c5" as const;

/// A wagmi config with a mock connector. Transports point at the real URLs but
/// no test triggers a request: the pages under test take their data from props
/// or from a stubbed useOrder.
// config.ts augments wagmi's `Register` with the app's own config type, which
// pins every wagmi hook to that exact shape. A config built with the mock
// connector is structurally different, so it is cast back to the registered
// type: the hooks only ever read account/chain state, which is identical.
export const testWagmiConfig = createConfig({
  chains: [arcTestnet, arcMainnet],
  connectors: [mock({ accounts: [TEST_PAYER], features: { reconnect: true } })],
  transports: {
    [arcTestnet.id]: http(NETWORKS.testnet.rpc),
    [arcMainnet.id]: http(NETWORKS.mainnet.rpc),
  },
}) as unknown as typeof import("../config").wagmiConfig;

export function renderPage(ui: ReactElement, { route = "/" }: { route?: string } = {}): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false, gcTime: 0 } },
  });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <WagmiProvider config={testWagmiConfig}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </WagmiProvider>
    </MemoryRouter>,
  );
}

export const testNet: Network = NETWORKS.testnet;

/// Mirrors live mainnet order #2: 0.01 USDC/day, 0.005 fee cap, one payment made.
export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 2n,
    payer: TEST_PAYER,
    beneficiary: TEST_BENEFICIARY,
    amountPerPeriod: 10_000n,
    balance: 360_000n,
    maxExecutorFee: 5_000n,
    periodSeconds: 86_400n,
    nextDueAt: 1_791_469_678n,
    endTime: 1_793_491_200n,
    pqNonce: 0n,
    cancelReadyAt: 0n,
    periodsPaid: 1,
    state: "Active",
    pqKey: "0x753f6ff31afbce41bad1800da8f679ad8a3dd14e458fc65e0736c8404852a9e3",
    ref: "0x96ec75ca2ea686474edb5df7ce658e85c20080dfef031293b70fa6ebbccf70df",
    ...over,
  } as Order;
}

export const NOW = 1_791_462_525n; // a chain timestamp two hours before the order is due
