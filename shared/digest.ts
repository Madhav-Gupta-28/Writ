// The PQ digest, built exactly like Writ.digestFor() (ARCHITECTURE.md §5.6).
//
//   keccak256(abi.encode(keccak256("WRIT_V1"), chainid, address(this), id,
//                        uint8(action), keccak256(payload), pqNonce, deadline))
//
// This must match the contract byte for byte. shared/fixtures/digest.json pins
// both sides: test/digest.test.ts checks this file against it, and
// contracts/test/DigestParity.t.sol checks digestFor() against it.

import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";

export const DOMAIN_TAG: Hex = keccak256(toHex("WRIT_V1"));

/** Same order as `enum Action` in Writ.sol; the digest encodes it as uint8.
 *  A const object, not a TS enum, so Node can run this file without a build step. */
export const Action = {
  Amend: 0,
  Cancel: 1,
  RotateKey: 2,
  ResolveQuarantine: 3,
  VetoWalletCancel: 4,
} as const;
export type Action = (typeof Action)[keyof typeof Action];

export interface DigestInput {
  chainId: bigint;
  writ: Address;
  id: bigint;
  action: Action;
  payload: Hex;
  pqNonce: bigint; // read obligations(id).pqNonce from the chain right before signing
  deadline: bigint; // uint64 unix seconds
}

export function digestFor(d: DigestInput): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "uint64" },
      ],
      [DOMAIN_TAG, d.chainId, d.writ, d.id, d.action, keccak256(d.payload), d.pqNonce, d.deadline],
    ),
  );
}

export interface AmendTerms {
  newBeneficiary: Address;
  newAmount: bigint; // uint128, USDC 6dp
  newPeriodSeconds: bigint; // uint64
  newEndTime: bigint; // uint64
  newMaxExecutorFee: bigint; // uint128, USDC 6dp
}

/** `amend`'s payload: abi.encode(newBeneficiary, newAmount, newPeriodSeconds, newEndTime, newMaxExecutorFee). */
export function amendPayload(a: AmendTerms): Hex {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint128" }, { type: "uint64" }, { type: "uint64" }, { type: "uint128" }],
    [a.newBeneficiary, a.newAmount, a.newPeriodSeconds, a.newEndTime, a.newMaxExecutorFee],
  );
}
