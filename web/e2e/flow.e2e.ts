// End-to-end test of the web app in a real Chrome, against Arc TESTNET with
// real transactions. A test wallet is injected as window.ethereum; every
// request it receives is answered by Node (page.exposeFunction), so the
// private key from ../.env stays in this Node process and never enters the page.
//
// The wallet starts on Ethereum (chain 1), so the "add Arc network" path runs.
// Also loads mainnet order #2 read-only. Screenshots go to e2e/out/.
//
// Usage (from web/): npm run build && node --env-file=../.env e2e/flow.e2e.ts
//   needs Google Chrome installed (found automatically on macOS/Windows/Linux;
//   set CHROME_PATH to override).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { chromium, type Page } from "playwright-core";
import { createPublicClient, createWalletClient, hexToBigInt, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "../src/config.ts";

const OUT = new URL("./out/", import.meta.url);
const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
// Chrome lives somewhere different on each OS. CHROME_PATH overrides; otherwise
// take the first of the usual locations that actually exists.
const CHROME_CANDIDATES: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  win32: [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = CHROME_CANDIDATES[process.platform] ?? [];
  const found = candidates.find((p) => existsSync(p));
  if (found) return found;
  throw new Error(
    `Could not find Chrome on ${process.platform}. Looked in:\n` +
      candidates.map((p) => `  ${p}`).join("\n") +
      `\nInstall Google Chrome, or set CHROME_PATH to the executable.`,
  );
}

const CHROME = findChrome();
const PASSWORD = "e2e test password 123";

const pk = process.env.PRIVATE_KEY?.trim();
if (!pk) throw new Error("PRIVATE_KEY missing (run with node --env-file=../.env)");
const account = privateKeyToAccount((pk.startsWith("0x") ? pk : `0x${pk}`) as Hex);
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 4 }) });
const walletClient = createWalletClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 4 }), account });

let chainId = 1; // start on the "wrong" network
const added = new Set<number>([1]);
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
let shot = 0;
const snap = async (page: Page, name: string) => page.screenshot({ path: new URL(`${String(++shot).padStart(2, "0")}-${name}.png`, OUT).pathname.slice(1), fullPage: true });

async function walletRequest(page: Page, method: string, params: unknown[] = []): Promise<unknown> {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return `0x${chainId.toString(16)}`;
    case "net_version":
      return String(chainId);
    case "wallet_switchEthereumChain": {
      const id = Number((params[0] as { chainId: string }).chainId);
      if (!added.has(id)) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      chainId = id;
      await page.evaluate((c) => (window as unknown as { __emit: (e: string, v: unknown) => void }).__emit("chainChanged", c), `0x${id.toString(16)}`);
      return null;
    }
    case "wallet_addEthereumChain": {
      const p = params[0] as { chainId: string; chainName: string; rpcUrls: string[] };
      const id = Number(p.chainId);
      if (id !== arcTestnet.id) throw Object.assign(new Error(`test wallet only adds Arc testnet, got ${id}`), { code: 4001 });
      log(`wallet: added network "${p.chainName}" (${id}) rpc ${p.rpcUrls?.[0]}`);
      added.add(id);
      chainId = id;
      await page.evaluate((c) => (window as unknown as { __emit: (e: string, v: unknown) => void }).__emit("chainChanged", c), `0x${id.toString(16)}`);
      return null;
    }
    case "eth_signTypedData_v4": {
      const typed = JSON.parse(params[1] as string);
      const { EIP712Domain: _drop, ...types } = typed.types;
      void _drop;
      return account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message });
    }
    case "eth_sendTransaction": {
      if (chainId !== arcTestnet.id) throw new Error("test wallet only sends on Arc testnet");
      const t = params[0] as Record<string, Hex | undefined>;
      const hash = await walletClient.sendTransaction({
        to: t.to as Hex, data: t.data, value: t.value ? hexToBigInt(t.value) : 0n,
        ...(t.gas && { gas: hexToBigInt(t.gas) }),
        ...(t.maxFeePerGas && { maxFeePerGas: hexToBigInt(t.maxFeePerGas) }),
        ...(t.maxPriorityFeePerGas && { maxPriorityFeePerGas: hexToBigInt(t.maxPriorityFeePerGas) }),
      });
      log(`wallet: sent ${hash}`);
      return hash;
    }
    default:
      if (chainId !== arcTestnet.id) throw new Error(`test wallet: ${method} on chain ${chainId}`);
      return pub.request({ method: method as never, params: params as never });
  }
}

