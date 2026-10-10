// Every number the site states, in one place, with where it was measured.
//
// Gas figures are from receipts of real Writ transactions on Arc MAINNET
// (chain 5042) against the deployed contract 0xFF70…5652, all at 21 gwei (the
// 20 gwei floor plus a 1 gwei tip, §3.2). Cost = gas × 21 gwei, in USDC
// (gas is paid in USDC on Arc). Re-measure after a redeploy: the repo build
// reserves the executor fee (§5.4) and is one commit ahead of what is live.

export interface Measured {
  gas: number;
  usd: string;     // the cost as paid, from the receipt
  tx: `0x${string}`;
  what: string;    // what the transaction was
}

/** One payment: `execute` on live order #2 (its first payment, 2026-10-07). */
export const EXECUTE: Measured = {
  gas: 125_716,
  usd: "$0.0026",
  tx: "0x2edb277f96eeecfd04de7c6388b959dceb127ce37071eee626936807f344e246",
  what: "execute, order #2",
};

/** A key-card action, verified on-chain by Arc's post-quantum precompile (`cancelByPq`, 2026-10-07). */
export const PQ_ACTION: Measured = {
  gas: 434_264,
  usd: "$0.0091",
  tx: "0xfb086f60c9d64888af70ca279e075af58662f4ee772fae5023014c1e38dceb68",
  what: "key card cancel, verified on-chain",
};

/** Open + fund in one transaction (`openWithAuthorization`, order #2). */
export const OPEN: Measured = {
  gas: 285_437,
  usd: "$0.0060",
  tx: "0x2e42053474b77d7204c418fe29cf88e887148a083efda954c3369d4b56be8781",
  what: "open order #2",
};

/**
 * Tests passing as of 2026-10-10, as each runner reports them: 119 Solidity
 * local (Foundry's count, which reports the invariant suite as one test), 7
 * against live Arc testnet (skipped by a plain `forge test`), 22 TypeScript
 * parity, 64 web. Update when the suites change.
 */
export const TESTS = { total: 212, live: 7, asOf: "2026-10-10" };

/** SLH-DSA-SHA2-128s signature size (FIPS 205; §3.4). */
export const SIG_BYTES = "7,856";

export const fmtGas = (n: number) => n.toLocaleString("en-US");
