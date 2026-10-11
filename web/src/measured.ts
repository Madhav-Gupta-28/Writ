// Every number the site states, in one place, with where it was measured.
//
// Gas figures are from receipts of real Writ transactions on Arc MAINNET
// (chain 5042) against the deployed contract 0x9701…a3db, all at 21 gwei (the
// 20 gwei floor plus a 1 gwei tip, §3.2). Cost = gas × 21 gwei, in USDC
// (gas is paid in USDC on Arc).
//
// Re-measured 2026-10-12 after the redeploy that put the fee reservation
// (§5.4) on chain, so every figure below and the verified source now describe
// the same bytecode. The previous deployment, 0xFF70…5652, is superseded.

export interface Measured {
  gas: number;
  usd: string;     // the cost as paid, from the receipt
  tx: `0x${string}`;
  what: string;    // what the transaction was
}

/** One payment: `execute` on live order #2 (its first payment, 2026-10-07). */
export const EXECUTE: Measured = {
  gas: 125_895,
  usd: "$0.0026",
  tx: "0xd9044d50ad0d879d142b855c8ec8e646a647e3749879ca8848200a6277a1af12",
  what: "execute, order #1",
};

/**
 * A key-card action, verified on-chain by Arc's post-quantum precompile
 * (`rotateKey` on live order #1, 2026-10-12). Rotation is the action measured
 * because it is the only PQ action that leaves the payment schedule untouched,
 * so the live order kept running while the figure was taken.
 */
export const PQ_ACTION: Measured = {
  gas: 398_989,
  usd: "$0.0084",
  tx: "0xed7c7e26aff4bafea5ce7625a985023b21c5376fd3f44fab5423b19abae0b9b3",
  what: "key card rotation, verified on-chain",
};

/** Open + fund in one transaction (`openWithAuthorization`, order #1). */
export const OPEN: Measured = {
  gas: 285_555,
  usd: "$0.0060",
  tx: "0x48bfe9ce5daa9b29d406b047099199fda855c116bdba6713788ba3fb9ded0297",
  what: "open order #1",
};

/**
 * Tests passing as of 2026-10-12, as each runner reports them: 123 Solidity
 * local (Foundry's count, which reports the invariant suite as one test), 7
 * against live Arc (skipped by a plain `forge test`), 22 TypeScript parity,
 * 64 web. Update when the suites change.
 */
export const TESTS = { total: 216, live: 7, asOf: "2026-10-12" };

/** SLH-DSA-SHA2-128s signature size (FIPS 205; §3.4). */
export const SIG_BYTES = "7,856";

export const fmtGas = (n: number) => n.toLocaleString("en-US");
