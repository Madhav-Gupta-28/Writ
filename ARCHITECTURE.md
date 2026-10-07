# Writ — Architecture

**Long-dated USDC obligations on Arc, where the authority to change them is post-quantum.**

A contract that pays a recurring obligation forever without anyone signing again,
screens its counterparty against Arc's USDC blocklist before every payment so a
freeze becomes a logged credit event instead of a receipt-less gas burn, and
accepts changes to its terms *only* from an `SLH-DSA-SHA2-128s` signature that
Arc verifies on-chain.

> *Writ* — an order issued by an authority and carried out by someone else.
> Also the old past participle of *write*: that which is written, and stays written.

**What's written, stays written.**

---

## 0. How to read this file

This is the complete specification. Someone with no prior context should be able
to build Writ from this document alone.

Every address, selector, length, revert string, gas figure and balance below was
**verified against Arc mainnet on 2026-10-06** at block 24,510,277, with the
command that produced it, so any reader can re-check rather than trust. Where a
number is an estimate or a judgement call it is marked **ESTIMATE** or
**ASSUMPTION** in bold.

Five facts in §3 are **not in Circle's documentation anywhere**. They were
measured here, two of them by disassembling a predeploy and one by injecting
bytecode at a predeploy's address under an `eth_call` state override. They are
the reason this design has the shape it does:

1. `CallFrom` is gated by a **caller allowlist** (§3.6).
2. `CallFrom` *additionally* requires `sender == tx.origin` (§3.7) — so **Arc's
   Memo and Multicall3From predeploys are EOA-only, and no contract can attach a
   native memo**. This killed a component of the first draft.
3. The PQ precompile **reverts** on malformed key/signature lengths and only
   *returns false* for a genuinely bad signature (§3.5).
4. Arc accepts **FIPS-205 "pure"** SLH-DSA and rejects the "internal" variant
   (§3.4) — pick the wrong one and every signature you ever make fails silently.
5. The public Circle RPC is **not an archive node** (§3.9).

| Section | What it answers |
| --- | --- |
| 1 | The problem, and the failure this is a response to |
| 2 | Why this mechanism is correct, from first principles |
| 3 | Verified chain facts, and how to reproduce them |
| 4 | System architecture and component boundaries |
| 5 | The contract, in full |
| 6 | The arithmetic |
| 7 | User flows |
| 8 | Failure modes |
| 9 | Threat model |
| 10 | Invariants |
| 11 | Test plan |
| 12 | Deployment runbook |
| 13 | Cost |
| 14 | Build order |
| 15 | Open items and known limits |
| 16 | Competitive position, stated honestly |
| 17 | Sources |

---

## 1. The problem

### 1.1 Every post-quantum product on Arc makes the quantum key a liveness dependency

Arc is the first public chain with an on-chain post-quantum signature verifier
live in production. Five projects have found it. Every one of them has built the
same shape: **a vault that requires a 7,856-byte SLH-DSA signature at the moment
money moves.**

That shape has two costs, and both are measured in §6.

The first is money. A PQ verification costs **433,953 gas** — $0.0087 at Arc's
fee floor (§3.5). Put it on the withdrawal path and every single payment carries
it.

The second is worse. If the money cannot move without the post-quantum key, then
the key is a dependency of *getting paid*. A savings box can accept that; you
only open it when you are present. **An obligation cannot.** Payroll, a vendor
retainer, a coupon, a pension, a subscription — these have to keep paying while
nobody is watching, for years, and they must keep paying precisely in the
scenario where the holder is unavailable.

### 1.2 The authority that needs to outlive the cryptography is not the spending authority

Consider what actually has to be unforgeable in a long-dated obligation.

Not the instruction to pay this month's amount to the agreed party — that is
fully determined by terms already fixed and public.

What has to be unforgeable is the authority to say *"pay someone else instead."*

That is the authority an attacker wants. It is also the authority that, in a
30-year instrument, must still be sound in year 30. Those two properties point
at the same conclusion, and it is the opposite of what the five incumbents
built: **the rare, high-stakes, long-lived authority belongs on post-quantum
cryptography. The frequent, low-stakes, already-determined action does not need
a signature at all.**

### 1.3 Arc freezes dollars, and tells you nothing when it does

USDC on Arc is centrally freezable. The blocklister is a live address (§3.8) and
`isBlacklisted(address)` is a free public read.

Arc's own documentation states the consequence: *"A value transfer to or from a
blocklisted address reverts. An included transaction that reverts on a blocklist
check still consumes gas."* And a blocklist revert produces **no receipt**.

So on Arc, an institution with a standing obligation to a counterparty that gets
frozen discovers this as a transaction that cost money, produced no receipt, and
carries no reason. For a payment product this is an annoyance. For a *settlement*
product it is a credit event arriving with no diagnostics — and counterparty
freeze is the single most Arc-specific risk in any multi-period obligation.

I could not find one project in the Arc Microgrants field that treats it as a
first-class state (§16).

### 1.4 The failure this design is a response to

A business runs payroll from a hot operations key. The key leaks. On Arc,
finality is sub-second, so there is no mempool window in which to react and
nothing to front-run. The attacker's most profitable move is not to drain the
balance once — it is to **redirect the standing obligation** and collect every
period from now on, quietly.

Under Writ that attack fails. The leaked ECDSA key can fund the obligation
and can start a cancellation that takes 30 days and that the post-quantum key
can veto at any point. It cannot change the beneficiary, cannot change the
amount, and cannot stop the payments. The authority to redirect money sits on
different cryptography, on a key that was never on the machine that got
compromised.

That property is valuable in 2026, with no quantum computer anywhere. The
post-quantum part is what makes it still true in 2056.

---

## 2. Why this mechanism is correct

### 2.1 Put the expensive authority on the rare path

This is the whole design, stated once.

| | Authority | Frequency over a 10-year monthly obligation | Gas | Cost |
| --- | --- | --- | --- | --- |
| `execute` | **nobody** — permissionless | 120 | 123,148 **measured** | $0.0025 |
| `amend` / `cancel` / `rotateKey` | **SLH-DSA only** | 0–3 typical | 433,953 **measured** | $0.0087 |

The incumbent shape pays $0.0087 × 120 = **$1.04** in verifications. Writ
pays $0.0025 × 120 + ~2 amendments = **$0.31**.

The saving is not the point. The point is that the cost curve falls out of
putting each authority where it belongs, and a design whose costs are correct
usually has its trust boundaries correct too.

### 2.2 Permissionless execution is what removes the keeper

Once terms are fixed, "pay the agreed amount to the agreed party on the agreed
date" is a pure function of public state. Nothing about it needs authorization.
So anyone may call it, and the obligation pays the caller's gas back plus a
small tip (§6.2).

This matters more than it sounds. A keeper is an operational liability: a server,
a key, a balance, a monitoring rota. Nocturne solved this on Hedera by having
the contract book its own next execution through a protocol scheduler. Arc has
no scheduler, so Writ uses the only other mechanism that removes the
operator — **make execution profitable for a stranger.**

### 2.3 Refusing is a feature, and it is the demo

When the beneficiary is blocklisted, the wrong behaviour is to attempt the
transfer: on Arc that burns gas and returns no receipt. The right behaviour is
to read `isBlacklisted` first — it is free — and if it is true, move the
obligation to `Quarantined`, emit the reason, pay the executor for the
transition, and stop.

The obligation is then resolvable by the post-quantum key: redirect to a
successor address, or cancel and refund. Funds are never trapped by the freeze
of a counterparty, and the credit event is a logged on-chain state transition
with a timestamp an auditor can cite.

This is the same instinct as Nocturne's price-disagreement refusal: **a system
that moves money is judged on what it does when it should not move money.**

### 2.4 Why the beneficiary cannot be changed by the funder

A natural objection: the payer's own wallet funded this, so why can't the
payer's wallet redirect it?

Because then the ECDSA key is the only trust root and the post-quantum key is
decoration. The entire security claim is that **funding authority and redirection
authority are separable and are held on different cryptography.** Allowing the
funder to redirect collapses them and the product has no reason to exist.

The cost of that choice is real and is stated in §8: lose the PQ key and the
obligation runs to its `endTime`. That is why `endTime` is mandatory and why the
delayed vetoable cancel exists.

### 2.5 Why SLH-DSA is the right post-quantum choice here

SLH-DSA (formerly SPHINCS+) is hash-based and **stateless**. XMSS and LMS are
also hash-based but *stateful*: they carry a key-index that must be persisted
and never reused, and reuse is catastrophic. A stateful scheme inside a key card
a user backs up, restores, and copies between devices is a loaded gun.

Stateless matters more than its 7,856-byte signature costs. There is no key
state to corrupt, no restore-from-backup hazard, and a key card can be safely
duplicated. It is also, pragmatically, the only scheme Arc verifies (§3.4).

### 2.6 Why the ERC-20 interface only, and never `msg.value`

Arc exposes the same USDC balance through two interfaces: a native 18-decimal
asset and a 6-decimal ERC-20 at `0x3600…0000`. Circle's own documentation warns
that mixing them puts pool and LTV arithmetic **off by 10¹²**, and that a single
ERC-20 `transfer()` emits **two** `Transfer` logs from two different emitters.

Writ therefore touches the 18-decimal path in exactly one place — converting
`gas × tx.gasprice` into an executor fee (§6.2) — and that conversion is a named
constant with its own adversarial test. Every balance, every amount, every event
is 6-decimal. One interface, one decimal convention, one place where the
conversion lives.

---

## 3. Verified chain facts

Reproduce anything here with the command beside it. `$RPC` is
`https://rpc.mainnet.arc.io` unless stated. All readings taken 2026-10-06,
block 24,510,277.

### 3.1 Networks

| | Chain ID | JSON-RPC | Explorer |
| --- | --- | --- | --- |
| Arc mainnet | **5042** | `https://rpc.mainnet.arc.io` | `https://explorer.arc.io` |
| Arc testnet | **5042002** | `https://rpc.testnet.arc.io` (+ `wss://`) | `https://explorer.testnet.arc.io` |

Faucet: `https://faucet.circle.com` (select Arc Testnet; USDC and EURC).
The primary Circle endpoint takes anonymous requests with open CORS, no API key.

```bash
cast chain-id --rpc-url https://rpc.mainnet.arc.io          # 5042
```

### 3.2 Gas is USDC, and it sits on the floor

| Parameter | Value |
| --- | --- |
| Gas unit | USDC, 18-decimal native accounting |
| Minimum base fee | **20 Gwei**, protocol-enforced |
| Maximum base fee | 20,000 Gwei |
| Observed `eth_gasPrice` | **20.00000001 Gwei** — i.e. at the floor |
| Throughput | 30M gas/block, ~0.5 s blocks |

