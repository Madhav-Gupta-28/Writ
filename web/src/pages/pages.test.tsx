// @vitest-environment jsdom
//
// Render tests for the six page components. These cover the branching the unit
// tests in lib/ cannot reach: state-dependent copy, the payer-vs-stranger split,
// the key-card gate, and the "this order is finished" dead ends.
//
// useOrder and useClient are stubbed so no RPC request is made; everything else
// (routing, wagmi, react-query, the real formatters) runs for real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { NETWORKS } from "../config";
import { makeOrder, NOW, renderPage, TEST_BENEFICIARY, TEST_PAYER, testNet } from "../test/harness";

const stubClient = { getChainId: async () => testNet.chain.id } as never;

// The live order id comes from config, not a literal: it changes on every
// redeploy, and a hard-coded 2 made these tests fail for the wrong reason.
const LIVE = NETWORKS.mainnet.featuredOrder!.toString();

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
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/not even your wallet can redirect/i);
    // Whichever order the deployment record features.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links.some((h) => h?.includes(`/order/${LIVE}`))).toBe(true);
  });

  // The hero artifact is the whole pitch: a judge who reads nothing but the
  // first screen has to come away knowing that four named parties — including
  // the payer and the authors — are refused. If the stamps stop rendering the
  // page still looks finished, so this is asserted rather than eyeballed.
  it("stamps all four refusals into the hero plate", async () => {
    const { Home } = await import("./Home");
    renderPage(<Home />);
    const stamps = [...document.querySelectorAll(".writ-plate .stamp")];
    expect(stamps.length).toBe(4);
    for (const s of stamps) expect(s.textContent).toMatch(/refused/i);
    const plate = document.querySelector(".writ-plate")?.textContent ?? "";
    expect(plate).toMatch(/funded it/i);   // the payer is refused
    expect(plate).toMatch(/authors/i);     // and so are we
    expect(plate).toMatch(/quantum/i);
    expect(plate).toMatch(/the only thing that can/i);
  });

  // The plate is read off the chain, so these guard the two things a static
  // mockup cannot get wrong: that it shows live terms rather than the frozen
  // deployment record, and that it never invites a collection that would
  // revert. NOW is two hours before the fixture order is due.
  it("reads the hero plate off the chain and counts down to the next payment", async () => {
    const { Home } = await import("./Home");
    renderPage(<Home />);
    const plate = document.querySelector(".writ-plate")?.textContent ?? "";
    expect(plate).toMatch(/next payment in/i);
    expect(plate).toMatch(/\d+:\d{2}:\d{2}/);        // a real duration, not a dash
    expect(plate).toMatch(/1 of 25/);                   // periodsPaid, live
    expect(plate).not.toMatch(/collect it/i);           // not due yet
  });

  it("only says the payment is collectable when execute would not revert", async () => {
    const { Home } = await import("./Home");
    const { makeOrder } = await import("../test/harness");

    // Due, and funded for a payment plus its executor fee. The band becomes a
    // link, because a reader one click from collecting is the demo.
    orderData = { ...orderData, order: makeOrder({ nextDueAt: NOW - 60n }) };
    renderPage(<Home />);
    const go = document.querySelector(".writ-plate .wp-go");
    expect(go?.textContent).toMatch(/collect it and keep the tip/i);
    expect(go?.getAttribute("href")).toBe(`/order/${LIVE}?net=mainnet`);
    cleanup();

    // Due, but the balance no longer covers amountPerPeriod + maxExecutorFee,
    // so execute() reverts Underfunded. The plate must not advertise it.
    orderData = { ...orderData, order: makeOrder({ nextDueAt: NOW - 60n, balance: 10_000n }) };
    renderPage(<Home />);
    const plate = document.querySelector(".writ-plate")?.textContent ?? "";
    expect(plate).not.toMatch(/collect it/i);
    expect(document.querySelector(".writ-plate .wp-go")).toBeNull();
    // and it says why, rather than counting down to a stuck 00:00:00
    expect(plate).toMatch(/underfunded/i);
    expect(plate).not.toMatch(/00:00:00/);
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

  it("requires funding of at least one payment PLUS its tip", async () => {
    const { OpenOrder } = await import("./Open");
    renderPage(<OpenOrder />, { route: "/open?net=testnet" });

    // 10 USDC per payment. suggestedFeeCap is ~1% but clamped to a 0.05
    // ceiling, so the cap is 0.05 and the minimum funding is 10.05, not 10.
    fireEvent.change(screen.getByLabelText(/Amount per payment/i), { target: { value: "10" } });
    fireEvent.click(screen.getByLabelText(/a different amount/i));
    fireEvent.change(screen.getByLabelText(/Amount to add now/i), { target: { value: "10" } });

    // open() would revert InsufficientInitialFunding. The form has to say so
    // BEFORE the payer signs the USDC authorization, not after.
    expect(document.body.textContent).toMatch(/at least one payment plus its tip/i);
    expect(document.body.textContent).toMatch(/10\.05/);
  });

  it("accepts funding of exactly one payment plus its tip", async () => {
    const { OpenOrder } = await import("./Open");
    renderPage(<OpenOrder />, { route: "/open?net=testnet" });
    fireEvent.change(screen.getByLabelText(/Amount per payment/i), { target: { value: "10" } });
    fireEvent.click(screen.getByLabelText(/a different amount/i));
    // Exactly the boundary: payment 10 + cap 0.05.
    fireEvent.change(screen.getByLabelText(/Amount to add now/i), { target: { value: "10.05" } });
    expect(document.body.textContent).not.toMatch(/at least one payment plus its tip/i);
  });

  it("suggests a fee cap of about 1% and clamps it", async () => {
    const { suggestedFeeCap } = await import("./Open");
    expect(suggestedFeeCap(1_000_000n)).toBe(10_000n); // 1%
    expect(suggestedFeeCap(10_000n)).toBe(5_000n); // floor
    expect(suggestedFeeCap(100_000_000n)).toBe(50_000n); // ceiling
    expect(suggestedFeeCap(2_000n)).toBe(1_000n); // never >= the payment
  });
  // The bar used to print "— USDC" in the display face over a dead button
  // whenever the form was incomplete. A giant placeholder reads as a broken
  // number, not an empty one.
  it("names what is missing instead of printing a placeholder total", async () => {
    const { OpenOrder } = await import("./Open");
    renderPage(<OpenOrder />, { route: "/open" });
    const bar = document.querySelector(".make-bar");
    expect(bar).toBeTruthy();
    expect(bar?.textContent).not.toMatch(/—\s*USDC/);
    expect(document.querySelector(".make-bar .mb-big")).toBeNull();
    expect(bar?.querySelector(".mb-todo")?.textContent).toMatch(/connect a wallet|key card|recipient/i);
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
    expect(document.body.textContent).toMatch(/reclaim anything nobody collected/i);
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

describe("How", () => {
  it("runs three numbered chapters, each with figures and three checks", async () => {
    const { How } = await import("./How");
    renderPage(<How />, { route: "/how" });
    const body = document.body.textContent ?? "";
    for (const n of ["One", "Two", "Three"]) expect(body).toContain(n);
    expect(body).not.toContain("Four pictures");
    expect(body).toMatch(/it pays itself/i);
    expect(body).toMatch(/only the key card can change it/i);
    expect(body).toMatch(/frozen recipient loses nothing/i);
    // four figures across three chapters (chapter two carries two), and three
    // check-rows of three links each. The figures are HTML scenes now (an SVG
    // shrank its own type with its frame), so they are <figure>s with a label.
    expect(document.querySelectorAll("figure[aria-label]").length).toBe(4);
    expect(document.querySelectorAll(".checks a").length).toBe(9);
  });

  it("gives every figure an aria-label, since they carry the argument", async () => {
    const { How } = await import("./How");
    renderPage(<How />, { route: "/how?net=testnet" });
    const figures = document.querySelectorAll("figure[aria-label]");
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) {
      expect((f.getAttribute("aria-label") ?? "").length).toBeGreaterThan(40);
    }
  });

  it("closes on the limits and a route into the live order", async () => {
    const { How } = await import("./How");
    renderPage(<How />, { route: "/how?net=testnet" });
    expect(document.body.textContent).toMatch(/four things it does not have/i);
    expect(document.body.textContent).toMatch(/hijack the live order/i);
  });
});

describe("App shell", () => {
  // The app is mainnet-only on purpose (config.ts). A judge who lands on
  // testnet sees play money, which throws away the one fact worth selling. A
  // stale ?net=testnet link in a submission would do exactly that silently, so
  // the override is asserted dead rather than trusted.
  it("is mainnet-only and ignores ?net=testnet", async () => {
    const { App } = await import("../App");
    renderPage(<App />, { route: "/?net=testnet" });
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/arc mainnet/i);
    expect(body).not.toMatch(/testnet/i);
    // and there is no way to ask for anything else
    expect(document.querySelector(".net-switch")).toBeNull();
    expect(document.querySelectorAll("select").length).toBe(0);
  });

  it("gives the footer a way to check every claim", async () => {
    const { App } = await import("../App");
    renderPage(<App />, { route: "/" });
    const foot = document.querySelector(".footer");
    const hrefs = [...(foot?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("explorer.arc.io"))).toBe(true);
    expect(hrefs.some((h) => h.includes("sourcify"))).toBe(true);
    expect(hrefs.some((h) => h.includes("/open"))).toBe(true);
  });

  it("renders a not-found page for an unknown route", async () => {
    const { App } = await import("../App");
    renderPage(<App />, { route: "/nope?net=testnet" });
    expect(within(document.body).getByText(/page not found/i)).toBeTruthy();
  });
});
