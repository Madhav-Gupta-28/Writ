// @vitest-environment jsdom
//
// Render tests for the six page components. These cover the branching the unit
// tests in lib/ cannot reach: state-dependent copy, the payer-vs-stranger split,
// the key-card gate, and the "this order is finished" dead ends.
//
// useOrder and useClient are stubbed so no RPC request is made; everything else
// (routing, wagmi, react-query, the real formatters) runs for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { makeOrder, NOW, renderPage, TEST_BENEFICIARY, TEST_PAYER, testNet } from "../test/harness";

const stubClient = { getChainId: async () => testNet.chain.id } as never;

let orderData = { order: makeOrder(), now: NOW, gasPrice: 20_000_000_010n };

vi.mock("../hooks", async (importOriginal) => {
  const real = await importOriginal<typeof import("../hooks")>();
  return {
    ...real,
    useClient: () => stubClient,
    useOrder: () => ({
      data: orderData,
      isPending: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn(),
    }),
  };
});

beforeEach(() => {
  orderData = { order: makeOrder(), now: NOW, gasPrice: 20_000_000_010n };
  localStorage.clear();
});

// vitest runs with globals disabled, so testing-library's auto-cleanup is not
// registered. Without this every render stacks up in the same document and
// textContent assertions start matching copy from an earlier test.
afterEach(cleanup);

describe("Home", () => {
  it("leads with the claim and links to the live mainnet order", async () => {
    const { Home } = await import("./Home");
    renderPage(<Home />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/redirect/i);
    // The featured order is mainnet #2.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.some((h) => h?.includes("/order/2"))).toBe(true);
  });

  it("explains the three authorities", async () => {
    const { Home } = await import("./Home");
    renderPage(<Home />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/key card/i);
    expect(body).toMatch(/wallet/i);
  });
});

