# Writ

**What's written, stays written.**

A standing USDC order on Arc that pays itself. Only a post-quantum key can rewrite it.

> *Writ* — an order issued by an authority and carried out by someone else.
> Also the old past participle of *write*: that which is written, and stays written.

---

> **Status — 6 October 2026.** The specification is complete and every chain fact
> in it was verified against Arc mainnet at block 24,510,277. Implementation is
> in progress for the [Arc Microgrants](https://dorahacks.io/hackathon/arc-microgrants)
> deadline of 14 October 2026. **Nothing is deployed yet.** The mainnet address,
> the measured gas table and the live link will appear in this README when they
> exist, and not before.

---

## What it is

You have an obligation that repeats — a vendor retainer, payroll, a subscription,
a coupon. You fund it once. From then on it pays itself: any stranger can trigger
a due payment and is reimbursed their gas plus a small tip out of the obligation,
so there is no keeper to run and no key to keep online.

Changing it is the part that matters. Redirecting the beneficiary, changing the
amount, or cancelling requires an `SLH-DSA-SHA2-128s` signature that Arc verifies
on-chain through its post-quantum precompile. **The wallet that funded the
obligation cannot do any of those things.** There is no function for it.

So if your operations key leaks, the attacker cannot reroute your payroll. The
authority to redirect money sits on different cryptography, on a key that was
never on the compromised machine. That is useful in 2026 with no quantum computer
anywhere — and the post-quantum part is what keeps it true in 2056.

## Why this shape, and not the obvious one

Arc is the first public chain with on-chain post-quantum signature verification
live in production, and several projects have found it. Every one of them puts
the signature on the **action** — money only moves when a 7,856-byte signature is
presented.

That has two costs. A verification is **433,953 gas** (measured), so every single
payment carries it. And more seriously, the post-quantum key becomes a dependency
of *getting paid* — fine for a savings box you only open when present, wrong for
an obligation that has to keep paying for years while nobody is watching.

Writ inverts it. The post-quantum key authorises the **rule**, once. Execution is
permissionless and cheap forever after.

| | Authority | Gas | Cost | Times over a 10-year monthly obligation |
| --- | --- | --- | --- | --- |
| `execute` | nobody — permissionless | ~110,000 *(estimate)* | $0.0022 | 120 |
| `amend` / `cancel` / `rotateKey` | **SLH-DSA only** | **433,953** *(measured)* | **$0.0087** | 0–3 |

Lifetime gas: **$0.29**, against **$1.04** for the signature-on-every-payment
shape — and the key is needed zero times instead of 120. The saving is not the
point; the point is that putting each authority where it belongs produces both
the right cost curve and the right trust boundary.

## What it uses Arc for

| Arc feature | How Writ uses it |
| --- | --- |
| **PQ Signature Verify precompile** `0x1800…0004` | Every amendment, cancellation and key rotation is authorised by an `SLH-DSA-SHA2-128s` signature the chain verifies itself. No other chain has this |
| **USDC as native gas** | The whole product is priced in dollars. Gas sits at the 20 Gwei protocol floor, so a payment costs about $0.002 |
| **USDC blocklist** (`isBlacklisted`) | Read free before every payment. A frozen counterparty becomes a logged `Quarantined` state instead of Arc's gas-burning, receipt-less revert |
| **EIP-3009** `receiveWithAuthorization` | Open and fund an obligation in one transaction, with no `approve` and no front-running |
| **Sub-second deterministic finality** | A payment is final when the receipt arrives |

## Verified Arc facts

Five things in the spec are **not in Circle's documentation anywhere**. They were
measured here — two by disassembling a predeploy, one by injecting bytecode at a
predeploy's address under an `eth_call` state override. Reproduction commands are
inline in [§3 of the spec](ARCHITECTURE.md).

1. **`CallFrom` is gated by a caller allowlist.** A contract at any other address
   gets `"unauthorized caller"`. Proven by injecting identical bytecode at Memo's
   address, where the same call succeeds.
2. **`CallFrom` also requires `sender == tx.origin`** — revert string
   `"sender spoofing requires tx.origin as sender"`. So Arc's Memo and
   Multicall3From predeploys are **externally-owned-account only, and no contract
   can ever attach a native memo or batch.** This removed a component of the first
   draft.
3. **The PQ precompile reverts on malformed lengths** rather than returning false:
   `vk` must be exactly 32 bytes, `sig` exactly 7,856. Message length is free.
4. **Arc accepts FIPS-205 "pure" SLH-DSA and silently rejects the "internal"
   variant.** Sign with the wrong one and every signature you ever make fails.
5. **The public Circle RPC is not an archive node** — historical `eth_getLogs`
   returns `-32014`. Anything built on log history needs a third-party indexer.

## What this does not claim

- **Not quantum-safe spending.** Funding and execution are ordinary ECDSA. Arc has
  no native post-quantum transaction signing yet. The post-quantum property covers
  **amendment authority only.**
- **No protection if both keys are compromised.**
- **No yield on idle balances.** USYC supply on Arc is zero and access is gated to
  non-US institutions at a $100,000 minimum. Adding lending risk to a safety
  product is the wrong trade.
- **Circle can freeze this contract** and strand every balance. Unavoidable on a
  chain whose native asset is USDC, and stated rather than hidden.
- **No users.** This is a proof of concept.

## Prior art

Writ is not an unclaimed niche, and the spec names the field rather than ignoring
it. Projects using the same precompile: `arc-guard` (two-key USDC box, whose
30-day exit pattern Writ borrows and credits), `interlock`, `ArcMandate`,
`pq-provenance` (whose testing approach Writ borrows), `bix-arc-safesign`, and
`upKEEP`. [§16 of the spec](ARCHITECTURE.md) sets out where Writ diverges from
each.

## Running the tests

```sh
npm ci && npm --prefix web ci
npm test                  # TypeScript: digest and EIP-3009 nonce parity with the contract
npm run test:sol          # Solidity: unit, adversarial and invariant suites
npm run test:fork         # Solidity against LIVE Arc testnet — see the warning below
npm --prefix web test     # web: lib + page render tests
npm --prefix web run build
```

> **The fork tests do not run under a plain `forge test`.** They are gated on
> `block.chainid == 5042002` and **skip silently** without `--fork-url`, so a
> bare run prints `0 failed` while the tests that matter most — the ones that put
> a real signature in front of Arc's real post-quantum precompile — never
> executed. Always run `npm run test:fork` before believing the suite is green.
>
> They work this way because Arc's precompiles are native node code: on a forge
> fork `0x1800…0004` holds a placeholder byte, so the verification is sent to the
> real node as an `eth_call` and the verdict is replayed into the fork with an
> exact-calldata `vm.mockCall`. If Writ sent any other bytes no mock would match,
> the call would hit the placeholder and revert — so a passing PQ action proves
> Writ sent exactly the bytes the real precompile judged.

The keeper is optional. `execute` is permissionless and reimburses the caller's
gas plus a capped tip, so a stranger is paid to run it — but Arc has no searcher
ecosystem yet, so `npm run keeper -- --mainnet --id 2` (or `--once` under cron)
keeps a demo order from falling behind.

## The specification

**[ARCHITECTURE.md](ARCHITECTURE.md)** is the complete build document — 1,550
lines. Someone with no prior context should be able to build Writ from it alone.
Every address, selector, length, revert string and gas figure was verified against
Arc mainnet on 6 October 2026, with the command that produced it, so a reader can
re-check rather than trust. Estimates and judgement calls are marked **ESTIMATE**
and **ASSUMPTION** in bold.

| Section | What it answers |
| --- | --- |
| 1–2 | The problem, and why this mechanism is correct from first principles |
| 3 | Verified chain facts, and how to reproduce them |
| 4–5 | System architecture and the contract in full |
| 6–7 | The arithmetic and the user flows |
| 8–10 | Failure modes, threat model, invariants |
| 11 | Test plan |
| 12–13 | Deployment runbook and cost |
| 14–16 | Build order, known limits, competitive position |

## Network

| | |
| --- | --- |
| Arc mainnet | chain `5042` · `https://rpc.mainnet.arc.io` · [explorer.arc.io](https://explorer.arc.io) |
| Arc testnet | chain `5042002` · `https://rpc.testnet.arc.io` · [explorer.testnet.arc.io](https://explorer.testnet.arc.io) |
| Contract | *not yet deployed* |

## Licence

MIT.
