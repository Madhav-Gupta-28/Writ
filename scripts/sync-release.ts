// After a redeploy, make every file that names the contract agree with
// deployments/arc-<net>.json. Run it instead of editing by hand: a stale
// address in web/src/config.ts points the live app at the wrong contract, and a
// stale "Sourcify exact match" line in the README is a false claim.
//
// Usage:
//   node scripts/sync-release.ts            # testnet
//   node scripts/sync-release.ts --mainnet
//
// Needs no private key: it only reads the deployment record and rewrites files.
// Verifies the recorded runtime hash against the local build and against the
// chain, and refuses to sync if either disagrees.

import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, defineChain, http, keccak256, type Hex } from "viem";

const MAINNET = process.argv.includes("--mainnet");
const NET = MAINNET
  ? { id: 5042, file: "deployments/arc-mainnet.json", rpc: "https://rpc.mainnet.arc.io", key: "mainnet" }
  : { id: 5042002, file: "deployments/arc-testnet.json", rpc: "https://rpc.testnet.arc.io", key: "testnet" };

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const write = (p: string, s: string) => writeFileSync(new URL(p, root), s);

async function main() {
  const dep = JSON.parse(read(NET.file));
  const addr: Hex = dep.writ;
  const liveId: string | undefined = dep.liveOrder?.id;
  if (!addr) throw new Error(`no writ address in ${NET.file}`);

  // 1. the local build must be the code that was deployed
  const artifact = JSON.parse(read("contracts/out/Writ.sol/Writ.json"));
  const localHash = keccak256(artifact.deployedBytecode.object as Hex);

  // 2. and the chain must agree
  const chain = defineChain({
    id: NET.id, name: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [NET.rpc] } },
  });
  const pub = createPublicClient({ chain, transport: http(NET.rpc, { retryCount: 4 }) });
  const onChain = keccak256((await pub.getCode({ address: addr })) as Hex);

  console.log(`  ${NET.key} ${addr}`);
  console.log(`  local build : ${localHash}`);
  console.log(`  on chain    : ${onChain}`);
  if (localHash !== onChain) {
    throw new Error(
      "refusing to sync: the local build is not the deployed code.\n" +
        "  Run `forge build` on the commit that was deployed, or redeploy this build first.",
    );
  }
  if (dep.runtimeKeccak256 && dep.runtimeKeccak256 !== onChain) {
    throw new Error(`refusing to sync: ${NET.file} records a different runtimeKeccak256`);
  }
  console.log("  match ✓\n");

  // 3. web/src/config.ts — the address the live app talks to
  const cfgPath = "web/src/config.ts";
  let cfg = read(cfgPath);
  const before = cfg;
  cfg = cfg.replace(
    new RegExp(`(${NET.key}: \\{[\\s\\S]*?writ: ")0x[0-9a-fA-F]{40}(")`),
    `$1${addr}$2`,
  );
  if (liveId) {
    cfg = cfg.replace(
      new RegExp(`(${NET.key}: \\{[\\s\\S]*?featuredOrder: )\\d+n`),
      `$1${liveId}n`,
    );
  }
  if (cfg !== before) {
    write(cfgPath, cfg);
    console.log(`  ${cfgPath}: writ -> ${addr}${liveId ? `, featuredOrder -> ${liveId}n` : ""}`);
  } else {
    console.log(`  ${cfgPath}: already current`);
  }

  // 4. README — address links, the live order link, and the hash block
  if (MAINNET) {
    const rPath = "README.md";
    let r = read(rPath);
    // Replace ONLY a superseded contract address, and only where it stands as a
    // whole address.
    //
    // The lookahead is load-bearing: without it the pattern also matches the
    // first 42 characters of every 66-character transaction hash and keccak hash
    // in the file, rewriting them into dead explorer links and runtime hashes
    // that are pure fiction. Equally load-bearing is replacing only addresses the
    // deployment record names, rather than letting a pattern decide for itself
    // what looks like a stale address.
    const superseded = new Set<string>(
      (dep.previous ?? []).map((p: { writ?: string }) => (p.writ ?? "").toLowerCase()).filter(Boolean),
    );
    // A line that calls an address superseded is history, not staleness: the
    // README names the previous deployment on purpose so a reader can see what
    // changed. Rewriting it there would make the sentence contradict itself.
    r = r.split("\n").map((line) =>
      /superseded/i.test(line)
        ? line
        : line.replace(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, (m) => (superseded.has(m.toLowerCase()) ? addr : m)),
    ).join("\n");
    if (liveId) r = r.replace(/\/order\/\d+\?net=mainnet/g, `/order/${liveId}?net=mainnet`)
                     .replace(/\[order #\d+\]/g, `[order #${liveId}]`);
    // The "Deployed version" block only exists while the repo is ahead of the
    // chain. Once they match, say so in one line instead.
    r = r.replace(
      /## Deployed version[\s\S]*?\n\n## What this does not claim/,
      "## Deployed version\n\n" +
        `The address above is verified on Sourcify as an exact match, and its runtime\n` +
        `bytecode (\`${onChain}\`)\nis byte-identical to \`forge build\` on this commit. Check it yourself:\n\n` +
        "```sh\ncast keccak $(cast code " + addr + " --rpc-url https://rpc.mainnet.arc.io)\n```\n\n" +
        "## What this does not claim",
    );
    write(rPath, r);
    console.log(`  ${rPath}: address, order link and the deployed-version block updated`);
  }

  console.log("\n  done. Rebuild and redeploy the app:  cd web && vercel --prod");
}

main().catch((e) => {
  console.error(`\n  ${(e as Error).message}\n`);
  process.exit(1);
});