```bash
cast rpc eth_gasPrice --rpc-url $RPC      # 0x4a817c80a = 20000000010 wei
```

**Cost formula used throughout this document:**

```
cost_in_USDC = gas × 20e9 / 1e18 = gas × 2e-8
```

So 1,000,000 gas = **$0.02**. Cross-checked against a third-party mainnet
contract that published a measured receipt: 451,246 gas reported as ≈0.009 USDC;
451,246 × 2e-8 = 0.00902. Agrees.

**Any transaction must set `maxFeePerGas` ≥ 20 Gwei** or it may remain pending
indefinitely. A 1 Gwei priority tip helps inclusion.

### 3.3 Assets on Arc, measured

| Asset | Address | Decimals | `totalSupply()` |
| --- | --- | --- | --- |
| USDC (ERC-20 interface) | `0x3600000000000000000000000000000000000000` | 6 | **529,325,892.76** |
| USDC (native, EIP-7708 system emitter) | `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` | 18 | — |
| EURC | `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` | 6 | **5,696,023.39** |
| USYC | `0x8a5D989Bbb96929F689B0200f435f53dA42bF490` | 6 | **0.000000** |

```bash
cast call 0x3600000000000000000000000000000000000000 "totalSupply()(uint256)" --rpc-url $RPC
cast call 0x3600000000000000000000000000000000000000 "name()(string)"        --rpc-url $RPC  # "USDC"
cast call 0x3600000000000000000000000000000000000000 "version()(string)"     --rpc-url $RPC  # "2"
cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)"     --rpc-url $RPC  # 6
```

USYC at zero supply is worth knowing before anyone proposes earning yield on
idle obligation balances: USYC is gated to non-US institutions with a $100,000
minimum. It is not available to this contract. See §15.

### 3.4 The PQ Signature Verify precompile — live, open, and variant-specific

```
address  0x1800000000000000000000000000000000000004
ABI      verifySlhDsaSha2128s(bytes vk, bytes msg, bytes sig) view returns (bool)
selector 0xbf4db8ba
```

All five Arc precompiles live in `0x1800…0000`–`0x1800…0004` and return code
`0xef` on mainnet. On testnet `0x1800…0004` returns `0x01` (2026-10-07). Either
way it is a placeholder, not executable EVM code; see §11.3 for what that means
for fork tests:

| Precompile | Address |
| --- | --- |
| Native Coin Authority | `0x1800…0000` |
| Native Coin Control (blocklist) | `0x1800…0001` |
| System Accounting | `0x1800…0002` |
| Call From | `0x1800…0003` |
| **PQ Signature Verify** | **`0x1800…0004`** |

**It is open to any caller.** Verified two ways: a direct `eth_call` from an EOA,
and a call from a freshly-injected contract at a random non-allowlisted address.
Both returned `false` for a bogus signature rather than an authorization error.
Contrast §3.6, where the same style of probe produced `"unauthorized caller"`.

**Arc accepts FIPS-205 "pure" SLH-DSA-SHA2-128s and rejects the "internal"
variant.** This is not documented and it is the single most expensive mistake
available here. Measured with a real keypair:

| Signature produced by | Precompile returns |
| --- | --- |
| `slh_dsa_sha2_128s.sign(msg, sk)` — noble default, FIPS-205 pure | **`true`** |
| `slh_dsa_sha2_128s.internal.sign(msg, sk)` — no domain prefix | `false` |
| pure signature, one bit flipped in the digest | `false` |

"Pure" means the signed message is `0x00 ‖ len(ctx) ‖ ctx ‖ msg`, with an empty
context. `@noble/post-quantum@0.7.1` does this by default.

**Parameter lengths are enforced by reverting, not by returning false.** This is
the second undocumented behaviour and it dictates the error handling in §5.6:

| `vk` | `msg` | `sig` | Result |
| --- | --- | --- | --- |
| 32 | 32 | 7856 | returns `false` (bad signature) |
| **31** | 32 | 7856 | **reverts** `"Invalid verifying key length"` |
| **0** | 32 | 7856 | **reverts** `"Invalid verifying key length"` |
| 32 | 32 | **7855** | **reverts** `"Invalid signature length"` |
| 32 | **0** | 7856 | returns `false` |
| 32 | **64** | 7856 | returns `false` |

So the message may be any length, but **the contract must validate
`vk.length == 32` and `sig.length == 7856` itself** before calling, or a user
who submits a truncated signature gets an opaque precompile revert instead of a
clean typed error.

Scheme parameters, from `@noble/post-quantum@0.7.1`:

| | Bytes |
| --- | --- |
| public key | **32** |
| secret key | **64** |
| signature | **7,856** |
| seed | 48 |
| sign randomness | 16 |

Signing takes **~825 ms** in Node on this machine; it is pure JavaScript with no
WASM, so it runs in a browser. Show a spinner — at 825 ms a silent UI reads as
broken.

Reproduce:

```bash
npm i @noble/post-quantum@0.7.1
node --input-type=module -e '
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import { randomBytes } from "crypto";
const k = S.keygen();
const d = Buffer.from(randomBytes(32));
const sig = S.sign(d, k.secretKey);                       // pure variant
console.log(k.publicKey.length, sig.length, S.verify(sig, d, k.publicKey));
'   # 32 7856 true
```

Then verify that same triple on-chain with
`cast call 0x1800000000000000000000000000000000000004 "verifySlhDsaSha2128s(bytes,bytes,bytes)(bool)" <vk> <msg> <sig> --rpc-url $RPC`.

### 3.5 One PQ verification costs 433,953 gas

Measured with `eth_estimateGas` against a contract whose only work is a single
verification of a valid signature, injected at a fresh address under a state
override:

| | Value |
| --- | --- |
| Total transaction gas | **433,953** |
| Cost at the 20 Gwei floor | **$0.008679** |
| Of which calldata | ~125,000 **ESTIMATE** (7,856 non-zero bytes × 16) |

Arc's 30M gas per block absorbs this comfortably — roughly 69 verifications
could fit in one block.

### 3.6 `CallFrom` is gated by a caller allowlist

Not documented. Established by disassembly and four probes.

The `Memo` predeploy does not contain the precompile address as a literal; it
computes it as `(3 << 155) + 3`:

```
00ea  PUSH1 0x03
00ec  PUSH1 0x03
00ee  PUSH1 0x9b      // 155
00f0  SHL
00f1  ADD             // -> 0x1800000000000000000000000000000000000003
00f3  PUSH4 0x1595ec0b
00fd  CALLER          // passes its own msg.sender as `sender`
0118  CALL
```

Recovering the selector by brute force gives the ABI:

```solidity
// 0x1800000000000000000000000000000000000003
function callFrom(address sender, address target, bytes data) external;  // 0x1595ec0b
```

There is no `value` parameter: `CallFrom` does not forward value on Arc.

Probe results, all via `eth_call` with state overrides:

| Caller | `sender` argument | Result |
| --- | --- | --- |
| contract at a random address | its own `msg.sender` (an EOA) | **`"unauthorized caller"`** |
| contract at a random address | an unrelated third party | **`"unauthorized caller"`** |
| contract at a random address | itself | **`"unauthorized caller"`** |
| real `Memo` predeploy, called by an EOA | the EOA | **succeeds** |
| **my own bytecode injected at `Memo`'s address** | the calling EOA | **succeeds** |

That last row is the proof. Identical bytecode, identical caller, identical
calldata — only the address changed. **The allowlist keys on the caller's
address**, not on code, not on `tx.origin`, and it contains exactly Circle's two
predeploys:

| Predeploy | Address | Runtime bytes |
| --- | --- | --- |
| `Memo` | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` | 1,228 |
| `Multicall3From` | `0x522fAf9A91c41c443c66765030741e4AaCe147D0` | 3,180 |

**No third party can build a transaction extension on Arc.** The first draft of
this design was a policy layer that paid through `CallFrom` so USDC would record
the user's own EOA as sender. That design is impossible and was abandoned.

### 3.7 `CallFrom` also requires `sender == tx.origin`, so Memo is EOA-only

This is the fact that shaped §5. Being allowlisted is necessary but not
sufficient.

A contract was injected at a random address and made to call the **real, genuinely
allowlisted** `Memo` predeploy, asking it to wrap a USDC transfer:

```
contract -> Memo(0x5294…e505) -> CallFrom -> USDC.transfer
  reverts: "sender spoofing requires tx.origin as sender"
```

Control, same contract, same balance, no Memo:

```
contract -> USDC.transfer       ->  succeeds
contract -> USDC.transfer(to = a contract address) -> succeeds
```

`Memo` forwards its own `msg.sender` into `CallFrom`. When an EOA calls `Memo`
directly, that equals `tx.origin` and it passes. When a *contract* calls `Memo`,
`sender` is the contract and `tx.origin` is the executor, so `CallFrom` rejects
it.

**Consequence for this design: Writ cannot attach a native Arc memo to the
payments it makes.** Neither can any other contract, ever. Arc's memo and batch
extensions are available to externally-owned accounts only.

Writ therefore carries its own reconciliation reference in its own event
(§5.3). This is a loss — a native memo would have been nicer — and it is stated
rather than hidden, because at least six projects in this field are building
memo-based reconciliation and may not know that the contract-initiated path does
not exist.

### 3.8 The blocklist, and EIP-3009 / EIP-2612

```bash
cast call 0x3600000000000000000000000000000000000000 "blacklister()(address)" --rpc-url $RPC
# 0x2a2b7ff330f15f9a8c52af5fec27d775f5138467

cast call 0x3600000000000000000000000000000000000000 \
  "isBlacklisted(address)(bool)" 0x4444444444444444444444444444444444444444 --rpc-url $RPC
# false
```

`isBlacklisted` is a free `view`. It is the pre-screen in §5.4.

The USDC on Arc is a Circle FiatTokenV2 (`name() == "USDC"`, `version() == "2"`)
behind a thin facade, and **both signature-based transfer standards are live**.
Established differentially — a function that exists fails inside its own
signature check, a function that does not exist produces a bare revert:

| Call | Result | Conclusion |
| --- | --- | --- |
| `transferWithAuthorization(...)` with a bogus signature | `"ECRecover: invalid signature"` | **EIP-3009 live** |
| `receiveWithAuthorization(...)` with a bogus signature | `"ECRecover: invalid signature"` | **EIP-3009 live** |
| `permit(...)` with a bogus signature | `"ECRecover: invalid signature"` | **EIP-2612 live** |
| `0xdeadbeef` | `"execution reverted"`, no reason | control |

`authorizationState(address,bytes32)` and `nonces(address)` both answer, and
`DOMAIN_SEPARATOR()` returns
`0x940506929bba468048a19b567f4f0d534714bc06604b5c3017e5d16785ccdf84`.

`receiveWithAuthorization` is the funding path in §5.8: it can only be submitted
by the named recipient, so it cannot be front-run, and it needs no prior
`approve`.

### 3.9 The public RPC is not an archive node

```bash
cast rpc eth_getLogs '{"address":"0x3600000000000000000000000000000000000000",
  "topics":["0xffa4e6181777692565cf28528fc88fd1516ea86b56da075235fa575af6a4b855"],
  "fromBlock":"0x176F000","toBlock":"0x176F0C8"}' --rpc-url $RPC
