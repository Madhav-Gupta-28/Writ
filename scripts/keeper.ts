// Keeper: pays a Writ order whenever a period comes due.
//
// Writ needs no keeper by design — execute is permissionless and reimburses the
// caller's gas plus a capped tip, so a stranger is paid to do it. But Arc has no
// searcher ecosystem yet, so an unattended demo order silently falls behind and
// reads as "the product doesn't work". This closes that gap until there is
// someone else to do it.
//
// Usage:
//   node --env-file=.env scripts/keeper.ts --id 4                   # testnet, loop
//   node --env-file=.env scripts/keeper.ts --mainnet --id 2         # mainnet, loop
//   node --env-file=.env scripts/keeper.ts --mainnet --id 2 --once  # one pass, for cron
//
// --once exits after a single pass, so it can run under cron:
//   */30 * * * * cd /path/to/writ && node --env-file=.env scripts/keeper.ts --mainnet --id 2 --once

import {
  CHAIN_ID, EXPLORER, assertChain, clock, link, now, obligation, payer, pub,
  requireWrit, send, sleep, usd,
} from "./arc.ts";

const ONCE = process.argv.includes("--once");
const idArg = process.argv[process.argv.indexOf("--id") + 1];
const ID = BigInt(idArg ?? "0");
if (!ID) throw new Error("pass --id <orderId>");

/** Seconds between polls when looping. A period is at least an hour (MIN_PERIOD). */
const POLL_SECONDS = 60;

async function pass(): Promise<"paid" | "waiting" | "stop"> {
  const o = await obligation(ID);

  if (o.state !== "Active") {
    console.log(`order #${ID} is ${o.state} — nothing for a keeper to do.`);
    return "stop";
  }

  const t = await now();
  if (t < o.nextDueAt) {
    const mins = Number(o.nextDueAt - t) / 60;
    console.log(`${clock(t)}  not due for ${mins.toFixed(1)} min (next ${clock(o.nextDueAt)})`);
    return "waiting";
  }

  // The contract reserves the fee, so a payable period always pays the caller.
  const need = o.amountPerPeriod + o.maxExecutorFee;
  if (o.balance < need) {
    console.log(
      `${clock(t)}  order #${ID} underfunded: balance ${usd(o.balance)} < ${usd(need)} ` +
        `(payment + reserved fee). Top it up with scripts/open-order.ts or the web app.`,
    );
    return "stop";
  }

  const before = await pub.getBalance({ address: payer.address });
  const { hash, receipt } = await send("execute", [ID]);
  const after = await pub.getBalance({ address: payer.address });

  // Gas is paid in USDC and the fee is reimbursed in USDC, so the delta is the
  // executor's actual profit. It should be positive; if it is not, the tip is
  // too small for current gas and the order needs a higher maxExecutorFee.
  const net = after - before;
  console.log(
    `${clock(t)}  paid period ${Number(o.periodsPaid) + 1} of order #${ID} — ` +
      `gas ${receipt.gasUsed}, net ${net >= 0n ? "+" : ""}${(Number(net) / 1e18).toFixed(6)} USDC`,
  );
  console.log(`            ${link(hash)}`);
  return "paid";
}

async function main() {
  await assertChain();
  const writ = requireWrit();
  console.log(`keeper on chain ${CHAIN_ID}, Writ ${writ}, order #${ID}, as ${payer.address}`);
  console.log(`${EXPLORER}/address/${writ}\n`);

  for (;;) {
    let r: "paid" | "waiting" | "stop";
    try {
      r = await pass();
    } catch (e) {
      // A dropped RPC request must not kill a long-running keeper.
      console.error(`pass failed: ${(e as Error).message}`);
      r = "waiting";
    }
    if (ONCE || r === "stop") return;
    // After a payment, loop straight back: a neglected order may owe several
    // periods, and execute pays exactly one per call.
    if (r !== "paid") await sleep(POLL_SECONDS * 1000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
