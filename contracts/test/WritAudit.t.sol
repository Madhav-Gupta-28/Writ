// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";

/// Ground-up audit probes, written to try to break the contract rather than to
/// confirm it works. Each test states the question it is asking. Where the
/// answer is "the contract is sound", the test is kept as a regression lock.
contract WritAuditTest is WritBase {
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

    // =====================================================================
    // Q1. Can the payer claw back payments that were already DUE and FUNDED
    //     but that nobody executed?
    //
    // This is the sharpest question in the contract. `execute` is permissionless
    // and Arc has no searchers, so an order can sit with several periods due and
    // fully funded. `reclaim` opens endTime + 30 days and sends the WHOLE
    // balance to the payer.
    // =====================================================================

    function test_Q1_reclaimClawsBackDueButUnexecutedPayments() public {
        // Twelve periods funded, but endTime allows only three payments.
        Writ.Terms memory t = _terms();
        t.endTime = uint64(block.timestamp) + 2 * PERIOD; // periods at T, T+P, T+2P
        uint256 id = _open(t, 12 * ONE_PERIOD);

        // One period is executed. Two more come due and are fully funded.
        writ.execute(id);
        vm.warp(block.timestamp + 3 * PERIOD);

        uint128 owedToBeneficiary = 2 * AMOUNT; // the two due, funded, unexecuted periods
        assertEq(usdc.balanceOf(beneficiary), AMOUNT, "only the first period was paid");
        assertGe(_balance(id), owedToBeneficiary, "the money for both is still in the order");
        assertEq(uint8(_state(id)), uint8(Writ.State.Active), "still Active: nextDueAt never passed endTime");

        // Wait out the reclaim grace and take everything back.
        vm.warp(uint256(_endTime(id)) + 30 days);
        uint256 payerBefore = usdc.balanceOf(payer);
        uint128 pot = _balance(id);
        vm.prank(payer);
        writ.reclaim(id);

        assertEq(usdc.balanceOf(payer), payerBefore + pot, "payer took the whole pot");
        assertEq(usdc.balanceOf(beneficiary), AMOUNT, "beneficiary never got the two due periods");
        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        _checkBooks();

        // CONFIRMED: reclaim does not settle due-and-funded periods first, so a
        // payer (or a thief holding only the payer's key) recovers money the
        // beneficiary had already earned. Needs no key card and no 30-day notice
        // beyond the reclaim grace.
    }

    /// The same window also lets the payer bypass the 30-day wallet-cancel
    /// notice entirely, once endTime + grace has passed.
    function test_Q1b_reclaimIsASecondCancelPathForThePayer() public {
        Writ.Terms memory t = _terms();
        t.endTime = uint64(block.timestamp) + 2 * PERIOD;
        uint256 id = _open(t, 12 * ONE_PERIOD);

        vm.warp(uint256(t.endTime) + 30 days);
        // No beginWalletCancel, no 30-day notice, no key card.
        vm.prank(payer);
        writ.reclaim(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Cancelled));
        assertEq(_cancelReadyAt(id), 0);
    }

    // =====================================================================
    // Q2. Can an executor profit by inflating the gas price?
    //     _payExecutor meters gasUsed * tx.gasprice. If the reimbursement grew
    //     faster than the cost, anyone could drain an order through fees.
    // =====================================================================

    function test_Q2_executorCannotProfitFromGasPrice() public {
        uint256 id = _openDefault();

        // Floor price.
        vm.txGasPrice(20 gwei);
        uint256 nativeBefore = executor.balance;
        vm.prank(executor);
        writ.execute(id);
        uint256 feeLow = usdc.balanceOf(executor);
        nativeBefore; // gas is not charged to balances under forge; compare fees only

        // Ceiling price, next period.
        vm.warp(block.timestamp + PERIOD);
        vm.txGasPrice(20_000 gwei);
        vm.prank(executor2);
        writ.execute(id);
        uint256 feeHigh = usdc.balanceOf(executor2);

        // The cap binds, so a 1000x gas price cannot extract more than the cap.
        assertLe(feeLow, FEE_CAP);
        assertLe(feeHigh, FEE_CAP);
        _checkBooks();

        // Reasoning the test cannot assert directly (forge does not debit gas):
        // uncapped, fee_18dec = gasUsed*G + TIP*1e12, while the executor pays
        // gasUsed*G, so the net is exactly the tip at ANY gas price. Once the cap
        // binds, raising G only shrinks the net. The design is sound.
    }

    // =====================================================================
    // Q3. Can anyone drain an order by calling execute repeatedly?
    // =====================================================================

    function test_Q3_executeIsOncePerPeriod() public {
        uint256 id = _openDefault();
        writ.execute(id);
        vm.expectRevert(Writ.NotDue.selector);
        writ.execute(id);
        // And the quarantine fee path cannot be milked either: it moves the
        // state to Quarantined, and execute then reverts NotActive.
        usdc.setBlacklisted(beneficiary, true);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Quarantined));
        vm.expectRevert(Writ.NotActive.selector);
        writ.execute(id);
        _checkBooks();
    }

    // =====================================================================
    // Q4. amend enforces fee < amount, but does it enforce that the order can
    //     still pay? _open requires funding >= amount + fee; amend does not.
    // =====================================================================

    function test_Q4_amendCanRaiseAmountAboveTheBalanceAndStallTheOrder() public {
        uint256 id = _open(_terms(), ONE_PERIOD); // exactly one period funded

        // Raise the payment far above what the order holds. Permitted.
        uint128 huge = 1_000_000e6;
        writ.amend(
            id, beneficiary, huge, PERIOD, uint64(block.timestamp) + 10 * PERIOD, huge / 2, _dl(),
            _sign(id, Writ.Action.Amend, abi.encode(beneficiary, huge, PERIOD, uint64(block.timestamp) + 10 * PERIOD, huge / 2))
        );

        // The order is now permanently stalled until someone funds ~1.5m USDC.
        vm.expectRevert(Writ.Underfunded.selector);
        writ.execute(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Active), "stuck Active, paying nobody");
        _checkBooks();

        // Only the key card can do this, and only to its own order, so it is an
        // asymmetry with _open rather than a vulnerability. Worth closing.
    }

    // =====================================================================
    // Q5. reclaim has no idempotence guard. Does calling it twice corrupt the
    //     books or double-pay?
    // =====================================================================

    function test_Q5_reclaimTwiceIsHarmlessButEmitsAMisleadingEvent() public {
        Writ.Terms memory t = _terms();
        t.endTime = uint64(block.timestamp) + 2 * PERIOD;
        uint256 id = _open(t, 3 * ONE_PERIOD);

        // Run it to Completed so the state survives reclaim.
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Completed));

        vm.warp(uint256(t.endTime) + 30 days);
        uint256 before = usdc.balanceOf(payer);
        vm.prank(payer);
        writ.reclaim(id);
        uint256 afterFirst = usdc.balanceOf(payer);
        assertGt(afterFirst, before);

        // Second call: state is still Completed, so it passes every check.
        vm.prank(payer);
        writ.reclaim(id); // emits Reclaimed(id, 0)
        assertEq(usdc.balanceOf(payer), afterFirst, "no double payment");
        assertEq(_balance(id), 0);
        _checkBooks();
    }

    // =====================================================================
    // Q6. A blacklisted payer cannot be refunded. Is there always an escape
    //     route for the money, or can it be locked permanently?
    // =====================================================================

    function test_Q6_completedOrderWithBlacklistedPayerIsPermanentlyLocked() public {
        Writ.Terms memory t = _terms();
        t.endTime = uint64(block.timestamp) + PERIOD;
        uint256 id = _open(t, 6 * ONE_PERIOD);

        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        assertEq(uint8(_state(id)), uint8(Writ.State.Completed));
        assertGt(_balance(id), 0, "funded beyond the schedule");

        usdc.setBlacklisted(payer, true);
        vm.warp(uint256(t.endTime) + 30 days);

        // reclaim is the only route out of Completed, and it reverts.
        vm.prank(payer);
        vm.expectRevert(Writ.PayerBlacklisted.selector);
        writ.reclaim(id);

        // amend / cancelByPq need Active or Quarantined, so the key card cannot
        // redirect the remainder either. The signature is built first:
        // expectRevert arms the next external call, and _sign reads digestFor.
        uint64 dl = _dl();
        bytes memory cancelSig = _sign(id, Writ.Action.Cancel, "");
        vm.expectRevert(Writ.NotActive.selector);
        writ.cancelByPq(id, dl, cancelSig);

        // CONFIRMED: a Completed order whose payer is later blacklisted strands
        // its remaining balance with no path out. An Active order has an escape
        // (amend the beneficiary and let it pay down); Completed has none.
    }

    // =====================================================================
    // Q7. Is the USDC contract itself a legal beneficiary?
    // =====================================================================

    function test_Q7_usdcContractIsAcceptedAsBeneficiary() public {
        Writ.Terms memory t = _terms();
        t.beneficiary = USDC_ADDR;
        uint256 id = _open(t, ONE_PERIOD);
        writ.execute(id);
        assertEq(usdc.balanceOf(USDC_ADDR), AMOUNT, "payments vanish into the token contract");
        _checkBooks();
        // Only address(0) and address(this) are rejected. Paying the token
        // itself succeeds and the money is unrecoverable. Cosmetic: the payer
        // chose it, and the key card can amend away. Worth a UI guard.
    }

    // =====================================================================
    // Q8. Does the fee meter include the transaction's intrinsic gas?
    // =====================================================================

    function test_Q8_feeMeterUndercountsByIntrinsicGas() public {
        uint256 id = _openDefault();
        vm.txGasPrice(20 gwei);
        vm.prank(executor);
        writ.execute(id);
        uint256 fee = usdc.balanceOf(executor);

        // The meter starts inside execute(), so the 21,000 intrinsic cost and
        // the calldata cost are never reimbursed. REIMBURSE_OVERHEAD is 30,000,
        // which covers the tail of the call but not the intrinsic head.
        // At the 20 gwei floor that gap is ~21,000 * 2e-8 = $0.00042, against a
        // $0.01 tip, so the executor is still well in profit.
        assertGt(fee, 0);
        assertLe(fee, FEE_CAP);
        _checkBooks();
    }

    // =====================================================================
    // Q9. Can a stranger grief the books through the authorization paths?
    //     _credit runs BEFORE the funds are pulled in both fund paths.
    // =====================================================================

    function test_Q9_creditBeforeTransferCannotLeaveTheBooksShort() public {
        uint256 id = _openDefault();
        uint256 committedBefore = writ.totalCommitted();

        // transferFrom with no allowance must revert the whole call, leaving
        // totalCommitted untouched.
        vm.prank(stranger);
        vm.expectRevert();
        writ.fund(id, AMOUNT);
        assertEq(writ.totalCommitted(), committedBefore, "books unchanged after a failed pull");

        // And a transferFrom that returns false (rather than reverting) must
        // also roll the credit back, through Writ's own TransferFailed.
        usdc.setTransferFromFails(true);
        vm.prank(payer);
        vm.expectRevert(Writ.TransferFailed.selector);
        writ.fund(id, AMOUNT);
        assertEq(writ.totalCommitted(), committedBefore, "books unchanged after a false return");

        // Same for the other pull site, open().
        Writ.Terms memory t = _terms();
        vm.prank(payer);
        vm.expectRevert(Writ.TransferFailed.selector);
        writ.open(t, ONE_PERIOD);
        assertEq(writ.totalCommitted(), committedBefore, "a failed open commits nothing");

        usdc.setTransferFromFails(false);
        _checkBooks();
    }

    // =====================================================================
    // Q10. nextDueAt advances by periodSeconds. Over a long neglected gap, can
    //      it overflow uint64 or skip periods?
    // =====================================================================

    function test_Q10_catchUpPaysEveryPeriodWithoutSkipping() public {
        Writ.Terms memory t = _terms();
        t.periodSeconds = 1 hours;
        t.endTime = uint64(block.timestamp) + 10 hours;
        uint256 id = _open(t, 12 * ONE_PERIOD);

        // Neglect the order for five hours. Period 1 was due at startAt, so
        // six periods are now payable: T, T+1h, ... T+5h.
        vm.warp(block.timestamp + 5 hours);
        for (uint256 i = 0; i < 6; i++) writ.execute(id);
        assertEq(usdc.balanceOf(beneficiary), 6 * AMOUNT, "every due period paid, none skipped");

        // The seventh is not yet due: catch-up never runs ahead of the clock.
        vm.expectRevert(Writ.NotDue.selector);
        writ.execute(id);
        _checkBooks();
    }
}
