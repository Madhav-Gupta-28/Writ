// Deploy Writ and record it in deployments/arc-<testnet|mainnet>.json.
// Testnet by default; --mainnet prints MAINNET and waits 5 s before sending.
// Checks the deployed runtime bytecode equals the local build.
//
// Usage: node --env-file=.env scripts/deploy.ts [--mainnet]
// Then verify on Sourcify (see ARCHITECTURE.md §12.5).

import { writeFileSync } from "node:fs";
import { keccak256, type Hex } from "viem";
import {
  DEPLOYMENT_FILE, EXPLORER, MAINNET, NET, addressLink, assertChain, balanceOf, deployment, fees, link, payer, pub, usd,
  wallet, writAbi, writArtifact,
} from "./arc.ts";

async function main() {
  await assertChain();
  const before = await balanceOf(payer.address);
  console.log(`deployer ${payer.address} (${usd(before)}) on ${NET.name}`);

  const hash = await wallet.deployContract({
    abi: writAbi, bytecode: writArtifact.bytecode.object as Hex, ...(await fees()),
  } as never);
  console.log(`tx ${link(hash)}`);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deployment failed");
  const writ = receipt.contractAddress;

  const onChain = await pub.getCode({ address: writ });
  const local = writArtifact.deployedBytecode.object as Hex;
  if (onChain?.toLowerCase() !== local.toLowerCase()) throw new Error("deployed runtime bytecode != local build");

  const record = {
    chainId: NET.id,
    writ,
    deployTx: hash,
    deployBlock: Number(receipt.blockNumber),
    deployGas: Number(receipt.gasUsed),
    deployer: payer.address,
    runtimeKeccak256: keccak256(local),
    source: "contracts/src/Writ.sol as of the commit that adds this file (solc 0.8.30, via_ir, optimizer 200, evm prague)",
    explorer: EXPLORER,
    note: `${MAINNET ? "MAINNET. " : "Testnet. "}Runtime bytecode verified equal to the local forge build.`,
    ...(deployment ? { previous: [{ writ: deployment.writ, deployTx: deployment.deployTx }, ...(deployment.previous ?? [])] } : {}),
  };
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(record, null, 2) + "\n");

  console.log(`\nWrit deployed at ${writ}`);
  console.log(`  ${addressLink(writ)}`);
  console.log(`  gas ${receipt.gasUsed}, runtime keccak256 ${record.runtimeKeccak256}`);
  console.log(`  bytecode matches local build; recorded in ${NET.file}`);
  console.log(`  deployer balance ${usd(before)} -> ${usd(await balanceOf(payer.address))}`);
}

main().catch((e) => {
  console.error("\nDEPLOY FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
