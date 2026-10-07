// Screenshots for design review: home, the live mainnet order (incl. the
// hijack simulation), and the open page, at desktop and mobile widths. No
// wallet is injected, like a first-time visitor. Output: e2e/out/screens/.
//
// Usage (from web/): npm run build && node e2e/screens.ts

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const OUT = new URL("./out/screens/", import.meta.url);
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const path = (n: string) => new URL(n, OUT).pathname.slice(1);

async function shoot(page: Page, name: string, full = true) {
  await page.waitForTimeout(400);
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }));
  if (sw > vw + 1) {
    const culprits = await page.evaluate((vw) => [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`), vw);
    console.log(`  OVERFLOW on ${name}: page is ${sw}px wide in a ${vw}px viewport; e.g. ${culprits.join(", ")}`);
  }
  if (full) await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path(`${name}.png`), fullPage: full });
  console.log(`saved ${name}.png`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]] as const) {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: label === "mobile" ? 2 : 1, colorScheme: "dark" });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log(`PAGE ERROR: ${e.message}`));

      await page.goto(`${BASE}/`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await shoot(page, `home-${label}`);

      await page.goto(`${BASE}/order/2?net=mainnet`);
      await page.waitForTimeout(150);
      await shoot(page, `order-loading-${label}`, false);
      await page.getByRole("heading", { name: "Order #2" }).waitFor({ timeout: 30_000 });
      await shoot(page, `order-${label}`);
      await page.getByRole("button", { name: "Try to hijack" }).click();
      await page.locator(".result-blocked, .result-open").waitFor({ timeout: 30_000 });
      await page.locator(".hijack-card").scrollIntoViewIfNeeded();
      await shoot(page, `order-hijack-${label}`);
      await page.getByRole("tab", { name: "Key card" }).click();
      await shoot(page, `order-tab-keycard-${label}`);

      await page.goto(`${BASE}/open`);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await shoot(page, `open-${label}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
