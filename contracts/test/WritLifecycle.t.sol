// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ, IUSDC} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";

/// Unit tests for quarantine, resolveQuarantine, cancelByPq, rotateKey, the
/// wallet-cancel dance and reclaim. Signatures go through MockPQVerifier, so a
/// signature only passes for the exact key and digest it was made for.
contract WritLifecycleTest is WritBase {
    address successor = makeAddr("successor");

    function setUp() public override {
        super.setUp();
        _useMockVerifier();
    }

    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    function _sign(uint256 id, Writ.Action a, bytes memory payload) internal view returns (bytes memory) {
        return _pqSign(writ, _pqKeyOf(id), id, a, payload, _dl());
    }

    function _quarantine() internal returns (uint256 id) {
        id = _openDefault();
        usdc.setBlacklisted(beneficiary, true);
        writ.execute(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Quarantined));
    }

    function _complete() internal returns (uint256 id) {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + PERIOD; // payments at start and +P
        id = _open(t, 3 * (AMOUNT + FEE_CAP));
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Completed));
    }

    // ============================================================ quarantine in execute

    function test_execute_quarantinesBlacklistedBeneficiary() public {
        uint256 id = _openDefault();
        uint128 before = _balance(id);
        uint64 due = _nextDueAt(id);
        usdc.setBlacklisted(beneficiary, true);

        vm.expectCall(USDC_ADDR, abi.encodeCall(IUSDC.transfer, (beneficiary, AMOUNT)), 0);
        vm.expectEmit(address(writ));
        emit Writ.Quarantined(id, beneficiary, uint64(block.timestamp));
        vm.txGasPrice(20 gwei);
        vm.prank(executor);
        writ.execute(id);

        assertEq(uint8(_state(id)), uint8(Writ.State.Quarantined));
        uint256 fee = usdc.balanceOf(executor);
        assertGt(fee, 0, "executor is paid for the transition");
        assertLe(fee, FEE_CAP);
        assertEq(_balance(id), before - fee, "only the fee left the obligation");
        assertEq(_nextDueAt(id), due, "the period stays due");
        assertEq(usdc.balanceOf(beneficiary), 0);
        _checkBooks();
    }

    function test_quarantine_beatsUnderfunded_noRevert() public {
        uint256 id = _open(_terms(), AMOUNT); // empty after the first payment
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        usdc.setBlacklisted(beneficiary, true);
        writ.execute(id); // must not revert Underfunded
        assertEq(uint8(_state(id)), uint8(Writ.State.Quarantined));
        _checkBooks();
    }

    function test_quarantined_executeReverts_fundStillWorks_amendRejected() public {
        uint256 id = _quarantine();
        vm.expectRevert(Writ.NotActive.selector);
        writ.execute(id);

        vm.prank(payer);
        writ.fund(id, 1e6);

        _mockPq(true);
        vm.expectRevert(Writ.NotActive.selector);
        writ.amend(id, successor, AMOUNT, PERIOD, uint64(block.timestamp) + 52 weeks, FEE_CAP, _dl(), _sig());
        _checkBooks();
    }

    // ============================================================ resolveQuarantine

    function test_resolve_toSuccessor_paysTheDuePeriod() public {
        uint256 id = _quarantine();
        bytes memory sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(successor));

        vm.expectEmit(address(writ));
        emit Writ.QuarantineResolved(id, successor);
        writ.resolveQuarantine(id, successor, _dl(), sig);

        assertEq(uint8(_state(id)), uint8(Writ.State.Active));
        assertEq(_beneficiary(id), successor);
        assertEq(_pqNonce(id), 1);

        writ.execute(id); // the period that triggered quarantine is still due
        assertEq(usdc.balanceOf(successor), AMOUNT);
        _checkBooks();
    }

    function test_resolve_withZeroAddress_cancelsAndRefunds() public {
        uint256 id = _quarantine();
        uint128 bal = _balance(id);
        uint256 payerBefore = usdc.balanceOf(payer);
        bytes memory sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(address(0)));

        vm.expectEmit(address(writ));
        emit Writ.QuarantineResolved(id, address(0));
        vm.expectEmit(address(writ));
        emit Writ.Cancelled(id, bal, true);
        writ.resolveQuarantine(id, address(0), _dl(), sig);

        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        assertEq(usdc.balanceOf(payer), payerBefore + bal);
        assertEq(_balance(id), 0);
        _checkBooks();
    }

    function test_resolve_rejectsActive() public {
        uint256 id = _openDefault();
        bytes memory sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(successor));
        vm.expectRevert(Writ.NotQuarantined.selector);
        writ.resolveQuarantine(id, successor, _dl(), sig);
    }

    function test_resolve_rescreensSuccessor() public {
        uint256 id = _quarantine();
        usdc.setBlacklisted(successor, true);
        bytes memory sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(successor));
        vm.expectRevert(Writ.BeneficiaryBlacklisted.selector);
        writ.resolveQuarantine(id, successor, _dl(), sig);

        sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(address(writ)));
        vm.expectRevert(Writ.InvalidBeneficiary.selector);
        writ.resolveQuarantine(id, address(writ), _dl(), sig);
        assertEq(_pqNonce(id), 0);
    }

    function test_resolve_signatureForOtherSuccessorFails() public {
        uint256 id = _quarantine();
        bytes memory sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(successor));
        vm.expectRevert(Writ.BadSignature.selector);
        writ.resolveQuarantine(id, stranger, _dl(), sig);
    }

    function test_resolve_cancelToBlacklistedPayer_reverts_nothingChanges() public {
        uint256 id = _quarantine();
        uint128 bal = _balance(id);
        usdc.setBlacklisted(payer, true);
        bytes memory sig = _sign(id, Writ.Action.ResolveQuarantine, abi.encode(address(0)));
        vm.expectRevert(Writ.PayerBlacklisted.selector);
        writ.resolveQuarantine(id, address(0), _dl(), sig);
        assertEq(uint8(_state(id)), uint8(Writ.State.Quarantined));
        assertEq(_balance(id), bal);
        assertEq(_pqNonce(id), 0);
    }

    // ============================================================ cancelByPq

    function test_cancelByPq_refundsAndCloses() public {
        uint256 id = _openDefault();
        uint128 bal = _balance(id);
        uint256 payerBefore = usdc.balanceOf(payer);

        vm.expectEmit(address(writ));
        emit Writ.Cancelled(id, bal, true);
        writ.cancelByPq(id, _dl(), _sign(id, Writ.Action.Cancel, ""));

        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        assertEq(usdc.balanceOf(payer), payerBefore + bal);
        _checkBooks();

        vm.warp(block.timestamp + PERIOD);
        vm.expectRevert(Writ.NotActive.selector);
        writ.execute(id);
        vm.prank(payer);
        vm.expectRevert(Writ.NotFundable.selector);
        writ.fund(id, 1e6);
    }

    function test_cancelByPq_worksWhenQuarantined() public {
        uint256 id = _quarantine();
        writ.cancelByPq(id, _dl(), _sign(id, Writ.Action.Cancel, ""));
        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        _checkBooks();
    }

    function test_cancelByPq_rejectsCompletedAndUnopened() public {
        uint256 id = _complete();
        bytes memory sig = _sign(id, Writ.Action.Cancel, "");
        vm.expectRevert(Writ.NotActive.selector);
        writ.cancelByPq(id, _dl(), sig);

        vm.expectRevert(Writ.NotActive.selector);
        writ.cancelByPq(99, _dl(), sig);
    }

    function test_cancelByPq_badSignature() public {
        uint256 id = _openDefault();
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id, _dl(), _sig());
        assertEq(uint8(_state(id)), uint8(Writ.State.Active));
    }

    function test_cancelByPq_blacklistedPayer_reverts() public {
        uint256 id = _openDefault();
        usdc.setBlacklisted(payer, true);
        bytes memory sig = _sign(id, Writ.Action.Cancel, "");
        vm.expectRevert(Writ.PayerBlacklisted.selector);
        writ.cancelByPq(id, _dl(), sig);
        assertEq(uint8(_state(id)), uint8(Writ.State.Active));
        assertEq(_pqNonce(id), 0);
    }

    // ============================================================ rotateKey

    function test_rotateKey_newKeyWorks_oldKeyDoesNot() public {
        uint256 id = _openDefault();
        bytes32 newKey = keccak256("new key");

        vm.expectEmit(address(writ));
        emit Writ.KeyRotated(id, newKey, 0);
        writ.rotateKey(id, newKey, _dl(), _sign(id, Writ.Action.RotateKey, abi.encode(newKey)));
        assertEq(_pqKeyOf(id), newKey);

        // The old key card can no longer cancel...
        bytes memory oldSig = _pqSign(writ, PQ_KEY, id, Writ.Action.Cancel, "", _dl());
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id, _dl(), oldSig);
        // ...the new one can.
        writ.cancelByPq(id, _dl(), _pqSign(writ, newKey, id, Writ.Action.Cancel, "", _dl()));
        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
    }

    function test_rotateKey_mustBeSignedByCurrentKey() public {
        uint256 id = _openDefault();
        bytes32 newKey = keccak256("new key");
        bytes memory sigByNew = _pqSign(writ, newKey, id, Writ.Action.RotateKey, abi.encode(newKey), _dl());
        vm.expectRevert(Writ.BadSignature.selector);
        writ.rotateKey(id, newKey, _dl(), sigByNew);
    }

    function test_rotateKey_rejectsZeroKey() public {
        uint256 id = _openDefault();
        bytes memory sig = _sign(id, Writ.Action.RotateKey, abi.encode(bytes32(0)));
        vm.expectRevert(Writ.InvalidPqKey.selector);
        writ.rotateKey(id, bytes32(0), _dl(), sig);
    }

    function test_rotateKey_worksWhenQuarantined_rejectsCompleted() public {
        uint256 q = _quarantine();
        writ.rotateKey(q, keccak256("k2"), _dl(), _sign(q, Writ.Action.RotateKey, abi.encode(keccak256("k2"))));
        assertEq(_pqKeyOf(q), keccak256("k2"));

        usdc.setBlacklisted(beneficiary, false);
        uint256 c = _complete();
        bytes memory sig = _sign(c, Writ.Action.RotateKey, abi.encode(keccak256("k3")));
        vm.expectRevert(Writ.NotActive.selector);
        writ.rotateKey(c, keccak256("k3"), _dl(), sig);
    }

    // ============================================================ wallet cancel (§5.7)

    function test_beginWalletCancel_onlyPayer() public {
        uint256 id = _openDefault();
        vm.prank(stranger);
        vm.expectRevert(Writ.NotPayer.selector);
        writ.beginWalletCancel(id);

        vm.expectEmit(address(writ));
        emit Writ.WalletCancelBegun(id, uint64(block.timestamp) + 30 days);
        vm.prank(payer);
        writ.beginWalletCancel(id);
        assertEq(_cancelReadyAt(id), block.timestamp + 30 days);
    }

    function test_beginWalletCancel_rejectsClosed() public {
        uint256 id = _complete();
        vm.prank(payer);
        vm.expectRevert(Writ.NotActive.selector);
        writ.beginWalletCancel(id);
    }

    function test_walletCancel_paymentsContinueDuringWindow_thenFinalize() public {
        uint256 id = _openDefault();
        vm.prank(payer);
        writ.beginWalletCancel(id);

        writ.execute(id); // still pays during the window
        assertEq(usdc.balanceOf(beneficiary), AMOUNT);

        vm.warp(block.timestamp + 30 days - 1);
        vm.prank(payer);
        vm.expectRevert(Writ.CancelNotReady.selector);
        writ.finalizeWalletCancel(id);

        vm.warp(block.timestamp + 1);
        uint128 bal = _balance(id);
        uint256 payerBefore = usdc.balanceOf(payer);
        vm.expectEmit(address(writ));
        emit Writ.Cancelled(id, bal, false);
        vm.prank(payer);
        writ.finalizeWalletCancel(id);

        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        assertEq(usdc.balanceOf(payer), payerBefore + bal);
        assertEq(_cancelReadyAt(id), 0);
        _checkBooks();
    }

    function test_finalizeWalletCancel_failureCases() public {
        uint256 id = _openDefault();
        vm.prank(payer);
        vm.expectRevert(Writ.NoCancelPending.selector);
        writ.finalizeWalletCancel(id);

        vm.prank(payer);
        writ.beginWalletCancel(id);
        vm.warp(block.timestamp + 30 days);

        vm.prank(stranger);
        vm.expectRevert(Writ.NotPayer.selector);
        writ.finalizeWalletCancel(id);

        usdc.setBlacklisted(payer, true);
        vm.prank(payer);
        vm.expectRevert(Writ.PayerBlacklisted.selector);
        writ.finalizeWalletCancel(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Active));
    }

    function test_finalizeWalletCancel_rejectsCompleted() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + PERIOD;
        uint256 id = _open(t, 3 * (AMOUNT + FEE_CAP));
        vm.prank(payer);
        writ.beginWalletCancel(id);
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id); // Completed with a cancel still pending
        vm.warp(block.timestamp + 30 days);
        vm.prank(payer);
        vm.expectRevert(Writ.NotActive.selector);
        writ.finalizeWalletCancel(id); // Completed is final; leftovers go through reclaim
    }

    function test_beginWalletCancel_againRestartsTimer() public {
        uint256 id = _openDefault();
        vm.prank(payer);
        writ.beginWalletCancel(id);
        vm.warp(block.timestamp + 10 days);
        vm.prank(payer);
        writ.beginWalletCancel(id);
        assertEq(_cancelReadyAt(id), block.timestamp + 30 days);
    }

    function test_veto_clearsPendingCancel() public {
        uint256 id = _openDefault();
        vm.prank(payer);
        writ.beginWalletCancel(id);

        vm.expectEmit(address(writ));
        emit Writ.WalletCancelVetoed(id, 0);
        writ.vetoWalletCancel(id, _dl(), _sign(id, Writ.Action.VetoWalletCancel, ""));
        assertEq(_cancelReadyAt(id), 0);

        vm.warp(block.timestamp + 30 days);
        vm.prank(payer);
        vm.expectRevert(Writ.NoCancelPending.selector);
        writ.finalizeWalletCancel(id);
    }

    function test_veto_failureCases() public {
        uint256 id = _openDefault();
        bytes memory sig = _sign(id, Writ.Action.VetoWalletCancel, "");
        vm.expectRevert(Writ.NoCancelPending.selector);
        writ.vetoWalletCancel(id, _dl(), sig);

        vm.prank(payer);
        writ.beginWalletCancel(id);
        vm.expectRevert(Writ.BadSignature.selector);
        writ.vetoWalletCancel(id, _dl(), _sig());
        assertEq(_cancelReadyAt(id), block.timestamp + 30 days);
    }

    // ============================================================ reclaim

    function test_reclaim_completed_staysCompleted() public {
        uint256 id = _complete();
        uint64 end = _endTime(id);
        uint128 left = _balance(id);
        assertGt(left, 0);

        vm.warp(uint256(end) + 30 days - 1);
        vm.prank(payer);
        vm.expectRevert(Writ.TooEarly.selector);
        writ.reclaim(id);

        vm.warp(uint256(end) + 30 days);
        vm.prank(stranger);
        vm.expectRevert(Writ.NotPayer.selector);
        writ.reclaim(id);

        uint256 payerBefore = usdc.balanceOf(payer);
        vm.expectEmit(address(writ));
        emit Writ.Reclaimed(id, left);
        vm.prank(payer);
        writ.reclaim(id);

        assertEq(usdc.balanceOf(payer), payerBefore + left);
        assertEq(uint8(_state(id)), uint8(Writ.State.Completed), "Completed is terminal");
        _checkBooks();
    }

    function test_reclaim_liveObligationAfterGrace_becomesCancelled() public {
        uint256 id = _openDefault(); // never executed
        vm.warp(uint256(_endTime(id)) + 30 days);
        vm.prank(payer);
        writ.reclaim(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        assertEq(_balance(id), 0);
        _checkBooks();
    }

    function test_reclaim_rejectsCancelled_andBlacklistedPayer() public {
        uint256 id = _openDefault();
        writ.cancelByPq(id, _dl(), _sign(id, Writ.Action.Cancel, ""));
        vm.warp(uint256(_endTime(id)) + 30 days);
        vm.prank(payer);
        vm.expectRevert(Writ.NotActive.selector);
        writ.reclaim(id);

        uint256 id2 = _complete();
        vm.warp(uint256(_endTime(id2)) + 30 days);
        usdc.setBlacklisted(payer, true);
        vm.prank(payer);
        vm.expectRevert(Writ.PayerBlacklisted.selector);
        writ.reclaim(id2);
    }
}
