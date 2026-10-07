# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ARCHITECTURE.md is the source of truth and that shared/digest.ts must byte-match digestFor().

## Project state

Writ is a hackathon entry (Arc Microgrants, deadline **2026-10-14 23:59 ET**). As of 2026-10-07 the repo holds only the spec: `contracts/`, `frontend/`, `scripts/`, `shared/` and `test/` exist but are empty. Nothing is deployed.

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

- `reference` is a reserved word in Solidity. Rename the struct field and the event parameters.
- "Open and fund in one transaction" requires a combined `openWithAuthorization`. The EIP-3009 nonce must be bound to the obligation id, or a signed authorization can be submitted under a different id.
- `_credit` must reject obligations in `None`, `Cancelled` or `Completed` state, or funds sent to them are stranded.
- `amend` doesn't say which states it allows, how `nextDueAt` changes when the period changes, or how the new `endTime` is bounded.
- Only `isBlacklisted` triggers quarantine. You can't blocklist an address on testnet or mainnet, so demonstrate quarantine in a fork test that mocks `isBlacklisted`.
- Expect stack-too-deep errors (14-field public struct getter, the 8-parameter `amend`). Compile with `via_ir`.

## Commands

No build tooling is checked in yet. These commands come from the spec. Arc Foundry (`arc-forge`, `arc-cast`, `arc-anvil`) is preferred over plain Foundry.

```bash
# tests (local runs mock the precompile with vm.mockCall; fork tests hit the real one)
arc-forge test
arc-forge test --match-test <name>
arc-forge test --fork-url https://rpc.mainnet.arc.io --match-contract WritForkTest

# deploy (testnet first; faucet.circle.com -> Arc Testnet)
arc-forge create src/Writ.sol:Writ --rpc-url $RPC --private-key $PK --gas-price 20gwei --priority-gas-price 1gwei
arc-forge verify-contract $ADDRESS src/Writ.sol:Writ --verifier sourcify --chain 5042

# check a signature against the real precompile
cast call 0x1800000000000000000000000000000000000004 "verifySlhDsaSha2128s(bytes,bytes,bytes)(bool)" $VK $DIGEST $SIG --rpc-url $RPC
```

The full flow can be rehearsed against live mainnet at no cost. Use `eth_call` with state overrides to inject the bytecode and a balance (§11.5). Do this before any mainnet deploy, because the contract is immutable.

Update this section once real `package.json` / `foundry.toml` scripts exist.
