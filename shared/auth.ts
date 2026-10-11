// EIP-3009 nonces for openWithAuthorization / fundWithAuthorization
// (ARCHITECTURE.md §5.8). They must match Writ.openAuthNonce() and
// Writ.fundAuthNonce() byte for byte; shared/fixtures/digest.json pins both
// sides (test/digest.test.ts and contracts/test/DigestParity.t.sol).
//
// The payer signs a USDC ReceiveWithAuthorization whose `nonce` is one of
// these. Because the nonce commits to the Writ address, the obligation id and
// (for open) every term, the signed authorization can only do what was signed.

import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";

export const OPEN_AUTH_TAG: Hex = keccak256(toHex("WRIT_V1_OPEN_AUTH"));
export const FUND_AUTH_TAG: Hex = keccak256(toHex("WRIT_V1_FUND_AUTH"));

/** Same fields and order as `struct Terms` in Writ.sol. */
export interface Terms {
  beneficiary: Address;
  amountPerPeriod: bigint; // uint128, USDC 6dp
  periodSeconds: bigint; // uint64
  startAt: bigint; // uint64; must not be in the past when open lands
  endTime: bigint; // uint64
  maxExecutorFee: bigint; // uint128
  pqKey: Hex; // bytes32
  ref: Hex; // bytes32
}

/** keccak256(abi.encode(t)). Terms is all static fields, so this is the 8 words in order. */
function termsHash(t: Terms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" }, { type: "uint128" }, { type: "uint64" }, { type: "uint64" },
        { type: "uint64" }, { type: "uint128" }, { type: "bytes32" }, { type: "bytes32" },
      ],
      [t.beneficiary, t.amountPerPeriod, t.periodSeconds, t.startAt, t.endTime, t.maxExecutorFee, t.pqKey, t.ref],
    ),
  );
}

/** Nonce to sign for opening obligation `id` (read `nextId()` first) with terms `t`. */
export function openAuthNonce(writ: Address, id: bigint, t: Terms): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [OPEN_AUTH_TAG, writ, id, termsHash(t)],
    ),
  );
}

/** Nonce to sign for topping up obligation `id`. Use a fresh random `salt` per top-up. */
export function fundAuthNonce(writ: Address, id: bigint, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "bytes32" }],
      [FUND_AUTH_TAG, writ, id, salt],
    ),
  );
}
