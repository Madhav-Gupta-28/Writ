# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ARCHITECTURE.md is the source of truth and that shared/digest.ts must byte-match digestFor().

## Project state

Writ is a hackathon entry (Arc Microgrants, deadline **2026-10-14 23:59 ET**). As of 2026-10-07 `contracts/src/Writ.sol` implements all of §5, with unit, adversarial, invariant and fork tests. The frontend is in `web/` (Vite + React + wagmi, static). The full contract is deployed on **Arc mainnet** at `0xFF70bc435C29400Fe5c988B92dcc6c17d98B5652`, Sourcify exact match (`deployments/arc-mainnet.json`). One live order (#2, 0.01 USDC/day to 2026-11-01) is running there. Its key card is only in `.keycards/` (git-ignored). The same address on **testnet** is the old core slice; the full testnet contract is `0x720859E699B82b176e28C5182095d8FA9Bc94C87` (`deployments/arc-testnet.json`). `npm run flow` replays the full demo with real transactions.

pq-check passed on testnet: pure sign verifies, .internal fails. Signing takes ~1.85s locally.

**`ARCHITECTURE.md` is the source of truth.** It specifies the contract in full (§5), its invariants (§10), the test plan (§11), the deploy runbook (§12) and the build order (§14). Read the relevant section before implementing something. When the code has to deviate from the spec, update the spec in the same change. Values marked **ESTIMATE** or **ASSUMPTION** there are unverified. Replace them with measured numbers once you have them.

The README must not claim anything that isn't true yet. Add the mainnet address, the gas table and the live link only once they exist.

## What it is

Writ is a standing USDC payment order on Arc (chain 5042 mainnet, 5042002 testnet). Three authorities are kept deliberately separate, and this separation is the whole product:

- **Funding:** the payer's ECDSA wallet. It can call `open`, `fund`, `beginWalletCancel` (30-day delay, vetoable) and `reclaim` (after `endTime` + 30 days). It must **never** be able to change the beneficiary, the amount or the period, or stop payments. Don't add a function that lets it.
- **Execution:** anyone. `execute(id)` pays one period per call and reimburses the caller with `gas × tx.gasprice / 1e12 + tip`, capped at `maxExecutorFee`.
- **Amendment:** an SLH-DSA-SHA2-128s key card, verified on-chain by the precompile at `0x1800000000000000000000000000000000000004`. `amend`, `cancelByPq`, `rotateKey`, `resolveQuarantine` and `vetoWalletCancel` all go through `_requirePq`.

The contract is a single file, `Writ.sol`. It has no owner, pause, proxy, `delegatecall`, `SELFDESTRUCT`, `payable` or `msg.value`. The frontend is static: no backend, no indexer.

## Arc-specific traps (each one breaks things silently)

- **Sign with the "pure" SLH-DSA variant only.** Use `slh_dsa_sha2_128s.sign(msg, sk)` from `@noble/post-quantum@0.7.1` (pin that version). Arc rejects `.internal.sign`, so every signature made with it fails.
- **The precompile reverts on bad lengths** instead of returning false. `vk` must be exactly 32 bytes and `sig` exactly 7,856. Check `sig.length` in the contract before calling it, so callers get `BadSignatureLength`.
- **The digest must match byte for byte** between `digestFor()` in Solidity and the TS signer in `shared/`. It is `keccak256(abi.encode(keccak256("WRIT_V1"), chainid, address(this), id, uint8(action), keccak256(payload), pqNonce, deadline))`. Test the two against each other with committed fixtures.
- **USDC has two decimal conventions.** Native USDC (gas, `tx.gasprice`) uses 18 decimals; the ERC-20 at `0x3600000000000000000000000000000000000000` uses 6. Only the ERC-20 interface is used. The single conversion (`NATIVE_TO_ERC20 = 1e12`) lives only in `_payExecutor`, and a mutation test inverting it must fail.
- **Check `isBlacklisted(beneficiary)` before every transfer.** On Arc a transfer to a blocklisted address burns gas and produces no receipt. On a hit, move the obligation to `Quarantined`, emit the event, pay the executor and return. Don't revert.
- **Contracts can't use Arc's Memo or Multicall3From predeploys.** `CallFrom` is allowlisted and requires `sender == tx.origin`. Reconciliation data goes in Writ's own `Paid` event instead.
- **The public RPC isn't an archive node.** Historical `eth_getLogs` fails with error `-32014`. The UI reads current state through view functions and subscribes to events going forward only.
- **Transactions need `maxFeePerGas` ≥ 20 gwei.** Otherwise they may never be included.

## Known spec issues to fix while implementing

None open. Resolved in the spec on `spec/fixes`: `reference` → `ref`, `openWithAuthorization` with id- and terms-bound EIP-3009 nonces (§5.8), `_credit` state check, `via_ir` (§12.1), the full error list (§5.10), refunds to a blocklisted payer revert `PayerBlacklisted` (§5.7), `amend` rules — `Active` only, `nextDueAt` kept (§5.6), and the quarantine demo is the mainnet fork test that mocks `isBlacklisted` (§11.3 row 8).

## Commands

`contracts/` is a standard Foundry project (solc 0.8.30, `via_ir`). Foundry lives in `~/.foundry/bin`, which may not be on PATH. Arc Foundry (`arc-forge`) is preferred for deploys but isn't installed; plain `forge` runs every test.

```bash
npm test                 # TS: shared/digest.ts against shared/fixtures (node --test)
npm run test:sol         # Foundry unit + digest-parity tests; fork tests skip themselves
npm run test:fork        # every *ForkTest against Arc testnet (network), incl. the quarantine demo
node scripts/gen-fixtures.ts --pq-resolve   # regenerate the quarantine fork test's real signatures
npm run fixtures         # regenerate shared/fixtures/digest.json after changing digest.ts

# scripts that touch a chain: TESTNET by default; --mainnet is required for mainnet,
# which prints MAINNET and waits 5 s before the first transaction
npm run rehearse [-- --mainnet]     # §11.5 free eth_call rehearsal, sends nothing
npm run deploy [-- --mainnet]       # deploy + record in deployments/arc-<net>.json
npm run auth-check [-- --mainnet]   # live openWithAuthorization check (a few cents, refunded)
npm run open-order [-- --mainnet]   # the long-running demo order
npm run flow [-- --mainnet]         # the full lifecycle demo (~1 h)
npm run abi                         # after changing Writ.sol: forge build, then export the ABI to shared/abi/writ.ts

# frontend (web/): testnet by default, ?net=mainnet to switch; networks in web/src/config.ts
cd web && npm install && npm run dev     # http://localhost:5173
cd web && npm test                       # unit tests (key card crypto, money/time, errors)
cd web && npm run e2e                    # builds, then drives real Chrome on testnet (~4 min, real txs)
cd web && node e2e/screens.ts            # design screenshots (desktop + mobile) to web/e2e/out/screens, flags horizontal overflow
node scripts/gen-fixtures.ts --pq   # also regenerate the real-signature fork fixture
cd contracts && forge test --match-test <name>
```

Fork tests can't run Arc's precompiles inside a forge fork (they're native code; the fork sees a placeholder byte). `WritFork.t.sol` gets the real verdict with `vm.rpc("eth_call")` and replays it via an exact-calldata `vm.mockCall`. See ARCHITECTURE.md §11.3. Any change to `digestFor` or `shared/digest.ts` must keep `DigestParity.t.sol` and `test/digest.test.ts` green.

```bash
# deploy (from contracts/) (testnet first; faucet.circle.com -> Arc Testnet)
arc-forge create src/Writ.sol:Writ --rpc-url $RPC --private-key $PK --gas-price 20gwei --priority-gas-price 1gwei
arc-forge verify-contract $ADDRESS src/Writ.sol:Writ --verifier sourcify --chain 5042

# check a signature against the real precompile
cast call 0x1800000000000000000000000000000000000004 "verifySlhDsaSha2128s(bytes,bytes,bytes)(bool)" $VK $DIGEST $SIG --rpc-url $RPC
```

The full flow can be rehearsed against live mainnet at no cost. Use `eth_call` with state overrides to inject the bytecode and a balance (§11.5). Do this before any mainnet deploy, because the contract is immutable.