# error -32014  "requested data not available"
```

Historical `eth_getLogs` is not served. Two consequences:

- The frontend must not depend on log history. Writ's UI reads current
  contract state through `view` functions and subscribes to new events going
  forward. **ASSUMPTION:** an indexer (Alchemy, QuickNode, Blockdaemon, dRPC all
  offer Arc endpoints) is required for any historical view. Do not ship a
  "payment history" panel backed by the public RPC.
- I could not enumerate real `Blacklisted` events, so I cannot demonstrate the
  quarantine path against a genuinely frozen mainnet address. The demo is a
  mainnet fork test that mocks only `isBlacklisted` (§11.3 row 8). Stated in
  §15.

### 3.10 Arc EVM divergences that bite this design

Arc targets the **Osaka** EVM baseline. From Circle's documentation, each
relevant to a contract that custodies USDC:

| Divergence | Why it matters here |
| --- | --- |
| `SELFDESTRUCT` moves a contract's USDC to the beneficiary, because USDC *is* the native balance | Writ contains no `SELFDESTRUCT`. Any library that does is disqualified |
| A non-zero-value call to a self-destructed account **reverts** | A beneficiary can become permanently unpayable. Not detectable in advance, so `execute` reverts `TransferFailed` (§8 row 5). Only `isBlacklisted` triggers `Quarantined` |
| Sends to `address(0)` **revert** rather than succeed | `beneficiary != address(0)` is validated at `open` |
| Sending native value to a contract is not guaranteed to succeed | Writ never sends native value; it uses `transfer` on the ERC-20 interface |
| Blocklist reverts consume gas and produce no receipt | The entire reason for §5.4 |
| One ERC-20 `transfer()` emits **two** `Transfer` logs, 6-decimal and 18-decimal, from different emitters | Any indexer must filter on emitter address or it double-counts |
| Native USDC is 18-decimal, ERC-20 USDC is 6-decimal, same balance | The `NATIVE_TO_ERC20 = 1e12` conversion in §6.2 is the only place this appears |

### 3.11 Other live contracts, for reference

| Contract | Address | Note |
| --- | --- | --- |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | not used here |
| ERC-8004 Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | not used here |
| ERC-8004 Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | not used here |
| ERC-8004 Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | not used here |
| StableFX `FxEscrow` | `0xe2E5F173576B513d994073CCbDaCBE027d43DFe6` | EIP-1967 proxy → `0xbd01a88ae56f9dd6791dfc39079387901d77cc6d`; `owner()` set, `paused()` false, but `maker()` / `isMaker()` / `DOMAIN_SEPARATOR()` all revert. **Permissioned. Not usable without Circle maker onboarding** |

### 3.12 Not available — do not design against these

| Feature | Status |
| --- | --- |
| **Arc Privacy Sector (APS)** | *"On the roadmap and not yet available on Arc."* No confidential execution exists |
| **Stablecoin Services** (multi-stablecoin gas, protocol paymaster, cross-currency settlement) | Not shipped |
| **Native post-quantum transaction signing** | Future milestone, likely EIP-8141 frame transactions, EIP unfinalised. PQ is an **application-layer** primitive today — which is exactly what this design uses |
| PQ hardware wallet support | Does not exist. The key card is browser-generated. See §15 |

---

## 4. System architecture

### 4.1 Components

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Next.js, static, no backend)                          │
│                                                                 │
│   key-card.ts      @noble/post-quantum, SLH-DSA-SHA2-128s       │
│                    keygen · sign(digest) · encrypted export     │
│                    NEVER transmitted. Download forced before    │
│                    an obligation can be opened.                 │
│   wallet           viem + any injected EVM wallet, chain 5042   │
└───────────────┬─────────────────────────────────────────────────┘
                │ eth_sendTransaction / eth_call
┌───────────────▼─────────────────────────────────────────────────┐
│  Writ.sol        ← the only contract. Immutable.           │
│                         No admin. No upgrade. No pause.         │
│                                                                 │
│   obligations[id]     terms · balance · pqKey · pqNonce · state │
│                                                                 │
│   open / fund         ECDSA (payer)                             │
│   execute             permissionless, gas-reimbursed            │
│   amend / cancel /    SLH-DSA ONLY                              │
│     rotateKey /                                                 │
│     resolveQuarantine                                           │
│   beginWalletCancel   ECDSA (payer), 30-day delay               │
│   vetoWalletCancel    SLH-DSA ONLY                              │
└───┬──────────────┬──────────────────────────────┬───────────────┘
    │              │                              │
    ▼              ▼                              ▼
 USDC ERC-20   PQ Verify precompile        isBlacklisted (free view)
 0x3600…0000   0x1800…0004                 on the USDC interface
 6 decimals    verifySlhDsaSha2128s
```

There is no keeper, no backend, no indexer in the trust path, and no off-chain
component that can prevent or redirect a payment.

### 4.2 The separation that makes this safe

Three authorities, deliberately disjoint:

| Authority | Held by | Can | Cannot |
| --- | --- | --- | --- |
| **Funding** | payer's ECDSA wallet | `open`, `fund`, `beginWalletCancel` (30-day, vetoable), `reclaim` after expiry | change beneficiary, change amount, cancel immediately, stop a payment |
| **Execution** | anyone | `execute` when due | choose the recipient, the amount, or the timing |
| **Amendment** | SLH-DSA key card | `amend`, `cancel`, `rotateKey`, `resolveQuarantine`, `vetoWalletCancel` | nothing else; it never holds or receives funds |

A compromise of any single one of these is survivable. §9 works through each.

### 4.3 Data flow of one unattended period

```
1.  t >= nextDueAt
2.  a stranger (cron, searcher, the beneficiary itself) calls execute(id)
3.  state == Active?                         else revert, cheap
4.  block.timestamp >= nextDueAt?            else revert, cheap
5.  isBlacklisted(beneficiary)?   ── true ─> state = Quarantined
                                              emit Quarantined
                                              pay executor
                                              return          (no gas burn)
                                   └─ false ┐
6.  balance >= amountPerPeriod?              else revert, cheap
7.  balance -= amount; nextDueAt += period   (effects before interaction)
8.  USDC.transfer(beneficiary, amount)
9.  emit Paid(id, beneficiary, amount, periodIndex, ref)
10. reimburse executor: min(gasUsed × tx.gasprice / 1e12 + TIP, maxExecutorFee)
11. nextDueAt > endTime?          ── yes ──> state = Completed
```

Steps 3, 4 and 6 revert cheaply and deliberately: an executor simulates before
submitting, so a revert costs them nothing and keeps them from wasting gas. Step
5 must *not* revert, because it changes state — which is why the executor is
paid for it.

---

## 5. The contract

One file, `src/Writ.sol`, Solidity `0.8.30`, no inheritance beyond a local
reentrancy guard, no external libraries. **Compile with `via_ir = true`**
(§12.1): the 14-field public `obligations` getter and the 8-parameter `amend`
hit stack-too-deep under the legacy pipeline.

### 5.1 Interfaces and constants

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IUSDC {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
    function isBlacklisted(address who) external view returns (bool);
    function receiveWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external;
}

/// Arc PQ Signature Verify precompile. Verified live on mainnet 2026-10-06.
/// Reverts on wrong vk/sig length; returns false for a bad signature.
interface IPQVerify {
    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata sig)
        external view returns (bool);
}

contract Writ {
    IUSDC     public constant USDC = IUSDC(0x3600000000000000000000000000000000000000);
    IPQVerify public constant PQ   = IPQVerify(0x1800000000000000000000000000000000000004);

    uint256 public constant PQ_PUBKEY_LEN = 32;    // §3.4, enforced by revert in the precompile
    uint256 public constant PQ_SIG_LEN    = 7856;  // §3.4

    /// 18-decimal native gas accounting -> 6-decimal ERC-20 amounts. §3.10, §6.2.
    uint256 public constant NATIVE_TO_ERC20 = 1e12;

    uint64  public constant WALLET_CANCEL_DELAY = 30 days;  // §5.7
    uint64  public constant RECLAIM_GRACE       = 30 days;  // §5.8
    uint128 public constant EXECUTOR_TIP        = 10_000;   // 0.01 USDC, 6dp
    uint256 public constant REIMBURSE_OVERHEAD  = 30_000;   // gas after the measurement point. ESTIMATE

    uint64  public constant MIN_PERIOD = 1 hours;
    uint64  public constant MAX_PERIOD = 365 days;
}
```

`EXECUTOR_TIP` and `REIMBURSE_OVERHEAD` are the only tunables, both immutable
constants. Calibrate `REIMBURSE_OVERHEAD` from a real receipt on testnet before
mainnet; the number above is an **ESTIMATE**.

### 5.2 Data model

```solidity
enum State { None, Active, Quarantined, Cancelled, Completed }

enum Action { Amend, Cancel, RotateKey, ResolveQuarantine, VetoWalletCancel }

struct Obligation {
    address  payer;            // funds it; cannot redirect it
    address  beneficiary;      // receives every period
    uint128  amountPerPeriod;  // USDC, 6dp
    uint128  balance;          // USDC held for this obligation, 6dp
    uint128  maxExecutorFee;   // per-execution cap, 6dp
    uint64   periodSeconds;
    uint64   nextDueAt;
    uint64   endTime;          // MANDATORY. the lost-key backstop. §2.4
    uint64   pqNonce;          // increments on every successful PQ action
    uint64   cancelReadyAt;    // 0 = none; set by beginWalletCancel
    uint32   periodsPaid;
    State    state;
    bytes32  pqKey;            // SLH-DSA-SHA2-128s public key, exactly 32 bytes
    bytes32  ref;              // reconciliation reference. §3.7 — no native memo exists
}

/// The terms a payer chooses at open. Grouped so `open` and
/// `openWithAuthorization` stay under the stack limit and so the terms can be
/// hashed as one value for the EIP-3009 nonce (§5.8).
struct Terms {
    address  beneficiary;
    uint128  amountPerPeriod;
    uint64   periodSeconds;
    uint64   startAt;
    uint64   endTime;
    uint128  maxExecutorFee;
    bytes32  pqKey;
    bytes32  ref;
}

