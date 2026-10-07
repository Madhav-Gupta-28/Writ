// Writes the fixtures that pin shared/digest.ts to Writ.digestFor().
//
//   shared/fixtures/digest.json      deterministic digest and EIP-3009 nonce vectors
//                                    (both test suites read it)
//   shared/fixtures/pq-amend.json    a real SLH-DSA-SHA2-128s signature over an amend
//                                    digest, for WritFork.t.sol. Written with --pq.
//   shared/fixtures/pq-resolve.json  real signatures over resolveQuarantine digests
//                                    (successor and cancel), for WritQuarantineFork.t.sol.
//                                    Written with --pq-resolve.
// The two pq fixtures use random throwaway keys, so they are only rewritten on request.
//
// Usage: node scripts/gen-fixtures.ts [--pq] [--pq-resolve]

import { writeFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import { encodeAbiParameters, toHex, type Address, type Hex } from "viem";
import { Action, EMPTY_PAYLOAD, amendPayload, digestFor, resolveQuarantinePayload, rotateKeyPayload, type DigestInput } from "../shared/digest.ts";
import { fundAuthNonce, openAuthNonce, type Terms } from "../shared/auth.ts";

const OUT = new URL("../shared/fixtures/", import.meta.url);

const MAINNET = 5042n;
const TESTNET = 5042002n;
const U64_MAX = 2n ** 64n - 1n;

const amend = amendPayload({
  newBeneficiary: "0x00000000000000000000000000000000000beef1",
  newAmount: 1_000_000n,
  newPeriodSeconds: 30n * 86400n,
  newEndTime: 4102444800n,
  newMaxExecutorFee: 10_000n,
});

// Cases with pqNonce > 0 must use id 1: the Solidity side reaches that nonce by
// opening obligation 1 and amending it pqNonce times. Each case gets its own
// Writ address so no case sees another's storage.
const cases: (DigestInput & { name: string })[] = [
  { name: "amend-mainnet", chainId: MAINNET, writ: "0x00000000000000000000000000000000000a0001", id: 1n, action: Action.Amend, payload: amend, pqNonce: 0n, deadline: 1767225600n },
  { name: "amend-testnet-same-inputs", chainId: TESTNET, writ: "0x00000000000000000000000000000000000a0002", id: 1n, action: Action.Amend, payload: amend, pqNonce: 0n, deadline: 1767225600n },
  { name: "cancel-unopened-id-empty-payload", chainId: MAINNET, writ: "0x00000000000000000000000000000000000a0003", id: 7n, action: Action.Cancel, payload: EMPTY_PAYLOAD, pqNonce: 0n, deadline: 0n },
  { name: "rotate-key-nonce-2-max-deadline", chainId: MAINNET, writ: "0x00000000000000000000000000000000000a0004", id: 1n, action: Action.RotateKey, payload: rotateKeyPayload(toHex(1n, { size: 32 })), pqNonce: 2n, deadline: U64_MAX },
  { name: "resolve-quarantine-nonce-1", chainId: TESTNET, writ: "0x00000000000000000000000000000000000a0005", id: 1n, action: Action.ResolveQuarantine, payload: resolveQuarantinePayload("0x00000000000000000000000000000000000beef2"), pqNonce: 1n, deadline: 1800000000n },
  { name: "veto-huge-id", chainId: MAINNET, writ: "0xffffffffffffffffffffffffffffffffffff0006", id: 2n ** 255n + 12345n, action: Action.VetoWalletCancel, payload: EMPTY_PAYLOAD, pqNonce: 0n, deadline: 1n },
];

const s = (n: bigint) => n.toString();

// EIP-3009 nonce vectors (§5.8). openAuthNonce / fundAuthNonce are views that
// depend only on address(this) and their arguments, so any id works.
const baseTerms: Terms = {
  beneficiary: "0x00000000000000000000000000000000000beef1",
  amountPerPeriod: 1_000_000n,
  periodSeconds: 3600n,
  startAt: 1800000000n,
  endTime: 1800000000n + 24n * 3600n,
  maxExecutorFee: 20_000n,
  pqKey: toHex(0xabcn, { size: 32 }),
  ref: toHex(0x5eedn, { size: 32 }),
};
const openCases: { name: string; writ: Address; id: bigint; terms: Terms }[] = [
  { name: "open-id-1", writ: "0x00000000000000000000000000000000000b0001", id: 1n, terms: baseTerms },
  { name: "open-id-2-same-terms", writ: "0x00000000000000000000000000000000000b0001", id: 2n, terms: baseTerms },
  { name: "open-other-beneficiary", writ: "0x00000000000000000000000000000000000b0001", id: 1n, terms: { ...baseTerms, beneficiary: "0x00000000000000000000000000000000000beef2" } },
  { name: "open-other-writ-max-values", writ: "0xffffffffffffffffffffffffffffffffffff0002", id: 2n ** 256n - 1n,
    terms: { ...baseTerms, amountPerPeriod: 2n ** 128n - 1n, periodSeconds: 2n ** 64n - 1n, startAt: 2n ** 64n - 1n, endTime: 2n ** 64n - 1n, maxExecutorFee: 2n ** 128n - 2n, pqKey: toHex(2n ** 256n - 1n, { size: 32 }) } },
];
const fundCases: { name: string; writ: Address; id: bigint; salt: Hex }[] = [
  { name: "fund-id-1", writ: "0x00000000000000000000000000000000000b0001", id: 1n, salt: toHex(1n, { size: 32 }) },
  { name: "fund-id-2-same-salt", writ: "0x00000000000000000000000000000000000b0001", id: 2n, salt: toHex(1n, { size: 32 }) },
  { name: "fund-other-writ", writ: "0xffffffffffffffffffffffffffffffffffff0002", id: 1n, salt: toHex(1n, { size: 32 }) },
];
const termsJson = (t: Terms) => ({
  beneficiary: t.beneficiary, amountPerPeriod: s(t.amountPerPeriod), periodSeconds: s(t.periodSeconds),
  startAt: s(t.startAt), endTime: s(t.endTime), maxExecutorFee: s(t.maxExecutorFee), pqKey: t.pqKey, ref: t.ref,
});

writeFileSync(
  new URL("digest.json", OUT),
  JSON.stringify(
    {
      note: "Generated by scripts/gen-fixtures.ts from shared/digest.ts. Do not edit by hand.",
      count: cases.length,
      cases: cases.map((c) => ({
        name: c.name,
        chainId: s(c.chainId),
        writ: c.writ,
        id: s(c.id),
        action: c.action,
        payload: c.payload,
        pqNonce: s(c.pqNonce),
        deadline: s(c.deadline),
        digest: digestFor(c),
      })),
      openAuthCount: openCases.length,
      openAuth: openCases.map((c) => ({ name: c.name, writ: c.writ, id: s(c.id), terms: termsJson(c.terms), nonce: openAuthNonce(c.writ, c.id, c.terms) })),
      fundAuthCount: fundCases.length,
      fundAuth: fundCases.map((c) => ({ name: c.name, writ: c.writ, id: s(c.id), salt: c.salt, nonce: fundAuthNonce(c.writ, c.id, c.salt) })),
    },
    null,
    2,
  ) + "\n",
);
console.error(`wrote digest.json (${cases.length} digest cases, ${openCases.length} open-auth, ${fundCases.length} fund-auth)`);

if (process.argv.includes("--pq")) {
  const writ: Address = "0x00000000000000000000000000000000000f0001";
  const terms = {
    newBeneficiary: "0x00000000000000000000000000000000000beef1" as Address,
    newAmount: 2_000_000n,
    newPeriodSeconds: 7n * 86400n,
    newEndTime: 4102444800n,
    newMaxExecutorFee: 20_000n,
  };
  const input: DigestInput = { chainId: TESTNET, writ, id: 1n, action: Action.Amend, payload: amendPayload(terms), pqNonce: 0n, deadline: 4102444800n };
  const digest = digestFor(input);
  const msg = Buffer.from(digest.slice(2), "hex");

  const { publicKey, secretKey } = S.keygen();
  const pureSig = S.sign(msg, secretKey); // FIPS-205 pure: the only variant Arc accepts (§3.4)
  const internalSig = S.internal.sign(msg, secretKey); // Arc rejects this; kept to pin that
  if (!S.verify(pureSig, msg, publicKey)) throw new Error("pure signature does not verify locally");

  const hex = (b: Uint8Array): Hex => toHex(b);
  writeFileSync(
    new URL("pq-amend.json", OUT),
    JSON.stringify(
      {
        note: "Generated by scripts/gen-fixtures.ts --pq. Throwaway key; the secret key is not stored.",
        chainId: s(input.chainId),
        writ,
        id: s(input.id),
        pqKey: hex(publicKey),
        newBeneficiary: terms.newBeneficiary,
        newAmount: s(terms.newAmount),
        newPeriodSeconds: s(terms.newPeriodSeconds),
        newEndTime: s(terms.newEndTime),
        newMaxExecutorFee: s(terms.newMaxExecutorFee),
        deadline: s(input.deadline),
        digest,
        pureSig: hex(pureSig),
        internalSig: hex(internalSig),
      },
      null,
      2,
    ) + "\n",
  );
  console.error("wrote pq-amend.json");
}

if (process.argv.includes("--pq-resolve")) {
  const writ: Address = "0x00000000000000000000000000000000000f0002";
  const successor: Address = "0x00000000000000000000000000000000005cc355";
  const deadline = 4102444800n;
  const { publicKey, secretKey } = S.keygen();
  const signFor = (to: Address) => {
    const digest = digestFor({ chainId: TESTNET, writ, id: 1n, action: Action.ResolveQuarantine, payload: resolveQuarantinePayload(to), pqNonce: 0n, deadline });
    const msg = Buffer.from(digest.slice(2), "hex");
    const sig = S.sign(msg, secretKey); // pure FIPS-205 (§3.4)
    if (!S.verify(sig, msg, publicKey)) throw new Error("signature does not verify locally");
    return { digest, sig: toHex(sig) };
  };
  const toSuccessor = signFor(successor);
  const toCancel = signFor("0x0000000000000000000000000000000000000000");
  writeFileSync(
    new URL("pq-resolve.json", OUT),
    JSON.stringify(
      {
        note: "Generated by scripts/gen-fixtures.ts --pq-resolve. Throwaway key; the secret key is not stored. Both signatures are at pqNonce 0 on separate fresh obligations.",
        chainId: s(TESTNET), writ, id: "1", pqKey: toHex(publicKey), deadline: s(deadline), successor,
        successorDigest: toSuccessor.digest, successorSig: toSuccessor.sig,
        cancelDigest: toCancel.digest, cancelSig: toCancel.sig,
      },
      null,
      2,
    ) + "\n",
  );
  console.error("wrote pq-resolve.json");
}