const INJECT = `
  (() => {
    const listeners = {};
    window.__emit = (ev, v) => (listeners[ev] || []).forEach((f) => f(v));
    window.ethereum = {
      isE2ETestWallet: true,
      request: ({ method, params }) => window.__walletRequest(method, params || []).catch((e) => {
        const err = new Error(e && e.message ? e.message : String(e));
        const m = /code (\\d+)/.exec(String(e && e.message));
        if (m) err.code = Number(m[1]);
        if (String(e && e.message).includes("Unrecognized chain ID")) err.code = 4902;
        throw err;
      }),
      on: (ev, f) => { (listeners[ev] = listeners[ev] || []).push(f); },
      removeListener: (ev, f) => { listeners[ev] = (listeners[ev] || []).filter((g) => g !== f); },
    };
  })();
`;

const field = (page: Page, label: string) =>
  page.locator(`label.field:has(> span.field-label:text-is("${label}")) :is(input,select)`).first();

async function waitStatus(page: Page, okText: RegExp, timeout = 180_000) {
  const ok = page.locator(".status.ok", { hasText: okText }).last();
  const err = page.locator(".status.error").last();
  await Promise.race([ok.waitFor({ timeout }), err.waitFor({ timeout }).then(async () => { throw new Error(`UI error: ${await err.innerText()}`); })]);
  return ok.innerText();
}

