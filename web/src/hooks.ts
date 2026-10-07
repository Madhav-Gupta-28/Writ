import { useCallback, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, type PublicClient } from "viem";
import { NETWORKS, networkFromUrl, type Network } from "./config";
import { humanError, type ErrorContext } from "./lib/errors";
import { readOrder, type Order } from "./lib/order";

/** The network this page is on (?net=, else remembered, else the default). */
export function useNetwork(): Network {
  const { search } = useLocation();
  return NETWORKS[networkFromUrl(search)];
}

const clients = new Map<number, PublicClient>();
/** A read-only client for the page's network, independent of the wallet. */
export function useClient(net: Network): PublicClient {
  return useMemo(() => {
    let c = clients.get(net.chain.id);
    if (!c) {
      c = createPublicClient({ chain: net.chain, transport: http(net.rpc, { retryCount: 4 }) }) as PublicClient;
      clients.set(net.chain.id, c);
    }
    return c;
  }, [net]);
}

/** The order plus the chain's current time, refreshed every 10 s. */
export function useOrder(net: Network, id: bigint | null) {
  const client = useClient(net);
  return useQuery({
    queryKey: ["order", net.name, id?.toString()],
    enabled: id !== null,
    refetchInterval: 10_000,
    queryFn: async (): Promise<{ order: Order; now: bigint; gasPrice: bigint }> => {
      const [order, block, gasPrice] = await Promise.all([
        readOrder(client, net.writ, id!),
        client.getBlock(),
        client.getGasPrice(),
      ]);
      return { order, now: block.timestamp, gasPrice };
    },
  });
}

export type TxStatus =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "done"; message: string; hash?: `0x${string}` }
  | { kind: "error"; message: string };

/** Run a multi-step action with a status line and human-readable errors. */
export function useAction() {
  const [status, setStatus] = useState<TxStatus>({ kind: "idle" });
  const run = useCallback(
    async (fn: (step: (label: string) => void) => Promise<{ message: string; hash?: `0x${string}` } | void>, ctx: ErrorContext = {}) => {
      try {
        setStatus({ kind: "busy", label: "Working…" });
        const r = await fn((label) => setStatus({ kind: "busy", label }));
        setStatus(r ? { kind: "done", ...r } : { kind: "idle" });
        return true;
      } catch (e) {
        console.error(e);
        setStatus({ kind: "error", message: humanError(e, ctx) });
        return false;
      }
    },
    [],
  );
  const reset = useCallback(() => setStatus({ kind: "idle" }), []);
  return { status, run, reset, busy: status.kind === "busy" };
}

export function useParamId(raw: string | undefined): bigint | null {
  return useMemo(() => {
    if (!raw || !/^\d{1,30}$/.test(raw)) return null;
    const v = BigInt(raw);
    return v > 0n ? v : null;
  }, [raw]);
}