/// EIP-3009 `receiveWithAuthorization` fields other than from / to / value.
struct Authorization {
    uint256  validAfter;
    uint256  validBefore;
    bytes32  nonce;
    uint8    v;
    bytes32  r;
    bytes32  s;
}

mapping(uint256 => Obligation) public obligations;
uint256 public nextId = 1;

uint256 public totalCommitted;   // Σ obligations[*].balance — invariant anchor, §10
```

`pqKey` is `bytes32` rather than `bytes` because the public key is exactly 32
bytes (§3.4). This saves a storage slot and makes the length invariant
structural rather than checked.

The reconciliation field is `ref`, not `reference`: `reference` is a reserved
word in Solidity and does not compile. The same name is used in the events and
in `Terms`.

### 5.3 Events

```solidity
event Opened(uint256 indexed id, address indexed payer, address indexed beneficiary,
             uint128 amountPerPeriod, uint64 periodSeconds, uint64 endTime,
             bytes32 pqKey, bytes32 ref);
event Funded(uint256 indexed id, address indexed from, uint128 amount, uint128 newBalance);

/// The reconciliation record. Arc's Memo predeploy cannot be reached from a
/// contract (§3.7), so this event is the canonical reference, not a Memo log.
event Paid(uint256 indexed id, address indexed beneficiary, uint128 amount,
           uint32 periodIndex, bytes32 ref);

event Quarantined(uint256 indexed id, address indexed beneficiary, uint64 at);
event QuarantineResolved(uint256 indexed id, address indexed newBeneficiary);
event Amended(uint256 indexed id, address indexed newBeneficiary, uint128 newAmount,
              uint64 newPeriodSeconds, uint64 newEndTime, uint64 pqNonce);  // the nonce that authorized it, as in PQVerified
event KeyRotated(uint256 indexed id, bytes32 newPqKey, uint64 pqNonce);
event Cancelled(uint256 indexed id, uint128 refunded, bool byPqKey);
event WalletCancelBegun(uint256 indexed id, uint64 readyAt);
event WalletCancelVetoed(uint256 indexed id, uint64 pqNonce);
event Completed(uint256 indexed id);
event ExecutorPaid(uint256 indexed id, address indexed executor, uint128 fee);
event PQVerified(uint256 indexed id, Action action, bytes32 digest, uint64 pqNonce);
```

### 5.4 `execute` — the permissionless path

```solidity
function execute(uint256 id) external nonReentrant {
    uint256 gasStart = gasleft();
    Obligation storage o = obligations[id];

    if (o.state != State.Active)             revert NotActive();
    if (block.timestamp < o.nextDueAt)        revert NotDue();

    // ---- the Arc-specific refusal. §1.3, §2.3 ----
    // A transfer to a blocklisted address reverts, consumes gas, and produces
    // no receipt. Read first; it is free.
    if (USDC.isBlacklisted(o.beneficiary)) {
        o.state = State.Quarantined;
        emit Quarantined(id, o.beneficiary, uint64(block.timestamp));
        _payExecutor(id, o, gasStart);       // paid, because this advanced state
        return;
    }

    uint128 amt = o.amountPerPeriod;
    if (o.balance < amt) revert Underfunded();

    // effects before interaction
    o.balance      -= amt;
    totalCommitted -= amt;
    o.nextDueAt    += o.periodSeconds;
    uint32 idx      = ++o.periodsPaid;

    if (!USDC.transfer(o.beneficiary, amt)) revert TransferFailed();
    emit Paid(id, o.beneficiary, amt, idx, o.ref);

    if (o.nextDueAt > o.endTime) {
        o.state = State.Completed;
        emit Completed(id);
    }

    _payExecutor(id, o, gasStart);
}
```

**One period per call.** If execution is neglected for three periods, three
separate calls catch it up, each paid. This bounds gas per transaction, keeps the
accounting trivially auditable, and means a long gap cannot produce a surprise
lump-sum transfer. The cost is that a long gap needs several transactions; at
$0.0025 each that is acceptable.

### 5.5 `_payExecutor`

```solidity
function _payExecutor(uint256 id, Obligation storage o, uint256 gasStart) private {
    uint256 gasUsed = gasStart - gasleft() + REIMBURSE_OVERHEAD;
    // tx.gasprice is 18-decimal native USDC. §3.10. This is the ONLY place the
    // two decimal conventions meet. Computed in uint256 and capped before
    // narrowing, so an extreme gas price cannot truncate.
    uint256 fee = gasUsed * tx.gasprice / NATIVE_TO_ERC20 + EXECUTOR_TIP;

    if (fee > o.maxExecutorFee) fee = o.maxExecutorFee;
    if (fee > o.balance)        fee = o.balance;
    if (fee == 0) return;

    uint128 fee128  = uint128(fee);
    o.balance      -= fee128;
    totalCommitted -= fee128;
    if (!USDC.transfer(msg.sender, fee128)) revert TransferFailed();
    emit ExecutorPaid(id, msg.sender, fee128);
}
```

An earlier draft cast to `uint128` before capping. With `tx.gasprice` near
`2^64` that cast silently truncates, so the cap is applied in `uint256` first.

`maxExecutorFee` bounds the payer's exposure. It matters because Arc's base fee
can legally rise from the 20 Gwei floor to the 20,000 Gwei ceiling — a 1,000×
move (§3.2). A flat tip alone would make execution unprofitable in a fee spike;
metered reimbursement alone would let a spike drain an obligation. The cap plus
the meter is the correct pair.

### 5.6 The post-quantum path

The digest binds chain, contract, obligation, action, payload, nonce and
deadline. Each is load-bearing: `chainid` and `address(this)` stop replay against
a testnet deployment or a redeploy; `pqNonce` stops replay against the same
obligation; `deadline` bounds the window a captured signature is useful for.

```solidity
bytes32 public constant DOMAIN_TAG = keccak256("WRIT_V1");

function digestFor(uint256 id, Action action, bytes memory payload, uint64 deadline)
    public view returns (bytes32)
{
    return keccak256(abi.encode(
        DOMAIN_TAG,
        block.chainid,
        address(this),
        id,
        uint8(action),
        keccak256(payload),
        obligations[id].pqNonce,
        deadline
    ));
}

function _requirePq(
    uint256 id, Obligation storage o,
    Action action, bytes memory payload,
    uint64 deadline, bytes calldata pqSig
) private {
    if (block.timestamp > deadline) revert Expired();

    // §3.4: the precompile REVERTS on a wrong length instead of returning
    // false. Validate here so a malformed signature yields a typed error.
    if (pqSig.length != PQ_SIG_LEN) revert BadSignatureLength();

    bytes32 d = digestFor(id, action, payload, deadline);

    bool ok = PQ.verifySlhDsaSha2128s(
        abi.encodePacked(o.pqKey),   // exactly 32 bytes, structurally
        abi.encodePacked(d),         // 32 bytes; the precompile accepts any length
        pqSig
    );
    if (!ok) revert BadSignature();

    emit PQVerified(id, action, d, o.pqNonce);
    o.pqNonce++;                     // consume the nonce only on success
}
```

The five PQ-gated entry points, each `payload`-bound so a signature for one
cannot authorize another:

```solidity
function amend(uint256 id, address newBeneficiary, uint128 newAmount,
               uint64 newPeriodSeconds, uint64 newEndTime, uint128 newMaxExecutorFee,
               uint64 deadline, bytes calldata pqSig) external nonReentrant;
    // payload = abi.encode(newBeneficiary, newAmount, newPeriodSeconds,
    //                      newEndTime, newMaxExecutorFee)

function cancelByPq(uint256 id, uint64 deadline, bytes calldata pqSig) external nonReentrant;
    // payload = ""   -> refunds o.balance to o.payer, state = Cancelled

function rotateKey(uint256 id, bytes32 newPqKey, uint64 deadline, bytes calldata pqSig) external;
    // payload = abi.encode(newPqKey)
    // newPqKey == bytes32(0) -> InvalidPqKey

function resolveQuarantine(uint256 id, address newBeneficiary,
                           uint64 deadline, bytes calldata pqSig) external nonReentrant;
    // payload = abi.encode(newBeneficiary)
    // state != Quarantined -> NotQuarantined
    // newBeneficiary == address(0) -> cancel and refund the payer
    // otherwise -> re-screen (InvalidBeneficiary / BeneficiaryBlacklisted),
    //              set beneficiary, state = Active

function vetoWalletCancel(uint256 id, uint64 deadline, bytes calldata pqSig) external;
    // payload = ""   -> cancelReadyAt = 0; NoCancelPending if none is pending
```

`amend` re-validates every new term against the same bounds as `open`, and
re-screens `newBeneficiary` against `isBlacklisted` so an amendment cannot move
a healthy obligation into a guaranteed failure.

**`amend` rules: `Active` only, the schedule is kept.**

| Rule | Check | Error |
| --- | --- | --- |
| Only a running obligation can be amended. A `Quarantined` one goes through `resolveQuarantine`; `Cancelled` and `Completed` are final | `state == Active` | `NotActive` |
| New beneficiary, amount, period and fee pass the §5.8 open checks | same as `open` | same as `open` |
| The new end date is not in the past and leaves room for at least one more payment | `newEndTime >= nextDueAt && newEndTime >= block.timestamp` | `InvalidEndTime` |

- **`nextDueAt` does not change.** The next payment happens when it was already
  scheduled, using the new beneficiary and amount. The new `periodSeconds`
  applies from then on: that payment sets `nextDueAt += newPeriodSeconds`.
  Invariant 5 (strictly increasing `nextDueAt`) is unaffected.
- If the obligation is overdue (`nextDueAt` in the past), the overdue periods
  are paid at the new amount to the new beneficiary. The terms in force at
  `execute` time are the ones that count.
- No upper bound on `newEndTime` beyond `uint64`. Extending it also pushes back
  `reclaim`; that is within the amendment authority, and the payer's 30-day
  wallet cancel is unaffected.
- A pending wallet cancel (`cancelReadyAt`) is left alone. Only
  `vetoWalletCancel` clears it.
- The balance is not checked against the new amount. An underfunded obligation
  pauses with `Underfunded` as usual (§6.3).

### 5.7 The lost-key backstop

Two independent protections, because `endTime` alone is too blunt for a 30-year
instrument.

```solidity
function beginWalletCancel(uint256 id) external {            // payer, ECDSA
    Obligation storage o = obligations[id];
    if (msg.sender != o.payer) revert NotPayer();
    if (o.state != State.Active && o.state != State.Quarantined) revert NotActive();
    o.cancelReadyAt = uint64(block.timestamp) + WALLET_CANCEL_DELAY;
    emit WalletCancelBegun(id, o.cancelReadyAt);
}

