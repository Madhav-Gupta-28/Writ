# Writ

**What's written, stays written.**

A standing USDC order on Arc that pays itself. Only a post-quantum key can rewrite it.

> *Writ* — an order issued by an authority and carried out by someone else.
> Also the old past participle of *write*: that which is written, and stays written.

| | |
| --- | --- |
| **Live app** | **[https://writ-cyan.vercel.app](https://writ-cyan.vercel.app)** |
| **Live order on Arc mainnet** | [order #2](https://writ-cyan.vercel.app/order/2?net=mainnet) — 0.01 USDC every day |
| **Contract** | [`0xFF70bc435C29400Fe5c988B92dcc6c17d98B5652`](https://explorer.arc.io/address/0xFF70bc435C29400Fe5c988B92dcc6c17d98B5652) · [Sourcify exact match](https://repo.sourcify.dev/5042/0xFF70bc435C29400Fe5c988B92dcc6c17d98B5652) · see **Deployed version** below |
| **Spec** | [ARCHITECTURE.md](ARCHITECTURE.md) — 1,975 lines, every chain fact with the command that proves it |

---

## Try to steal it

There is a real order running on Arc mainnet right now, paying real USDC on a
schedule. Open it and press **Try to hijack this order**.

The app runs the four things a thief holding the funding wallet would actually
try, as free `eth_call` simulations against the live contract. Nothing is signed
and nothing is sent:

| What the thief tries | What the chain says |
| --- | --- |
| Send all future payments to my address | **Blocked** — needs this order's key card. A wallet can't do it. |
| Cancel the order and refund it to me | **Blocked** — needs the key card. |
| Replace the key card with my own | **Blocked** — needs the key card it is replacing. |
| Pull the money out right now | **Blocked** — needs 30 days' public notice, which the key card can veto. |

A stolen wallet can add money to the order. It cannot change who gets paid, and
it cannot stop the payments. That is the whole product, and you can check it
yourself in about a minute without spending anything.

While you are there: if a payment is due, press **Pay now**. Anyone can, and the
order reimburses your gas plus a small tip.

## What it is

You have an obligation that repeats — a vendor retainer, payroll, a
subscription, a coupon. You fund it once. From then on it pays itself: any
stranger can trigger a due payment and is reimbursed their gas plus a tip out of
the order, so there is no keeper to run and no key to keep online.

Changing it is the part that matters. Redirecting the beneficiary, changing the
amount, or cancelling requires an `SLH-DSA-SHA2-128s` signature that Arc verifies
on-chain through its post-quantum precompile. **The wallet that funded the order
cannot do any of those things.** There is no function for it.

So if your operations key leaks, the attacker cannot reroute your payroll. The
authority to redirect money sits on different cryptography, on a key that was
never on the compromised machine. That is useful today, with no quantum computer
anywhere — and the post-quantum part is what keeps it true in thirty years.

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

| | Authority | Gas | Cost | Times over a 10-year monthly order |
| --- | --- | --- | --- | --- |
| `execute` | nobody — permissionless | ~110,000 | $0.0022 | 120 |
| `amend` / `cancel` / `rotateKey` | **SLH-DSA only** | **433,953** | **$0.0087** | 0–3 |

Lifetime gas: **$0.29**, against **$1.04** for the signature-on-every-payment
shape — and the key is needed zero times instead of 120.

## What it uses Arc for

| Arc feature | How Writ uses it |
| --- | --- |
| **PQ Signature Verify precompile** `0x1800…0004` | Every amendment, cancellation and key rotation is authorised by an `SLH-DSA-SHA2-128s` signature the chain verifies itself. No other chain has this. |
| **USDC as native gas** | The executor's fee is **reserved in the same asset as the payment**, so an order's runway is a true dollar count: "this order can make 24 more payments" is exact, gas included. On a chain with a volatile gas token you cannot express that, because part of the cost is in a different asset. |
| **USDC blocklist** (`isBlacklisted`) | Read free before every payment. A frozen recipient becomes a logged `Quarantined` state the key card resolves — instead of Arc's gas-burning, receipt-less revert. No other project in this hackathon models a freeze as a settlement state. |
| **EIP-3009** `receiveWithAuthorization` | Open and fund an order in one transaction, no `approve`, no front-running. |
| **Sub-second deterministic finality** | A payment is final when the receipt arrives. |

## Five things about Arc that are not in Circle's docs

Measured here, not assumed. Reproduction commands are inline in
[§3 of the spec](ARCHITECTURE.md).

1. **`CallFrom` is gated by a caller allowlist.** A contract at any other address
   gets `"unauthorized caller"`. Proven by injecting identical bytecode at Memo's
   address, where the same call succeeds.
2. **`CallFrom` also requires `sender == tx.origin`** — revert string
   `"sender spoofing requires tx.origin as sender"`. So Arc's Memo and
   Multicall3From predeploys are **externally-owned-account only, and no contract
   can ever attach a native memo or batch.** This removed a component of the
   first draft.
3. **The PQ precompile reverts on malformed lengths** rather than returning
   false: `vk` must be exactly 32 bytes, `sig` exactly 7,856. Message length is
   free.
4. **Arc accepts FIPS-205 "pure" SLH-DSA and silently rejects the "internal"
   variant.** Sign with the wrong one and every signature you ever make fails.
5. **The public RPC is not an archive node**, and on an anvil fork the real USDC
   splits in two: `decimals` and `balanceOf` work, while `totalSupply`,
   `transfer` and `isBlacklisted` revert with empty data. `execute`'s first USDC
   call is `isBlacklisted`, so a fork cannot run Writ against the real token at
   all.

## Tests

**197 green:** 123 Solidity local · 7 against live Arc testnet · 22 TypeScript
parity · 45 web. Five invariant campaigns, 4,096 calls, zero reverts. Every
external function, every custom error and every event is exercised: **16/16,
25/25, 14/14**.

```sh
npm ci && npm --prefix web ci
npm test                  # TypeScript: digest and EIP-3009 nonce parity with the contract
npm run test:sol          # Solidity: unit, adversarial, audit and invariant suites
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

`contracts/test/WritAudit.t.sol` is a ground-up audit suite written to break the
contract rather than confirm it. Four findings are documented below; six
behaviours are proven sound and locked as regressions, including that an executor
cannot profit by inflating `tx.gasprice` (uncapped the net is exactly the tip at
any gas price; once the cap binds, raising it only shrinks the net).

## Deployed version

The address above is verified on Sourcify as an exact match for the source it was
deployed from. It is **one commit behind this repo**: an audit of the fee meter
found that the last payable period of an order paid the beneficiary in full and
left the executor nothing, so a rational executor would simulate it, see a zero
fee and never submit it. `execute` now reserves the fee alongside the payment.

```
repo build   0x0079d64ba2f5d3c6b3dc71359ce113527815d69e9a83650f3a55092642b3cb3c
deployed     0xff7e06f46d0883be5d723c6b8614036dbe5eaf105f7cd73fd6f94ac8eff2fe9f
```

Redeploying and re-verifying is the next step; this note exists so the difference
is stated rather than discovered. The ABI is unchanged, so the live app above
works against either. The fix and its reasoning are in
`contracts/test/WritAudit.t.sol` and §5.4 of the spec.

## What this does not claim

- **Not quantum-safe spending.** Funding and execution are ordinary ECDSA. Arc
  has no native post-quantum transaction signing yet. The post-quantum property
  covers **amendment authority only.**
- **`reclaim` does not settle unpaid periods first.** Thirty days after the end
  date, the funding wallet can take back whatever is left, including money for
  payments that came due and nobody collected. `execute` is permissionless, so
  anyone can collect at any time before then, and the app shows the beneficiary a
  **collect before** date. Documented rather than quietly changed.
- **A Completed order whose payer is later blocklisted strands its remainder.**
  An Active order can be amended and paid down; Completed has no route out.
- **No protection if both keys are compromised.**
- **No yield on idle balances.** USYC supply on Arc is zero and access is gated
  to non-US institutions at a $100,000 minimum. Adding lending risk to a safety
  product is the wrong trade.
- **Circle can freeze this contract** and strand every balance. Unavoidable on a
  chain whose native asset is USDC.
- **No users.** This is a proof of concept with one real order running.

## Prior art

Writ is not an unclaimed niche, and this is the field rather than a gap. Projects
using the same precompile: [`arc-guard`](https://github.com/Jayanthkoppala/arc-guard)
(two-key USDC box, whose 30-day exit pattern Writ borrows and credits),
[`interlock`](https://github.com/Iniwura/interlock),
[`ArcMandate`](https://github.com/efeberk21/ArcMandate),
[`leash`](https://github.com/ngjupeng/leash),
[`pq-provenance`](https://github.com/0xHUMAN-AI/pq-provenance) (whose testing
approach Writ borrows), `bix-arc-safesign` and `upKEEP`.
[§16 of the spec](ARCHITECTURE.md) sets out where Writ diverges from each: the
inverted authority model and its cost curve, quarantine as a first-class
settlement state, and a reviewer being able to complete a post-quantum action on
mainnet from a browser in under a minute.

## The specification

**[ARCHITECTURE.md](ARCHITECTURE.md)** is the complete build document. Someone
with no prior context should be able to build Writ from it alone. Every address,
selector, length, revert string and gas figure was verified against Arc mainnet
with the command that produced it, so a reader can re-check rather than trust.
Estimates and judgement calls are marked **ESTIMATE** and **ASSUMPTION** in bold.

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

The keeper is optional. `execute` is permissionless and reimburses the caller's
gas plus a capped tip, so a stranger is paid to run it — but Arc has no searcher
ecosystem yet, so `npm run keeper -- --mainnet --id <id>` (or `--once` under
cron) keeps a demo order from falling behind.

## Licence

MIT.
