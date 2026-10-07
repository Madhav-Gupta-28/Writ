// shared/digest.ts must reproduce every committed fixture exactly. The Solidity
// side (contracts/test/DigestParity.t.sol) checks Writ.digestFor() against the
// same file, so together they prove TS and Solidity produce identical bytes.
//
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { slh_dsa_sha2_128s as S } from "@noble/post-quantum/slh-dsa.js";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { Action, DOMAIN_TAG, amendPayload, digestFor } from "../shared/digest.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../shared/fixtures/${f}`, import.meta.url), "utf8"));
const digests = load("digest.json");
const pq = load("pq-amend.json");
const bytes = (h: Hex) => Buffer.from(h.slice(2), "hex");

test("DOMAIN_TAG is keccak256('WRIT_V1')", () => {
  assert.equal(DOMAIN_TAG, keccak256(toHex("WRIT_V1")));
});

test("fixture file is complete", () => {
  assert.equal(digests.cases.length, digests.count);
  assert.ok(digests.count >= 6);
});

for (const c of digests.cases) {
  test(`digest fixture: ${c.name}`, () => {
    const got = digestFor({
      chainId: BigInt(c.chainId),
      writ: c.writ as Address,
      id: BigInt(c.id),
      action: c.action as Action,
      payload: c.payload as Hex,
      pqNonce: BigInt(c.pqNonce),
      deadline: BigInt(c.deadline),
    });
    assert.equal(got, c.digest);
  });
}

test("every binding input changes the digest", () => {
  const base = digests.cases[0];
  const input = {
    chainId: BigInt(base.chainId), writ: base.writ as Address, id: BigInt(base.id), action: base.action as Action,
    payload: base.payload as Hex, pqNonce: BigInt(base.pqNonce), deadline: BigInt(base.deadline),
  };
  const d0 = digestFor(input);
  const variants = [
    { ...input, chainId: input.chainId + 1n },
    { ...input, writ: "0x00000000000000000000000000000000000a0009" as Address },
    { ...input, id: input.id + 1n },
    { ...input, action: Action.Cancel },
    { ...input, payload: (input.payload + "00") as Hex },
    { ...input, pqNonce: input.pqNonce + 1n },
    { ...input, deadline: input.deadline + 1n },
  ];
  for (const v of variants) assert.notEqual(digestFor(v), d0);
});

test("pq-amend fixture: digest rebuilds from its own terms", () => {
  const payload = amendPayload({
    newBeneficiary: pq.newBeneficiary, newAmount: BigInt(pq.newAmount), newPeriodSeconds: BigInt(pq.newPeriodSeconds),
    newEndTime: BigInt(pq.newEndTime), newMaxExecutorFee: BigInt(pq.newMaxExecutorFee),
  });
  const d = digestFor({
    chainId: BigInt(pq.chainId), writ: pq.writ, id: BigInt(pq.id), action: Action.Amend,
    payload, pqNonce: 0n, deadline: BigInt(pq.deadline),
  });
  assert.equal(d, pq.digest);
});

test("pq-amend fixture: pure signature verifies with noble, internal does not", () => {
  const msg = bytes(pq.digest), vk = bytes(pq.pqKey);
  assert.equal(vk.length, 32);
  assert.equal(bytes(pq.pureSig).length, 7856);
  assert.equal(S.verify(bytes(pq.pureSig), msg, vk), true);
  assert.equal(S.verify(bytes(pq.internalSig), msg, vk), false);
});