function finalizeWalletCancel(uint256 id) external nonReentrant {   // payer, ECDSA
    Obligation storage o = obligations[id];
    if (msg.sender != o.payer) revert NotPayer();
    if (o.cancelReadyAt == 0) revert NoCancelPending();
    if (block.timestamp < o.cancelReadyAt) revert CancelNotReady();
    _refundAndClose(id, o, false);
}
```

During the 30-day window the obligation **keeps paying**. That is deliberate: a
thief who has only the ECDSA key cannot stop payments, and the legitimate owner
with the key card can veto at any point before it fires. The attacker's best
outcome is to cost the owner 30 days of notice.

This is arc-guard's exit pattern, inverted. They let the wallet start an exit
that the PQ key cancels; the credit belongs to them and the README says so.

`vetoWalletCancel` reverts `NoCancelPending` when `cancelReadyAt == 0`, so a
veto signature is never spent on nothing.

**Refunds to a blocklisted payer revert.** Every refund path —
`cancelByPq`, `resolveQuarantine(id, address(0))`, `finalizeWalletCancel` and
`reclaim` — ends in `_refundAndClose`, which sends `o.balance` to `o.payer`.
`_refundAndClose` reads `USDC.isBlacklisted(o.payer)` first and, if it is true,
reverts `PayerBlacklisted()`. The read is free and turns Arc's receipt-less gas
burn (§1.3) into a typed error. Nothing changes: the balance, state, and
`cancelReadyAt` are as they were, and the PQ nonce is not consumed, because
the whole transaction reverts.

This is a revert, not a quarantine, on purpose. The refund destination is fixed
to the payer (invariant 3, §10), and there is no other address the contract
could choose without giving someone the authority to redirect the payer's
money. What still works while the payer is frozen: an `Active` obligation keeps
paying its beneficiary, and the PQ key can still `amend` it. If Circle later
unblocks the payer, the refund goes through. If not, the balance stays in the
contract, the same outcome a freeze would impose on USDC the payer held
directly.

### 5.8 `open`, `fund`, `reclaim`

```solidity
/// Payer = msg.sender. Pulls initialFunding with transferFrom (needs a prior approve).
function open(Terms calldata t, uint128 initialFunding)
    external nonReentrant returns (uint256 id)
{
    id = _open(t, msg.sender, initialFunding);
    if (!USDC.transferFrom(msg.sender, address(this), initialFunding)) revert TransferFailed();
}
```

`_open(t, payer, initialFunding)` runs the validation below, assigns
`id = nextId++`, writes the obligation with `state = Active`,
`nextDueAt = startAt`, `balance = initialFunding`, adds `initialFunding` to
`totalCommitted`, and emits `Opened` then `Funded`.

Validation, in order:

| Check | Error | Reason |
| --- | --- | --- |
| `beneficiary != address(0)` | `InvalidBeneficiary` | `address(0)` sends **revert** on Arc (§3.10) |
| `beneficiary != address(this)` | `InvalidBeneficiary` | would corrupt the `totalCommitted` invariant |
| `!USDC.isBlacklisted(beneficiary)` | `BeneficiaryBlacklisted` | do not open an obligation that cannot pay |
| `pqKey != bytes32(0)` | `InvalidPqKey` | an all-zero key is not a key |
| `amountPerPeriod > 0` | `ZeroAmount` | |
| `MIN_PERIOD <= periodSeconds <= MAX_PERIOD` | `InvalidPeriod` | bounds the `nextDueAt` arithmetic |
| `startAt >= block.timestamp` | `StartInPast` | a backdated start would make every missed period payable at once. Clients should pick a start a little in the future, because the transaction may be included a few seconds after it is signed |
| `endTime > startAt` and `endTime >= startAt + periodSeconds` | `InvalidEndTime` | at least one period must be payable |
| `maxExecutorFee > 0 && maxExecutorFee < amountPerPeriod` | `InvalidExecutorFee` | the fee can never exceed the payment |
| `initialFunding >= amountPerPeriod` | `InsufficientInitialFunding` | an obligation that cannot pay its first period is not an obligation |

#### Open and fund in one transaction

The primary path. It needs no `approve`, so §7.1 is one transaction.

```solidity
bytes32 public constant OPEN_AUTH_TAG = keccak256("WRIT_V1_OPEN_AUTH");
bytes32 public constant FUND_AUTH_TAG = keccak256("WRIT_V1_FUND_AUTH");

/// The EIP-3009 nonce a payer must sign to open obligation `id` with terms `t`.
/// chainid is not included: the USDC EIP-712 domain already binds the chain.
function openAuthNonce(uint256 id, Terms calldata t) public view returns (bytes32) {
    return keccak256(abi.encode(OPEN_AUTH_TAG, address(this), id, keccak256(abi.encode(t))));
}

