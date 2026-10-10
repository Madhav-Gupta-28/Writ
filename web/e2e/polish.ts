// Visual audit: home, /how, /order/2 and /open in real Chrome, scrolled through like a
// reader (so scroll-reveal figures get their chance to run), then captured. Also
// a reduced-motion pass and a "first paint" shot of the hero. Flags horizontal
// overflow and figures still dimmed after scrolling.
//
// Usage (from web/): npm run build && node e2e/polish.ts [tag]
// Output: e2e/out/polish/<tag>/

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const TAG = process.argv[2] ?? "now";
const OUT = new URL(`./out/polish/${TAG}/`, import.meta.url);
const PORT = 4181;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const file = (n: string) => new URL(`${n}.png`, OUT).pathname.slice(1);

async function scrollThrough(page: Page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 300) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(2500); // let step animations finish
}

async function report(page: Page, name: string) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.documentElement.scrollWidth > vw + 1;
    // anything still faded after a full scroll is a bug
    const faded = [...document.querySelectorAll<SVGGElement | HTMLElement>("svg g[opacity], .rise, .wp-line, .wp-rule, .wp-total")]
      .filter((el) => {
        const o = el instanceof SVGElement ? Number(el.getAttribute("opacity") ?? "1") : Number(getComputedStyle(el).opacity);
        return o < 0.95;
      }).length;
    return { overflow, faded };
  });
  console.log(`${name}: overflow=${r.overflow} still-faded=${r.faded}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const runs = [
      { label: "desktop", viewport: { width: 1440, height: 900 }, motion: "no-preference" as const },
      { label: "mobile", viewport: { width: 375, height: 812 }, motion: "no-preference" as const },
      { label: "reduced", viewport: { width: 1440, height: 900 }, motion: "reduce" as const },
    ];
    for (const run of runs) {
      const ctx = await browser.newContext({ viewport: run.viewport, reducedMotion: run.motion, deviceScaleFactor: run.label === "mobile" ? 2 : 1 });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log(`PAGE ERROR (${run.label}): ${e.message}`));

      // first paint of the hero, before the chain read can land
      await page.goto(`${BASE}/`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: file(`${run.label}-home-firstpaint`) });

      for (const [name, path] of [["home", "/"], ["how", "/how"], ["order2", "/order/2"], ["open", "/open"]] as const) {
        await page.goto(`${BASE}${path}`);
        await page.waitForTimeout(1500);
        await scrollThrough(page);
        await report(page, `${run.label}-${name}`);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
        await page.screenshot({ path: file(`${run.label}-${name}`), fullPage: true });
      }

      if (run.label !== "reduced") {
        await page.goto(`${BASE}/order/2`);
        await page.getByRole("button", { name: /hijack/i }).first().click();
        await page.locator(".result-blocked, .result-open, .hijack-result, [role=status]").first().waitFor({ timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.screenshot({ path: file(`${run.label}-order2-hijack`), fullPage: true });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
