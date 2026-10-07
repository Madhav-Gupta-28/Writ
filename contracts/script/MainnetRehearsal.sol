// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ, IUSDC} from "../src/Writ.sol";

interface IApprove {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// §11.5 free mainnet rehearsal. Never deployed: scripts/rehearse.ts injects
/// this runtime code and Writ's runtime code into a single eth_call with state
/// overrides, against live chain state, real USDC and the real PQ precompile.
/// Nothing persists and nothing is spent.
///
/// Writ's constructor does not run under injection, so the caller must also
/// override Writ's storage slot 1 (nextId) to 1. This contract must be given a
/// native balance (USDC on Arc), which it uses as the obligation's payer.
contract MainnetRehearsal {
    IUSDC constant USDC = IUSDC(0x3600000000000000000000000000000000000000);

    struct Input {
        Writ writ;
        uint64 startAt;      // must equal block.timestamp of the call (read it with ts() first)
        bytes32 pqKey;
        address ben1;
        address ben2;
        uint64 deadline;
        bytes amendSig;      // real SLH-DSA over digestFor(1, Amend, payload(ben2), deadline) at nonce 0
        bytes cancelSig;     // real SLH-DSA over digestFor(1, Cancel, "", deadline) at nonce 1
        address authFrom;    // an EOA with real USDC
        Writ.Terms authTerms;
        uint128 authFunding;
        Writ.Authorization auth; // real EIP-3009 by authFrom, nonce = openAuthNonce(2, authTerms)
    }

    struct Result {
        uint256 startBalance;        // this contract's USDC, 6dp (from the native override)
        uint256 id1;
        uint256 ben1Paid;
        uint256 executorFee;
        address beneficiaryAfterAmend;
        uint64 nonceAfterAmend;
        bytes4 badSigError;
        bytes4 shortSigError;
        uint256 refunded;
        uint8 stateAfterCancel;
        uint256 id2;
        address id2Payer;
        uint256 id2Balance;
        uint256 totalCommitted;
        uint256 writUsdcBalance;
    }

    uint128 constant AMOUNT = 10_000;   // 0.01 USDC
    uint128 constant FEE_CAP = 5_000;
    uint128 constant FUNDING = 100_000; // 0.10 USDC

    function run(Input calldata i) external returns (Result memory r) {
        Writ w = i.writ;
        r.startBalance = USDC.balanceOf(address(this));

        // 1. open with transferFrom, this contract as payer
        require(IApprove(address(USDC)).approve(address(w), FUNDING), "approve");
        Writ.Terms memory t = Writ.Terms({
            beneficiary: i.ben1, amountPerPeriod: AMOUNT, periodSeconds: 1 hours,
            startAt: i.startAt, endTime: i.startAt + 2 hours,
            maxExecutorFee: FEE_CAP, pqKey: i.pqKey, ref: keccak256("REHEARSAL")
        });
        r.id1 = w.open(t, FUNDING);

        // 2. execute: real USDC transfer to ben1, executor (this) reimbursed
        uint256 before = USDC.balanceOf(address(this));
        w.execute(r.id1);
        r.ben1Paid = USDC.balanceOf(i.ben1);
        r.executorFee = USDC.balanceOf(address(this)) - before;

        // 3. amend with a real SLH-DSA signature through the real precompile
        w.amend(r.id1, i.ben2, AMOUNT, 1 hours, t.endTime, FEE_CAP, i.deadline, i.amendSig);
        (, r.beneficiaryAfterAmend,,,,,,, r.nonceAfterAmend,,,,,) = w.obligations(r.id1);

        // 4. a wrong signature and a short signature fail with typed errors
        r.badSigError = _err(address(w), abi.encodeCall(Writ.cancelByPq, (r.id1, i.deadline, new bytes(7856))));
        r.shortSigError = _err(address(w), abi.encodeCall(Writ.cancelByPq, (r.id1, i.deadline, new bytes(7855))));

        // 5. cancel with a real signature: refund to this contract
        before = USDC.balanceOf(address(this));
        w.cancelByPq(r.id1, i.deadline, i.cancelSig);
        r.refunded = USDC.balanceOf(address(this)) - before;
        Writ.State st;
        (,,,,,,,,,,, st,,) = w.obligations(r.id1);
        r.stateAfterCancel = uint8(st);

        // 6. openWithAuthorization with a real EIP-3009 signature, real USDC
        r.id2 = w.openWithAuthorization(i.authTerms, i.authFrom, i.authFunding, i.auth);
        (r.id2Payer,,, r.id2Balance,,,,,,,,,,) = w.obligations(r.id2);

        r.totalCommitted = w.totalCommitted();
        r.writUsdcBalance = USDC.balanceOf(address(w));
    }

    /// The block.timestamp the node uses for an eth_call at a given block.
    function ts() external view returns (uint256) {
        return block.timestamp;
    }

    function _err(address target, bytes memory data) internal returns (bytes4 sel) {
        (bool ok, bytes memory ret) = target.call(data);
        if (ok || ret.length < 4) return bytes4(0);
        sel = bytes4(ret);
    }
}