async function createKeyCard(page: Page, scope: string, file: string) {
  const s = page.locator(scope);
  await s.getByRole("button", { name: "Create my key card" }).click();
  await field(page, "Password").fill(PASSWORD);
  await field(page, "Repeat password").fill(PASSWORD);
  const dl = page.waitForEvent("download");
  await s.getByRole("button", { name: "Encrypt and download" }).click();
  const d = await dl;
  const path = new URL(file, OUT).pathname.slice(1);
  await d.saveAs(path);
  log(`key card downloaded as ${d.suggestedFilename()} -> e2e/out/${file}`);
  // The app refuses to continue until the saved file is uploaded and unlocked.
  await s.locator('input[type="file"]').setInputFiles(path);
  await s.locator('label.field:has(> span.field-label:text-is("Password")) input').last().fill(PASSWORD);
  await s.getByRole("button", { name: "Check my key card" }).click();
  await s.getByText("Key card saved and checked").waitFor({ timeout: 60_000 });
  return path;
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1200, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => log(`PAGE ERROR: ${e.message}`));
    await page.exposeFunction("__walletRequest", (m: string, p: unknown[]) => walletRequest(page, m, p));
    await page.addInitScript(INJECT);

    // ---- Home, desktop + mobile
    await page.goto(`${BASE}/`);
    await page.getByRole("heading", { name: /a hacker can.t redirect/i }).waitFor();
    await snap(page, "home");
    const mobile = await ctx.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${BASE}/`);
    await snap(mobile, "home-mobile");
    log("home renders (desktop + mobile)");

    // ---- Mainnet order #2, read-only
    await mobile.goto(`${BASE}/order/2?net=mainnet`);
    await mobile.getByRole("heading", { name: "Order #2" }).waitFor({ timeout: 30_000 });
    await mobile.getByText("You're on Arc mainnet").waitFor();
    log(`mainnet order #2: ${(await mobile.locator(".pays").innerText()).replace(/\s+/g, " ")}`);
    await snap(mobile, "mainnet-order-2-mobile");
    await mobile.close();

    // ---- Open on testnet: connect (wallet on chain 1 -> app switches/adds Arc)
    await page.goto(`${BASE}/open?net=testnet`);
    await page.locator(".step-card").first().getByRole("button", { name: "Connect wallet" }).click();
    const sw = page.getByRole("button", { name: /Switch to Arc Testnet/ }).first();
    if (await sw.isVisible({ timeout: 5000 }).catch(() => false)) await sw.click();
    await page.getByText("Connected to Arc Testnet").waitFor({ timeout: 30_000 });
    log("wallet connected; Arc testnet added and selected");
    await snap(page, "open-connected");

    // Form is locked until the key card is saved and checked
    if (!(await field(page, "Recipient address").isDisabled())) throw new Error("form should be disabled before the key card is saved");
    await createKeyCard(page, ".open-layout .step-card:nth-child(2)", "keycard1.json");
    await snap(page, "open-keycard-saved");

    const A = privateKeyToAccount(generatePrivateKey()).address;
    const B = privateKeyToAccount(generatePrivateKey()).address;
    await field(page, "Recipient address").fill(A);
    await field(page, "Amount per payment (USDC)").fill("0.01");
    await field(page, "How often").selectOption({ label: "Every hour" });
    // First payment: the default "as soon as possible" (about 2 minutes)
    const pad = (n: number) => String(n).padStart(2, "0");
    const end = new Date(Date.now() + 2 * 86400_000);
    await field(page, "Last payment on or before").fill(`${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`);
    await page.locator(".summary-card").waitFor();
    log(`summary: ${(await page.locator(".summary-list").innerText()).replace(/\s+/g, " ")}`);
    await snap(page, "open-form");
    await page.getByRole("button", { name: "Sign and create order" }).click();
    const opened = await waitStatus(page, /is open and funded/);
    const id = /Order #(\d+)/.exec(opened)![1];
    log(`OPENED order #${id}: ${opened}`);
    await snap(page, "open-done");

    // ---- Order view: wait until due, execute
    await page.getByRole("link", { name: `Go to order #${id}` }).click();
    await page.getByRole("heading", { name: `Order #${id}` }).waitFor();
    await snap(page, "order-not-due");
    log(`order view: next payment in ${await page.locator(".countdown").innerText()}`);

    // Hijack demo: the connected wallet (which funded this order) tries to take it over.
    await page.getByRole("button", { name: "Try to hijack" }).click();
    await page.locator(".result-blocked").waitFor({ timeout: 60_000 });
    log(`HIJACK: ${(await page.locator(".result-blocked").innerText()).replace(/\s+/g, " ")}`);
    await snap(page, "order-hijack-blocked");

    await page.locator(".countdown.due").waitFor({ timeout: 300_000 });
    log(`due: ${(await page.locator(".reward").innerText()).replace(/\s+/g, " ")}`);
    await snap(page, "order-due");
    await page.getByRole("button", { name: "Pay now" }).click();
    log(`EXECUTE: ${await waitStatus(page, /You earned/)}`);
    await snap(page, "order-executed");

    // ---- Manage: unlock, amend to B
    await page.goto(`${BASE}/order/${id}/manage?net=testnet`);
    await page.locator('input[type="file"]').setInputFiles(new URL("keycard1.json", OUT).pathname.slice(1));
    await field(page, "Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock key card" }).click();
    await page.getByText(/Key card unlocked/).waitFor({ timeout: 60_000 });
    await snap(page, "manage-unlocked");
    await field(page, "Recipient").fill(B);
    await page.getByRole("button", { name: "Sign and update order" }).click();
    log(`AMEND: ${await waitStatus(page, /Order updated/)}`);
    await snap(page, "manage-amended");

    // ---- Payer: begin wallet cancel
    await page.goto(`${BASE}/order/${id}/payer?net=testnet`);
    await page.getByText("You're connected as the funding wallet.").waitFor({ timeout: 30_000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Start notice" }).click();
    log(`BEGIN WALLET CANCEL: ${await waitStatus(page, /Notice started/)}`);
    await snap(page, "payer-notice");

    // ---- Manage: veto, rotate, then cancel with the NEW key card
    await page.goto(`${BASE}/order/${id}/manage?net=testnet`);
    await page.locator('input[type="file"]').setInputFiles(new URL("keycard1.json", OUT).pathname.slice(1));
    await field(page, "Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock key card" }).click();
    await page.getByRole("tab", { name: "Block cancellation" }).click();
    await page.getByRole("button", { name: "Sign and block cancellation" }).click();
    log(`VETO: ${await waitStatus(page, /Cancellation blocked/)}`);

    await page.getByRole("tab", { name: "Replace key card" }).click();
    await createKeyCard(page, ".tab-panel", "keycard2.json");
    await page.getByRole("button", { name: "Sign handover to the new key card" }).click();
    log(`ROTATE: ${await waitStatus(page, /only the new key card/)}`);
    if (await page.getByRole("button", { name: "Sign handover to the new key card" }).count()) throw new Error("handover button still shown after rotating");
    await snap(page, "manage-rotated");

    // the OLD key card must now be refused, with a readable message
    await page.goto(`${BASE}/order/${id}/manage?net=testnet`);
    await page.locator('input[type="file"]').setInputFiles(new URL("keycard1.json", OUT).pathname.slice(1));
    await field(page, "Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock key card" }).click();
    const refused = await page.locator(".status.error").innerText({ timeout: 60_000 });
    log(`OLD KEY CARD REFUSED: ${refused}`);
    await snap(page, "manage-old-card-refused");

    await page.reload();
    await page.locator('input[type="file"]').setInputFiles(new URL("keycard2.json", OUT).pathname.slice(1));
    await field(page, "Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Unlock key card" }).click();
    await page.getByRole("tab", { name: "Cancel order" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Sign and cancel order" }).click();
    log(`CANCEL: ${await waitStatus(page, /Order cancelled/)}`);

    await page.goto(`${BASE}/order/${id}?net=testnet`);
    await page.locator(".badge-cancelled").waitFor({ timeout: 30_000 });
    await snap(page, "order-cancelled");
    log(`final: ${(await page.locator(".metrics").innerText()).replace(/\s+/g, " ")}`);
    log("E2E PASSED");
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error("\nE2E FAILED:", e);
  process.exit(1);
});