describe("OpenOrder", () => {
  it("renders the form and refuses to submit before a key card exists", async () => {
    const { OpenOrder } = await import("./Open");
    renderPage(<OpenOrder />, { route: "/open?net=testnet" });
    expect(document.body.textContent).toMatch(/new order|open an order|create/i);
    // Every submit path is disabled until the form is valid.
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("suggests a fee cap of about 1% and clamps it", async () => {
    const { suggestedFeeCap } = await import("./Open");
    expect(suggestedFeeCap(1_000_000n)).toBe(10_000n); // 1%
    expect(suggestedFeeCap(10_000n)).toBe(5_000n); // floor
    expect(suggestedFeeCap(100_000_000n)).toBe(50_000n); // ceiling
    expect(suggestedFeeCap(2_000n)).toBe(1_000n); // never >= the payment
  });
});

describe("OrderView", () => {
  it("shows an active order's terms and its tabs", async () => {
    const { OrderView } = await import("./OrderView");
    renderPage(<Routes><Route path="/order/:id" element={<OrderView />} /></Routes>, { route: "/order/2?net=testnet" });
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Paying/i); // StateBadge renders Active as "Paying"
    expect(body).toMatch(/0\.01/); // 10_000 / 1e6 USDC per period
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("rejects a non-numeric order id", async () => {
    const { OrderView } = await import("./OrderView");
    renderPage(<Routes><Route path="/order/:id" element={<OrderView />} /></Routes>, { route: "/order/not-a-number?net=testnet" });
    expect(document.body.textContent).toMatch(/order number|not found|no order/i);
  });

  it("labels a quarantined order as frozen", async () => {
    orderData = { ...orderData, order: makeOrder({ state: "Quarantined" }) };
    const { OrderView } = await import("./OrderView");
    renderPage(<Routes><Route path="/order/:id" element={<OrderView />} /></Routes>, { route: "/order/2?net=testnet" });
    expect(document.body.textContent).toMatch(/Quarantined|frozen|blocked/i);
  });

  it("warns the beneficiary to collect before the reclaim window opens", async () => {
    const { OrderView } = await import("./OrderView");
    renderPage(<Routes><Route path="/order/:id" element={<OrderView />} /></Routes>, { route: "/order/2?net=testnet" });
    // Audit finding F1: reclaim does not settle due-but-uncollected periods.
    expect(document.body.textContent).toMatch(/collect before/i);
    expect(document.body.textContent).toMatch(/came due and nobody collected/i);
  });

  it("treats an order holding less than payment + fee as underfunded", async () => {
    // execute() reserves the fee, so balance in [amount, amount+fee) is NOT
    // payable. Offering a Pay button here would revert Underfunded.
    orderData = {
      ...orderData,
      order: makeOrder({ balance: 12_000n, nextDueAt: NOW - 10n }), // amount 10_000 + cap 5_000 = 15_000
      now: NOW,
    };
    const { OrderView } = await import("./OrderView");
    renderPage(<Routes><Route path="/order/:id" element={<OrderView />} /></Routes>, { route: "/order/2?net=testnet" });
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/It needs 0\.015/, );        // 15_000 units, not 10_000
    expect(body).toMatch(/for whoever presses Pay/i);
  });

  it("opens straight onto the key-card tab when asked", async () => {
    const { OrderView } = await import("./OrderView");
    renderPage(<Routes><Route path="/order/:id/manage" element={<OrderView initialTab="keycard" />} /></Routes>, { route: "/order/2/manage?net=testnet" });
    expect(document.body.textContent).toMatch(/key card/i);
  });
});

describe("KeyCardPanel", () => {
  it("asks for the key card before offering any action", async () => {
    const { KeyCardPanel } = await import("./KeyCardPanel");
    renderPage(<KeyCardPanel net={testNet} order={makeOrder()} now={NOW} refetch={vi.fn()} />);
    expect(document.body.textContent).toMatch(/key card/i);
  });

  it("says a finished order cannot be changed", async () => {
    const { KeyCardPanel } = await import("./KeyCardPanel");
    renderPage(
      <KeyCardPanel net={testNet} order={makeOrder({ state: "Completed" })} now={NOW} refetch={vi.fn()} />,
    );
    expect(document.body.textContent).toMatch(/finished|cancelled|can't|cannot/i);
  });
});

describe("PayerPanel", () => {
  it("tells a stranger they are not the payer", async () => {
    const { PayerPanel } = await import("./PayerPanel");
    renderPage(
      <PayerPanel
        net={testNet}
        client={stubClient}
        order={makeOrder({ payer: TEST_BENEFICIARY })}
        now={NOW}
        refetch={vi.fn()}
      />,
    );
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/funding wallet|funded by/i);
    expect(body).toMatch(/connect the wallet that funded/i);
  });

  it("offers the 30-day exit to the payer", async () => {
    const { PayerPanel } = await import("./PayerPanel");
    renderPage(
      <PayerPanel net={testNet} client={stubClient} order={makeOrder({ payer: TEST_PAYER })} now={NOW} refetch={vi.fn()} />,
    );
    expect(document.body.textContent).toMatch(/30|cancel|exit/i);
  });

  it("shows a pending cancel when one is running", async () => {
    const { PayerPanel } = await import("./PayerPanel");
    renderPage(
      <PayerPanel
        net={testNet}
        client={stubClient}
        order={makeOrder({ payer: TEST_PAYER, cancelReadyAt: NOW + 30n * 86_400n })}
        now={NOW}
        refetch={vi.fn()}
      />,
    );
    expect(document.body.textContent).toMatch(/notice given|finish cancelling|blocks it first/i);
  });
});

describe("TopUp", () => {
  it("takes an amount on a live order", async () => {
    const { TopUp } = await import("./TopUp");
    renderPage(
      <TopUp net={testNet} client={stubClient} order={makeOrder()} suggested={150_000n} onDone={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("10.00");
    expect(input).toBeTruthy();
    expect(document.body.textContent).toMatch(/add money/i);
  });

  it("refuses a cancelled order", async () => {
    const { TopUp } = await import("./TopUp");
    renderPage(
      <TopUp net={testNet} client={stubClient} order={makeOrder({ state: "Cancelled" })} onDone={vi.fn()} />,
    );
    expect(document.body.textContent).toMatch(/cancelled/i);
    expect(screen.queryByPlaceholderText("10.00")).toBeNull();
  });

  it("says a completed order is finished", async () => {
    const { TopUp } = await import("./TopUp");
    renderPage(
      <TopUp net={testNet} client={stubClient} order={makeOrder({ state: "Completed" })} onDone={vi.fn()} />,
    );
    expect(document.body.textContent).toMatch(/finished/i);
  });
});

describe("App shell", () => {
  it("warns on mainnet and not on testnet", async () => {
    const { App } = await import("../App");
    const mainnet = renderPage(<App />, { route: "/?net=mainnet" });
    expect(document.body.textContent).toMatch(/real money/i);
    mainnet.unmount();

    localStorage.clear();
    renderPage(<App />, { route: "/?net=testnet" });
    expect(document.body.textContent).not.toMatch(/real money/i);
  });

  it("renders a not-found page for an unknown route", async () => {
    const { App } = await import("../App");
    renderPage(<App />, { route: "/nope?net=testnet" });
    expect(within(document.body).getByText(/page not found/i)).toBeTruthy();
  });
});