/// Payer = from, not msg.sender, so a relayer may submit it.
function openWithAuthorization(
    Terms calldata t, address from, uint128 initialFunding, Authorization calldata a
) external nonReentrant returns (uint256 id) {
    id = nextId;
    if (a.nonce != openAuthNonce(id, t)) revert BadAuthorizationNonce();
    _open(t, from, initialFunding);
    USDC.receiveWithAuthorization(from, address(this), initialFunding,
                                  a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
}
```

**Why the nonce is bound to the id and the terms.** `receiveWithAuthorization`
only checks that `msg.sender == to`, and `to` is Writ. So anyone who sees a
signed authorization can hand it to Writ. If the nonce were free, they could
submit it under a different obligation id, or open an obligation with the
payer's money and **their own beneficiary**. Making the nonce a hash of
`(address(this), id, terms)` means the USDC contract itself rejects any use
other than the one the payer signed: change any term or the id and the
signature no longer matches. That is also what makes relayed submission safe.

The client predicts `id` by reading `nextId()`. If another `open` lands first,
the id moves on, the call reverts `BadAuthorizationNonce` before any USDC
moves, and the authorization is still unused. The UI re-reads `nextId` and asks
for a new signature. `shared/` computes the same nonce in TypeScript, and a
committed fixture checks it against `openAuthNonce` the same way as
`digestFor` (§11.1).

**ASSUMPTION:** §3.8 proved `receiveWithAuthorization` exists on Arc's USDC but
only exercised its failure path. A contract calling it successfully is checked
by fork test §11.3 row 7 before anything depends on it.

#### Topping up

```solidity
function fundAuthNonce(uint256 id, bytes32 salt) public view returns (bytes32) {
    return keccak256(abi.encode(FUND_AUTH_TAG, address(this), id, salt));
}

/// EIP-3009, same binding: the nonce commits to the id, and a fresh `salt`
/// makes each top-up's nonce unique.
function fundWithAuthorization(
    uint256 id, address from, uint128 value, bytes32 salt, Authorization calldata a
) external nonReentrant {
    if (a.nonce != fundAuthNonce(id, salt)) revert BadAuthorizationNonce();
    _credit(id, value, from);
    USDC.receiveWithAuthorization(from, address(this), value,
                                  a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s);
}

/// Fallback for wallets that cannot sign EIP-712 EIP-3009 payloads.
function fund(uint256 id, uint128 amount) external nonReentrant {
    _credit(id, amount, msg.sender);
    if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
}

/// Every top-up ends here.
function _credit(uint256 id, uint128 amount, address from) private {
    Obligation storage o = obligations[id];
    if (o.state != State.Active && o.state != State.Quarantined) revert NotFundable();
    if (amount == 0) revert ZeroAmount();
    o.balance      += amount;
    totalCommitted += amount;
    emit Funded(id, from, amount, o.balance);
}
```

`_credit` accepts only `Active` and `Quarantined`, the two states that can still
pay out or be resolved. The other three would strand the deposit:

| State | Why a deposit there is lost |
| --- | --- |
| `None` | the id was never opened. There is no payer, so no function can ever move the money |
| `Cancelled` | the obligation will never pay again and has already been refunded |
| `Completed` | the obligation will never pay again. The payer could only recover it through `reclaim` after `endTime + RECLAIM_GRACE`, which is a mistake to rely on |

Anyone may fund any live obligation. There is no reason to restrict it and a
third party topping up a retainer is a legitimate flow.

```solidity
/// After endTime + grace, the payer recovers whatever is left. This is the
/// release valve for a Completed or stranded obligation.
function reclaim(uint256 id) external nonReentrant {
    Obligation storage o = obligations[id];
    if (msg.sender != o.payer) revert NotPayer();
    if (block.timestamp < o.endTime + RECLAIM_GRACE) revert TooEarly();
    _refundAndClose(id, o, false);   // reverts PayerBlacklisted if the payer is frozen, §5.7
}
```

### 5.9 What the contract deliberately does not have

No `owner`. No `pause`. No proxy, no `delegatecall`, no upgrade path. No
`SELFDESTRUCT` — which on Arc would move the entire USDC balance out (§3.10). No
admin fee, no protocol fee, no treasury. No oracle. No off-chain signer other
than the obligation's own PQ key.

The contract cannot be stopped by its author, and the author cannot move a single
unit of anyone's USDC.

### 5.10 Errors

Every revert in the contract is one of these. No `require` strings.

```solidity
// state
error NotActive();                  // execute / amend / beginWalletCancel in the wrong state
error NotQuarantined();             // resolveQuarantine when state != Quarantined
error NotFundable();                // _credit on None, Cancelled or Completed (§5.8)
error NotDue();                     // execute before nextDueAt
error Underfunded();                // execute with balance < amountPerPeriod
error TooEarly();                   // reclaim before endTime + RECLAIM_GRACE

// funding authority
error NotPayer();
error NoCancelPending();            // finalize / veto with cancelReadyAt == 0
error CancelNotReady();             // finalize before cancelReadyAt

// amendment authority (§5.6)
error Expired();                    // block.timestamp > deadline
error BadSignatureLength();         // pqSig.length != 7856, checked before the precompile
error BadSignature();               // precompile returned false

// term validation, shared by open, amend, resolveQuarantine, rotateKey (§5.8 table)
error InvalidBeneficiary();         // address(0) or address(this)
error BeneficiaryBlacklisted();
error InvalidPqKey();               // bytes32(0)
error ZeroAmount();                 // amountPerPeriod == 0, or a zero top-up
error InvalidPeriod();              // outside [MIN_PERIOD, MAX_PERIOD]
error StartInPast();                // open with startAt < block.timestamp
error InvalidEndTime();
error InvalidExecutorFee();         // 0, or >= amountPerPeriod
error InsufficientInitialFunding(); // initialFunding < amountPerPeriod

// EIP-3009 funding
error BadAuthorizationNonce();      // nonce not bound to this id (and terms), §5.8

// transfers
error TransferFailed();
error PayerBlacklisted();           // refund to a frozen payer, §5.7

// guard
error Reentrancy();
```

---

## 6. The arithmetic

### 6.1 Cost of an obligation over its life

All figures at the measured 20 Gwei floor (§3.2), `cost = gas × 2e-8`.

| Action | Gas | Cost | Source |
| --- | --- | --- | --- |
| Deploy `Writ` | **1,265,964** | $0.025 | **measured**, Arc testnet 2026-10-07 |
| `open` + initial funding | 248,373 | $0.0050 | **measured**, Arc testnet 2026-10-07 (`open` via `transferFrom`; the `approve` is a separate tx) |
| `fundWithAuthorization` | ~120,000 | $0.0024 | **ESTIMATE** |
| `execute` (pay one period) | 123,148 | $0.0025 | **measured**, Arc testnet 2026-10-07, before the quarantine pre-screen is added |
| `execute` (quarantine transition) | ~75,000 | $0.0015 | **ESTIMATE** |
| **any PQ action** | **433,953** | **$0.0087** | **measured, §3.5** |
| `amend` on testnet, real verification | 421,483 | $0.0084 | **measured**, Arc testnet 2026-10-07 |

A 10-year monthly obligation, 120 periods, two amendments:

```
open                     $0.0050
120 × execute            $0.2955
2   × PQ amendment       $0.0174
                         ───────
total lifetime gas       $0.3179
```

The same obligation under the incumbent shape, where every payment needs a PQ
signature: `120 × $0.0087 = $1.0440`, plus the payer must be present and holding
the key card 120 times. **Writ is 3.3× cheaper and requires the key zero
times.** The second number is the one that matters.

### 6.2 The 10¹² conversion, in full

This is the only place the two decimal conventions meet, and Circle's
documentation specifically warns that getting it wrong puts arithmetic off by
10¹².

```
tx.gasprice              = 20_000_000_010              wei, 18-decimal native USDC
gasUsed                  = 110_000                     (ESTIMATE for execute)
costNative               = 2.20e15                     18-decimal units
costNative / 1e12        = 2_200                        6-decimal units = $0.0022
+ EXECUTOR_TIP (10_000)  = 12_200                       = $0.0122
capped by maxExecutorFee
```

An executor is paid about $0.0122 for roughly $0.0022 of gas — a 5.5× margin
that makes a stranger's cron worth running. At the 20,000 Gwei ceiling the same
execution costs $2.20 of gas, the meter catches it, and `maxExecutorFee` is what
stops that from draining the obligation. A payer setting `maxExecutorFee` should
budget around 1% of `amountPerPeriod`; the contract enforces only that it is
below `amountPerPeriod`.

**The adversarial test for this constant is mandatory** (§11.2). Dividing in the
wrong direction here overpays an executor by a factor of a trillion, which is
exactly the class of bug Arc's documentation is warning about.

### 6.3 Runway

```
periodsFunded = balance / (amountPerPeriod + maxExecutorFee)
```

The UI shows this as a date, not a number, and warns below three periods. An
obligation that runs dry does not fail dangerously — `execute` reverts
`Underfunded` and the obligation waits. Nothing is lost; payments simply pause
until someone funds it.

---

## 7. User flows

### 7.1 Open an obligation — about 90 seconds

1. Connect any injected EVM wallet on chain 5042. No smart account, no migration,
   no approval.
2. **Create key card.** The browser runs `slh_dsa_sha2_128s.keygen()`. The
   32-byte public key goes on chain; the 64-byte secret stays local.
3. The UI **blocks** until the encrypted key card is downloaded. There is no
   recovery path for a key card lost before step 5, and the interface refuses to
   let that happen.
4. Enter beneficiary, amount, interval, end date, executor-fee cap, reference.
   `endTime` is mandatory and the field explains why (§2.4).
5. The UI reads `nextId()`, computes `openAuthNonce(id, terms)` (§5.8), and the
   wallet signs an EIP-3009 `ReceiveWithAuthorization` for `initialFunding`
   with that nonce. This is a signature, not a transaction.
6. Send one ordinary transaction: `openWithAuthorization(terms, from,
   initialFunding, auth)`. One transaction, no `approve`. ~$0.0042. If another
   obligation took the id first, it reverts `BadAuthorizationNonce` with no
   USDC moved, and the UI repeats step 5.

### 7.2 It pays itself

Nobody needs to do anything. When a period comes due, any stranger may call
`execute(id)` and be paid for it. The project ships a 15-line example cron so a
payer who wants belt-and-braces can run one, but the obligation does not depend
on it — and the README states plainly that at $0.0122 a call the incentive is
the mechanism, not a promise.

### 7.3 Change the beneficiary — the moment the product exists for

1. Click **Amend**. Enter the new beneficiary.
2. The UI asks for the key card and builds the digest:
   `keccak256(abi.encode(DOMAIN_TAG, 5042, writ, id, Action.Amend, keccak256(payload), pqNonce, deadline))`
3. SLH-DSA signs it in ~825 ms. 7,856 bytes.
4. Submit. The contract verifies through `0x1800…0004` and only then mutates.
   ~$0.0087.

Attempting the same change from the payer's wallet has no code path. There is no
function.

### 7.4 A frozen counterparty

The owner returns to find the obligation in `Quarantined` with a
`Quarantined(id, beneficiary, at)` event carrying the block timestamp — a
citable record of when the counterparty became unpayable. They call
`resolveQuarantine` with the key card, pointing at a successor address, or with
`address(0)` to cancel and take the balance back.

### 7.5 Verify, as a stranger

```bash
# the terms, and who may change them
cast call $WRIT "obligations(uint256)" 1 --rpc-url https://rpc.mainnet.arc.io

# the payer's wallet cannot redirect it: there is no such function
cast call $WRIT "amend(uint256,address,uint128,uint64,uint64,uint128,uint64,bytes)" ... 
#   -> reverts BadSignatureLength / BadSignature without a valid SLH-DSA signature

# the PQ key really is checked by the chain, not by the app
cast call 0x1800000000000000000000000000000000000004 \
  "verifySlhDsaSha2128s(bytes,bytes,bytes)(bool)" $VK $DIGEST $SIG \
  --rpc-url https://rpc.mainnet.arc.io
```

---

## 8. Failure modes

| # | Failure | Consequence | Handling |
| --- | --- | --- | --- |
| 1 | PQ key card lost | terms frozen; obligation pays to `endTime` | mandatory bounded `endTime`; `beginWalletCancel` gives the payer a 30-day exit; `reclaim` after `endTime + grace` |
| 2 | Payer ECDSA key stolen | attacker cannot redirect, cannot stop payments | §9.1. Worst case: a 30-day cancel the key card vetoes |
| 3 | **Both** keys compromised | total loss of the obligation balance | not mitigated. Stated in §9.3 |
| 4 | Beneficiary blocklisted | payments stop, nothing burns | `Quarantined`; `resolveQuarantine` redirects or refunds |
| 5 | Beneficiary self-destructs | non-zero-value call reverts (§3.10) | `execute` reverts `TransferFailed`; payer uses the 30-day exit, or the key card amends |
| 6 | **Writ itself blocklisted** | every outbound transfer reverts; all balances frozen | **not mitigable.** Circle controls the blocklist. Stated in §9.2 and §15 |
| 7 | Nobody executes | payments simply late | permanently callable by anyone; the fee makes it worth doing; a 15-line cron ships as a convenience |
| 8 | Obligation runs dry | `execute` reverts `Underfunded` | payments pause; anyone may `fund`; nothing is lost |
| 9 | Gas spikes to the 20,000 Gwei ceiling | execution could become unprofitable | metered reimbursement tracks it; `maxExecutorFee` caps the payer's exposure; worst case payments pause until the spike passes |
| 10 | Malformed PQ signature submitted | precompile would **revert** opaquely (§3.4) | length pre-validated; caller gets `BadSignatureLength` |
| 11 | Captured PQ signature replayed | none | digest binds chainid, contract, id, action, payload, `pqNonce`, deadline; nonce consumed on success |
| 12 | Clock skew around `nextDueAt` | a period pays a few seconds early or late | tolerated; `periodSeconds >= 1 hour` makes it immaterial |
| 13 | Executor front-runs another executor | one wins, one reverts `NotDue` cheaply | acceptable; it is a race for $0.0122 |
| 14 | Payer blocklisted when a refund is due | refund transfer would burn gas with no receipt | pre-checked; reverts `PayerBlacklisted`, nothing changes; obligation keeps paying if `Active`. §5.7 |
| 15 | Someone resubmits a payer's EIP-3009 authorization under another id or other terms | would redirect the payer's funding | nonce is bound to `(address(this), id, terms)`; reverts `BadAuthorizationNonce`. §5.8 |
| 16 | USDC sent via `fund` to an id that is `None`, `Cancelled` or `Completed` | would be stranded | `_credit` reverts `NotFundable`. §5.8 |

---

## 9. Threat model

### 9.1 What an attacker cannot do

With the payer's ECDSA key alone — the realistic compromise, and the one §1.4 is
about:

- **Cannot change the beneficiary.** No function accepts that from a wallet.
- **Cannot change the amount or interval.** Same.
- **Cannot stop payments.** `beginWalletCancel` takes 30 days and the key card
  vetoes it. Payments continue throughout the window.
- **Cannot drain the balance.** `reclaim` only unlocks at `endTime + 30 days`.
- Can only fund the obligation further, or cost the owner 30 days of notice.

With the ability to call `execute` — i.e. anyone:

- Cannot choose the recipient, the amount or the timing. All three are already
  fixed in storage.
- Cannot extract more than `maxExecutorFee`, and cannot execute twice in a period.

With a captured PQ signature:

- Cannot replay it on another chain, another deployment, another obligation,
  another action, or the same obligation twice. See §8 row 11.

### 9.2 What is deliberately trusted

- **Circle.** USDC on Arc is centrally freezable and the blocklister is
  `0x2a2b7ff3…8467`. Circle can freeze this contract and strand every balance.
  There is no design that avoids this on a chain whose native asset is USDC, and
  pretending otherwise would be dishonest.
- **Arc's validator set.** Eleven permissioned institutional validators, PoA
  Tendermint-based consensus.
- **The PQ precompile's correctness.** If Arc's `SLH-DSA-SHA2-128s`
  implementation has a verification bug, the amendment authority is broken.
  Mitigated only by it being a NIST-standardised scheme in a protocol
  implementation, and by §11.3 testing it against a known-good library.
- **`@noble/post-quantum`** for key generation and signing in the browser.

### 9.3 What it does not claim

- It does **not** claim quantum-safe *spending*. Funding and execution are
  ordinary ECDSA/EVM. Arc has no native PQ transaction signing yet (§3.12). The
  post-quantum property covers **amendment authority only**, and that is the
  claim the README makes.
- It does **not** protect against a compromise of both keys.
- It does **not** earn yield on idle balances. USYC is unavailable (§3.3) and
  adding a lending integration would put lending risk inside a safety product.
- It does **not** have users. It is a proof of concept with a live mainnet
  deployment and one real obligation.

---

## 10. Invariants

Checked by Foundry invariant tests (§11.4) and worth asserting in review.

| # | Invariant |
| --- | --- |
| 1 | `totalCommitted == Σ obligations[i].balance` for all live `i` |
| 2 | `USDC.balanceOf(address(this)) >= totalCommitted` — the contract never holds less than it owes |
| 3 | USDC leaves the contract only to `beneficiary`, `msg.sender` of `execute` (capped), or `payer` on refund. No other destination appears in any transfer |
| 4 | `obligations[id].pqNonce` is strictly increasing and only increments after a successful verification |
| 5 | `obligations[id].nextDueAt` is strictly increasing |
| 6 | `beneficiary`, `amountPerPeriod`, `periodSeconds` and `endTime` change **only** inside a function that has called `_requirePq` |
| 7 | `pqKey` changes only via `rotateKey`, which requires a signature from the key being replaced |
| 8 | `executorFee <= maxExecutorFee < amountPerPeriod` on every execution |
| 9 | `state` transitions only along: `Active → {Quarantined, Cancelled, Completed}`, `Quarantined → {Active, Cancelled}`. No path returns to `None` |
| 10 | No code path reads or writes `msg.value`; the contract is not `payable` |

Invariant 10 is the structural guard against the 10¹² decimal class of bug:
there is exactly one multiplication by `tx.gasprice` and exactly one division by
`NATIVE_TO_ERC20`, both inside `_payExecutor`.

---

## 11. Test plan

### 11.1 Unit — Foundry, precompile mocked

Local anvil has no Arc precompiles, so mock `0x1800…0004`. USDC is
`contracts/test/mocks/MockUSDC.sol`, placed at `0x3600…0000` with
`deployCodeTo`:

```solidity
vm.mockCall(
    0x1800000000000000000000000000000000000004,
    abi.encodeWithSelector(IPQVerify.verifySlhDsaSha2128s.selector),
    abi.encode(true)
);
```

Generate real fixtures with `@noble/post-quantum` once, commit them as JSON, and
assert the contract builds the identical digest. This is `pq-provenance`'s
approach and it is the right one: the signature bytes are real, only the
verifier is simulated. The same fixture file pins `openAuthNonce` and
`fundAuthNonce` against the TypeScript in `shared/`.

Implemented as: `scripts/gen-fixtures.ts` writes `shared/fixtures/digest.json`
from `shared/digest.ts`. `test/digest.test.ts` (Node) and
`contracts/test/DigestParity.t.sol` (Foundry) both check against it, the latter
by reproducing each case's `chainid` (`vm.chainId`), contract address
(`deployCodeTo`) and `pqNonce` (real amends). Changing one byte of one fixture
fails both suites.

Coverage: open validation (every row of the §5.8 table), funding by both paths,
execute when due and not due, catch-up across three periods, completion at
`endTime`, quarantine and resolution both ways, amend of every field, key
rotation, cancel by PQ, the full wallet-cancel/veto/finalize dance, reclaim
timing, executor fee capping.

### 11.2 Adversarial

The tests that matter.

| Test | Must |
| --- | --- |
| `amend` with no signature, wrong key, wrong nonce, expired deadline | revert `BadSignature` / `Expired` |
| `amend` with a signature for a **different action** | revert `BadSignature` |
| `amend` with a signature for a **different obligation id** | revert `BadSignature` |
| `amend` with a signature valid on **chainid 5042002** replayed on 5042 | revert `BadSignature` |
| the same valid signature submitted **twice** | second reverts `BadSignature` (nonce consumed) |
| `pqSig.length` of 0, 7855, 7857 | revert `BadSignatureLength`, **never** the precompile's own revert |
| payer calls every PQ-gated function | no such code path exists; assert by ABI absence |
| `finalizeWalletCancel` one second early | revert `CancelNotReady` |
| `vetoWalletCancel` then `finalizeWalletCancel` | revert `NoCancelPending` |
| `execute` twice in the same period | second reverts `NotDue` |
| **executor fee at `tx.gasprice` = 20,000 Gwei** | fee capped at `maxExecutorFee`, obligation not drained |
| **`NATIVE_TO_ERC20` inverted** (mutation test) | fee at the 20 Gwei floor is pinned to `EXECUTOR_TIP` + meter (a few thousand units). Inverting or shrinking the constant pushes the fee to `maxExecutorFee` and the test fails. Invariant 2 alone would not catch it, because the cap still holds |
| reentrant USDC that calls back into `execute` | guard holds, invariant 1 holds |
| beneficiary blocklisted mid-life | `Quarantined`, no gas-burning transfer attempt |
| `amend` on a `Quarantined`, `Cancelled` or `Completed` obligation | revert `NotActive` |
| `amend` with `newEndTime < nextDueAt` or in the past | revert `InvalidEndTime` |
| `amend` changing `periodSeconds` | `nextDueAt` unchanged; the following `execute` advances it by the **new** period |
| `openWithAuthorization` with a valid authorization but a **different id** or **any changed term** | revert `BadAuthorizationNonce`, no USDC moved |
| `fundWithAuthorization` authorization resubmitted for another id | revert `BadAuthorizationNonce` |
| `fund` / `fundWithAuthorization` on an id in `None`, `Cancelled`, `Completed` | revert `NotFundable` |
| every refund path with `isBlacklisted(payer)` mocked true | revert `PayerBlacklisted`; balance, state, `pqNonce` unchanged |
| fuzz `amountPerPeriod`, `periodSeconds`, `maxExecutorFee` across full ranges | no overflow, no stuck state |

### 11.3 Fork and live — the tests a mock cannot replace

```bash
cd contracts && forge test --fork-url arc_testnet --match-contract WritForkTest -vv
```

**A vanilla `forge` fork cannot execute Arc's precompiles.** They are native
node code. The fork sees only a placeholder byte at `0x1800…0004` (`0x01` on
testnet, measured 2026-10-07) and the local EVM runs it as bytecode, so the
call fails. Measured: an in-fork call returns `success = false` with empty
return data. The same applies to the USDC facade, which reads native balances
through a system precompile.

So `contracts/test/WritFork.t.sol` sends each verification to the real node as
an `eth_call` via `vm.rpc`, then replays that verdict into the fork with a
`vm.mockCall` keyed on the **exact** calldata. If Writ sent any other bytes, no
mock would match, the call would hit the placeholder and `amend` would revert.
A passing `amend` therefore proves Writ sends exactly the bytes the real
precompile accepted. USDC is `MockUSDC` on the fork too. **ASSUMPTION:** Arc
Foundry (`arc-forge`) may execute the precompiles in-fork, which would remove
this indirection. Not yet tried.

1. **The real precompile accepts the real signature.** Generate a keypair in
   Node, sign a digest the contract computed, and verify through
   `0x1800…0004`. This is the test that catches the pure-vs-internal variant
   trap (§3.4). **Implemented** against testnet with the committed
   `shared/fixtures/pq-amend.json`, together with the `.internal` rejection
   and a one-bit-flipped digest.
2. **Wrong-length inputs revert, not return false** — pin §3.4's table as a
   test so a future Arc upgrade that changes it fails loudly here.
   **Implemented** for a 31-byte key and a 7,855-byte signature.
3. **A real `USDC.transfer` from a contract succeeds**, including to a contract
   beneficiary (§3.7 control).
4. **`isBlacklisted` answers** for a known-good address.
5. **Memo is unreachable from a contract.** Assert the revert string
   `"sender spoofing requires tx.origin as sender"`. If a future Arc release
   lifts this, the test fails and the design can be revisited.
6. **Gas pins:** assert one PQ action costs 433,953 ± 5%, and record `execute`'s
   real cost to replace the §6.1 estimates with measurements.
7. **`receiveWithAuthorization` succeeds when Writ calls it.** Sign a real
   EIP-3009 authorization against the mainnet USDC domain and run
   `openWithAuthorization` on a fork. Retires the **ASSUMPTION** in §5.8.
8. **Quarantine end to end — this is the quarantine demo.** On a mainnet fork,
   open an obligation to a clean beneficiary, then
   `vm.mockCall(USDC, abi.encodeCall(IUSDC.isBlacklisted, (beneficiary)), abi.encode(true))`.
   `execute` must move it to `Quarantined`, emit `Quarantined`, pay the
   executor, and make **no** `transfer` call to the beneficiary
   (`vm.expectCall(..., 0)`). Then `resolveQuarantine` with a real SLH-DSA
   signature through the real precompile, once to a successor (back to
   `Active`, next `execute` pays the successor) and once with `address(0)`
   (refund to payer). Everything except the one mocked read is real mainnet
   state. Record it with `-vvvv` for the demo video.

### 11.4 Invariant / fuzz

Foundry invariant campaign over `open`/`fund`/`execute`/`amend`/`cancel` with a
handler that drives random actors, random times (`vm.warp`) and random gas
prices, asserting all ten invariants in §10 after every call.

### 11.5 Free mainnet rehearsal before spending anything

The whole contract can be exercised against **live mainnet state** for $0 using
`eth_call` with state overrides — inject the runtime bytecode at an unused
address, override a funded balance, and call it:

```bash
cast rpc eth_call \
  '{"from":"0x…","to":"0x…PROBE","data":"0x…","gas":"0x2625a0"}' \
  'latest' \
  '{"0x…PROBE":{"code":"0x…RUNTIME","balance":"0xde0b6b3a7640000"}}' \
  --rpc-url https://rpc.mainnet.arc.io
```

Every fact in §3 was established this way. Do the full flow here before
deploying; it costs nothing and it is the cheapest bug-finding available.

---

## 12. Deployment runbook

### 12.1 Toolchain

Install **Arc Foundry** — `arc-forge`, `arc-cast`, `arc-anvil`. It is an
Arc-specific fork that handles the protocol divergences in §3.10. Vanilla
`forge` will mislead you on decimals and the fee floor.

Pin the toolchain and commit the versions. Several of the strongest entries in
this field do, and it reads as discipline.

`foundry.toml` must enable the IR pipeline. Without it the 14-field public
`obligations` getter and the 8-parameter `amend` fail with stack-too-deep:

```toml
[profile.default]
solc_version   = "0.8.30"
evm_version    = "prague"   # newest target solc 0.8.30 knows; Osaka is a superset
via_ir         = true
optimizer      = true
optimizer_runs = 200
```

Sourcify verification (§12.5) needs the same settings, so `via_ir` is part of
the build, not a local workaround.

### 12.2 Testnet first, free

```bash
export RPC=https://rpc.testnet.arc.io          # chain 5042002
# faucet.circle.com -> Arc Testnet -> USDC

arc-forge create src/Writ.sol:Writ \
  --rpc-url $RPC --private-key $PK \
  --gas-price 20gwei --priority-gas-price 1gwei
```

Run the full §7 flow with a real key card. Replace every **ESTIMATE** in §6.1
with a measured receipt.

### 12.3 Get USDC onto Arc mainnet

USDC *is* the gas token, so nothing happens before this.

1. **CEX withdrawal, recommended.** Binance, Kraken, OKX and Bybit were Arc
   launch partners; withdraw USDC on the Arc network directly. Typically $0–1,
   no source-chain gas.
2. **CCTP** from Base / Arbitrum / Ethereum. Works, but you pay source-chain gas
   ($1–5 on an L2).

### 12.4 Mainnet

```bash
export RPC=https://rpc.mainnet.arc.io          # chain 5042, anonymous, open CORS
export PK=0x…                                   # a FRESH key, ~$15 USDC

arc-forge create src/Writ.sol:Writ \
  --rpc-url $RPC --private-key $PK \
  --gas-price 20gwei --priority-gas-price 1gwei
```

`maxFeePerGas` **must** be ≥ 20 Gwei (§3.2) or the transaction may never be
included.

### 12.5 Verify the source

Sourcify supports chain 5042 — another mainnet project in this field has an
exact-match verification there.

```bash
arc-forge verify-contract $ADDRESS src/Writ.sol:Writ \
  --verifier sourcify --chain 5042
```

Publish the Sourcify link and the `keccak256` of the runtime bytecode in the
README. It is the cheapest credibility in the submission.

### 12.6 Frontend

Static Next.js on Vercel's free tier. `@noble/post-quantum@0.7.1` pinned, pure
JS, no WASM. Use `S.sign(msg, secretKey)` — the **pure** FIPS-205 API — and
never `S.internal.sign` (§3.4). Expect ~825 ms per signature.

Do not build a historical payments table on the public RPC; it does not serve
log history (§3.9).

---

## 13. Cost

### 13.1 Arc gas, measured

`cost_USDC = gas × 2e-8` at the 20 Gwei floor.

| Item | Gas | Cost |
| --- | --- | --- |
| Deploy | **1,265,964** measured | $0.025 |
| `open` + fund | 248,373 measured | $0.0050 |
| `execute` | 123,148 measured | $0.0025 |
| **PQ action — measured** | **433,953** | **$0.0087** |

### 13.2 Total to build and demo this project

| | |
| --- | --- |
| Testnet (faucet) | $0.00 |
| 3 mainnet deploys / redeploys | $0.15 |
| ~20 PQ-verify demo transactions | $0.17 |
| ~80 ordinary demo transactions | $0.12 |
| USDC funding one live demo obligation (recoverable via `reclaim`) | $2.00 |
| **Arc on-chain total** | **≈ $2.50** |
| Getting the first USDC onto Arc | $0 – $1 |
| Vercel hosting | $0 |
| **Budget** | **$15 of USDC on Arc — roughly 6× headroom** |

Arc gas is effectively free. The only real constraint is bridging the first
dollar in.

---

## 14. Build order

Eight days, 2026-10-06 → 2026-10-13. Submission deadline 2026-10-14 23:59 ET;
review is rolling and earlier submissions get earlier answers.

| Day | Work | Gate |
| --- | --- | --- |
| **1 — Oct 6** | Scaffold with Arc Foundry. Port the §11.5 probe harness. Write `Writ.sol` through `execute`. **Start the USDC transfer onto Arc today — it blocks everything** | contract compiles; probe harness reproduces §3.4 |
| **2 — Oct 7** | PQ path: `digestFor`, `_requirePq`, `amend`, `cancelByPq`, `rotateKey`, `resolveQuarantine`, `vetoWalletCancel`. Wallet-cancel dance. `reclaim` | all entry points present |
| **3 — Oct 8** | §11.1 unit suite with real noble fixtures. §11.2 adversarial suite in full — especially the five replay tests and the inverted-constant mutation | suite green; mutation test fails when the constant is inverted |
| **4 — Oct 9** | Testnet deploy. Full §7 flow with a real key card. §11.3 fork tests. **Replace every ESTIMATE in §6.1 with a measured receipt** | one real PQ amendment landed on testnet |
| **5 — Oct 10** | §11.5 free mainnet rehearsal via state override, then **mainnet deploy** + Sourcify verify. Open one live demo obligation and execute one real period | mainnet address verified; `Paid` event on chain |
| **6 — Oct 11** | Frontend: key-card generation with forced download, open flow, amend flow with the signing spinner, runway display. Mobile check | a stranger can complete an amendment on mainnet in a browser |
| **7 — Oct 12** | README: the "What it uses Arc for" table with gas and real tx links, the §6.1 cost comparison, §16 naming every competitor, honest limits from §9.3 and §15. **Strip internal docs from the public tree** | repo is clean; no internal planning files |
| **8 — Oct 13** | Demo video (≤3 min, no AI voice). **Submit.** | submitted |

Day 1's funding step is the only hard external dependency. If the USDC does not
arrive, days 5–8 cannot happen.

---

## 15. Open items and known limits

1. **`REIMBURSE_OVERHEAD` is an estimate.** Calibrate from a real testnet
   receipt on day 4. Too low and executors are slightly underpaid; too high and
   they are slightly overpaid. Neither is dangerous, both are sloppy.
2. **The quarantine demo cannot use a genuinely blocklisted address.** The public
   RPC does not serve log history (§3.9), so I could not enumerate real
   `Blacklisted` events, and nobody outside Circle can blocklist an address on
   testnet or mainnet. Only `isBlacklisted` triggers quarantine: `open` rejects
   `address(0)`, and a self-destructed beneficiary gives `TransferFailed`, not
   `Quarantined`. So the demo is a **mainnet fork test** (§11.3 row 8) that runs
   the real contract against real chain state and mocks only the one
   `isBlacklisted` answer. It is shown as test output, not in the web UI. Say
   this in the README rather than imply a frozen-counterparty demo that is not
   what it looks like.
3. **No native memo is possible** (§3.7). The `Paid` event carries the reference
   instead. If Arc ever lifts the `tx.origin` constraint on `CallFrom`, routing
   payments through `Memo` becomes possible and the fork test in §11.3 row 5
   will fail to tell you.
4. **No yield on idle balances.** USYC supply on Arc is zero and access is gated
   to non-US institutions at a $100,000 minimum (§3.3). Aave V4 and Morpho are
   live on Arc, but adding lending risk to a safety product is the wrong trade.
   Stated as a non-goal, not a roadmap item.
5. **PQ key cards are browser-generated.** No hardware wallet supports SLH-DSA
   and Arc's documentation says so. This is a transition-period design. Encrypted
   export, forced download, and `rotateKey` are the mitigations.
6. **One asset.** USDC only. EURC is live on Arc but at €5.70M total supply
   (§3.3) a euro-denominated obligation has no realistic user. The contract is
   trivially generalisable to any 6-decimal token; it is deliberately not
   generalised in v1.
7. **Circle can freeze this contract** and strand every obligation balance
   (§9.2). Unmitigable.
8. **Catch-up is one period per call.** A year-long gap needs twelve
   transactions. Acceptable, and documented in the UI.

---

## 16. Competitive position, stated honestly

The Arc Microgrants field is large — roughly 700 registered hackers — and the
post-quantum niche is the most contested differentiated category in it, because
the PQ precompile is the one thing Arc has that no other chain does, and every
strong builder found it.

Known entries using `0x1800…0004`:

| Project | Shape | Where Writ differs |
| --- | --- | --- |
| `Jayanthkoppala/arc-guard` | Two-key USDC safe deposit box, wallet + SLH-DSA on every withdrawal, Morpho yield, 7-day exit. Live and polished | PQ gates the *rule*, not the action: 433,953 gas once per amendment instead of once per movement (§6.1). The 30-day vetoable cancel is their exit pattern, credited |
| `Iniwura/interlock` | Hybrid PQ authorization vault. Mainnet, source SHA pinned | Their frontend is **deliberately read-only** and never handles a key, so a reviewer cannot complete a PQ action. Writ's does, in a browser, on mainnet |
| `efeberk21/ArcMandate` | Bounded spending session for a software agent, wallet + PQ management approval | Closest concept. **Their mainnet management is disabled pending release checks.** Also session-scoped and agent-focused rather than long-dated |
| `0xHUMAN-AI/pq-provenance` | PQ attestation registry, Sourcify exact-match | No funds, no obligations. Different product; its testing approach is borrowed in §11.1 |
| `salmanabjam/bix-arc-safesign` | Hybrid wallet + PQ approval proof | Approval proof, not a standing obligation |
| `rifat98pro/upKEEP` | Conditional financial automation engine + SDK on Arc mainnet | Conditions and actions, PQ is not its trust root |

**The honest summary:** this is not an unclaimed niche. The argument for
Writ is three specific, checkable things — the inverted authority model and
its cost curve (§2.1, §6.1), a reviewer being able to complete a post-quantum
action on mainnet from a browser in under a minute (§7.3), and quarantine as a
first-class state, which no entry in this field implements (§2.3).

The README names every project above. In a field this crowded, engaging the
prior art reads better than pretending it does not exist.

---

## 17. Sources

**Measured on Arc mainnet 2026-10-06, block 24,510,277** — chain id, gas price,
USDC / EURC / USYC supplies, `blacklister()`, `isBlacklisted`, EIP-3009 and
EIP-2612 liveness, the `CallFrom` allowlist and its `tx.origin` constraint, the
`Memo` disassembly and selector recovery, PQ precompile openness, the pure-vs-
internal signature variant, the malformed-length revert table, and the 433,953
gas figure. Reproduction commands are inline in §3.

**Arc documentation** — `docs.arc.io`: `arc/references/evm-differences`,
`arc/concepts/execution-layer`, `arc/concepts/post-quantum-security`,
`arc/concepts/opt-in-privacy`, `arc/references/contract-addresses`,
`arc/references/gas-and-fees`, `arc/references/rpc-endpoints`,
`arc/references/usdc-system-events`, `arc/concepts/transaction-memos`,
`arc/concepts/batched-transactions`, `build/agentic-economy`,
`build/stablecoin-fx`.

**Standards** — FIPS 205 (SLH-DSA), EIP-3009, EIP-2612, EIP-7708, EIP-1967,
EIP-8141 (draft).

**Libraries** — `@noble/post-quantum@0.7.1`.

**Prior art** — the six projects in §16, read from their public repositories.
