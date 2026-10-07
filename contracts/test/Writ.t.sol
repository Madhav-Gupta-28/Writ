// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ, IPQVerify} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";

/// §11.1 unit tests and the §11.2 adversarial cases that apply to the core slice.
/// MockUSDC stands in for USDC; the PQ precompile is mocked.
contract WritTest is WritBase {
    // ============================================================ open

    function test_open_storesTermsAndPullsFunding() public {
        uint128 funding = 5 * AMOUNT;
        Writ.Terms memory t = _terms();

        vm.expectEmit(address(writ));
        emit Writ.Opened(1, payer, beneficiary, AMOUNT, PERIOD, t.endTime, PQ_KEY, REF);
        vm.expectEmit(address(writ));
        emit Writ.Funded(1, payer, funding, funding);
        uint256 id = _open(t, funding);

        assertEq(id, 1);
        assertEq(writ.nextId(), 2);
        (
            address p, address b, uint128 amt, uint128 bal, uint128 cap, uint64 per,
            uint64 due, uint64 end, uint64 nonce, uint64 cancelAt, uint32 paid,
            Writ.State st, bytes32 key, bytes32 ref
        ) = writ.obligations(id);
        assertEq(p, payer);
        assertEq(b, beneficiary);
        assertEq(amt, AMOUNT);
        assertEq(bal, funding);
        assertEq(cap, FEE_CAP);
        assertEq(per, PERIOD);
        assertEq(due, t.startAt);
        assertEq(end, t.endTime);
        assertEq(nonce, 0);
        assertEq(cancelAt, 0);
        assertEq(paid, 0);
        assertEq(uint8(st), uint8(Writ.State.Active));
        assertEq(key, PQ_KEY);
        assertEq(ref, REF);

        assertEq(usdc.balanceOf(address(writ)), funding);
        assertEq(writ.totalCommitted(), funding);
        _checkBooks();
    }

    function test_open_rejectsZeroBeneficiary() public {
        Writ.Terms memory t = _terms();
        t.beneficiary = address(0);
        _expectOpenRevert(t, AMOUNT, Writ.InvalidBeneficiary.selector);
    }

    function test_open_rejectsSelfAsBeneficiary() public {
        Writ.Terms memory t = _terms();
        t.beneficiary = address(writ);
        _expectOpenRevert(t, AMOUNT, Writ.InvalidBeneficiary.selector);
    }

    function test_open_rejectsBlacklistedBeneficiary() public {
        usdc.setBlacklisted(beneficiary, true);
        _expectOpenRevert(_terms(), AMOUNT, Writ.BeneficiaryBlacklisted.selector);
    }

    function test_open_rejectsZeroPqKey() public {
        Writ.Terms memory t = _terms();
        t.pqKey = bytes32(0);
        _expectOpenRevert(t, AMOUNT, Writ.InvalidPqKey.selector);
    }

    function test_open_rejectsZeroAmount() public {
        Writ.Terms memory t = _terms();
        t.amountPerPeriod = 0;
        _expectOpenRevert(t, AMOUNT, Writ.ZeroAmount.selector);
    }

    function test_open_rejectsPeriodBelowMin() public {
        Writ.Terms memory t = _terms();
        t.periodSeconds = 1 hours - 1;
        _expectOpenRevert(t, AMOUNT, Writ.InvalidPeriod.selector);
    }

    function test_open_rejectsPeriodAboveMax() public {
        Writ.Terms memory t = _terms();
        t.periodSeconds = 365 days + 1;
        t.endTime = t.startAt + 2 * t.periodSeconds;
        _expectOpenRevert(t, AMOUNT, Writ.InvalidPeriod.selector);
    }

    function test_open_rejectsStartInPast() public {
        Writ.Terms memory t = _terms();
        t.startAt = uint64(block.timestamp) - 1;
        _expectOpenRevert(t, AMOUNT, Writ.StartInPast.selector);
    }

    function test_open_acceptsStartNow() public {
        Writ.Terms memory t = _terms();
        assertEq(t.startAt, block.timestamp);
        _open(t, AMOUNT);
    }

    function test_open_rejectsEndTimeNotAfterStart() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt;
        _expectOpenRevert(t, AMOUNT, Writ.InvalidEndTime.selector);
    }

    function test_open_rejectsEndTimeShorterThanOnePeriod() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + PERIOD - 1;
        _expectOpenRevert(t, AMOUNT, Writ.InvalidEndTime.selector);
    }

    function test_open_acceptsEndTimeExactlyOnePeriod() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + PERIOD;
        _open(t, AMOUNT);
    }

    function test_open_rejectsZeroExecutorFee() public {
        Writ.Terms memory t = _terms();
        t.maxExecutorFee = 0;
        _expectOpenRevert(t, AMOUNT, Writ.InvalidExecutorFee.selector);
    }

    function test_open_rejectsExecutorFeeNotBelowAmount() public {
        Writ.Terms memory t = _terms();
        t.maxExecutorFee = AMOUNT;
        _expectOpenRevert(t, AMOUNT, Writ.InvalidExecutorFee.selector);
    }

    function test_open_rejectsFundingBelowOnePeriod() public {
        _expectOpenRevert(_terms(), AMOUNT - 1, Writ.InsufficientInitialFunding.selector);
    }

    function _expectOpenRevert(Writ.Terms memory t, uint128 funding, bytes4 err) internal {
        vm.prank(payer);
        vm.expectRevert(err);
        writ.open(t, funding);
    }

    // ============================================================ fund / _credit

    function test_fund_thirdPartyTopUp() public {
        uint256 id = _openDefault();
        uint128 before = _balance(id);
        _fundAndApprove(stranger, 500e6, address(writ));

        vm.expectEmit(address(writ));
        emit Writ.Funded(id, stranger, 500e6, before + 500e6);
        vm.prank(stranger);
        writ.fund(id, 500e6);

        assertEq(_balance(id), before + 500e6);
        _checkBooks();
    }

    function test_fund_rejectsUnopenedId() public {
        vm.prank(payer);
        vm.expectRevert(Writ.NotFundable.selector);
        writ.fund(42, 1e6);
    }

    function test_fund_rejectsCompleted() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + 2 * PERIOD - 1; // exactly two payments: startAt, startAt + P
        uint256 id = _open(t, 2 * (AMOUNT + FEE_CAP));
        vm.startPrank(executor);
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        vm.stopPrank();
        assertEq(uint8(_state(id)), uint8(Writ.State.Completed));

        vm.prank(payer);
        vm.expectRevert(Writ.NotFundable.selector);
        writ.fund(id, 1e6);
    }

    function test_fund_rejectsZero() public {
        uint256 id = _openDefault();
        vm.prank(payer);
        vm.expectRevert(Writ.ZeroAmount.selector);
        writ.fund(id, 0);
    }

    // ============================================================ execute

    function test_execute_paysOnePeriodAndAdvances() public {
        uint256 id = _openDefault();
        uint64 due = _nextDueAt(id);

        vm.expectEmit(address(writ));
        emit Writ.Paid(id, beneficiary, AMOUNT, 1, REF);
        vm.prank(executor);
        writ.execute(id);

        assertEq(usdc.balanceOf(beneficiary), AMOUNT);
        assertEq(_nextDueAt(id), due + PERIOD);
        _checkBooks();
    }

    function test_execute_revertsBeforeDue() public {
        Writ.Terms memory t = _terms();
        t.startAt = uint64(block.timestamp) + 1 days;
        t.endTime = t.startAt + 11 * PERIOD;
        uint256 id = _open(t, 12 * AMOUNT);

        vm.expectRevert(Writ.NotDue.selector);
        writ.execute(id);
        vm.warp(t.startAt);
        writ.execute(id);
    }

    function test_execute_twiceInSamePeriod_secondReverts() public {
        uint256 id = _openDefault();
        writ.execute(id);
        vm.expectRevert(Writ.NotDue.selector);
        writ.execute(id);
    }

    function test_execute_revertsOnUnopened() public {
        vm.expectRevert(Writ.NotActive.selector);
        writ.execute(7);
    }

    function test_execute_catchUpIsOnePeriodPerCall() public {
        uint256 id = _openDefault();
        vm.warp(block.timestamp + 2 * PERIOD); // three periods due
        writ.execute(id);
        writ.execute(id);
        writ.execute(id);
        assertEq(usdc.balanceOf(beneficiary), 3 * AMOUNT);
        vm.expectRevert(Writ.NotDue.selector);
        writ.execute(id);
        _checkBooks();
    }

    function test_execute_underfundedReverts_thenFundResumes() public {
        uint256 id = _open(_terms(), AMOUNT); // one period, no fee headroom
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        vm.expectRevert(Writ.Underfunded.selector);
        writ.execute(id);

        vm.prank(payer);
        writ.fund(id, AMOUNT);
        writ.execute(id);
        assertEq(usdc.balanceOf(beneficiary), 2 * AMOUNT);
        _checkBooks();
    }

    function test_execute_completesAtEndTime() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + 2 * PERIOD; // payments at start, +P, +2P
        uint256 id = _open(t, 3 * (AMOUNT + FEE_CAP));

        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        vm.expectEmit(address(writ));
        emit Writ.Completed(id);
        writ.execute(id);

        assertEq(uint8(_state(id)), uint8(Writ.State.Completed));
        assertEq(usdc.balanceOf(beneficiary), 3 * AMOUNT);
        vm.warp(block.timestamp + PERIOD);
        vm.expectRevert(Writ.NotActive.selector);
        writ.execute(id);
        _checkBooks();
    }

    function test_execute_blacklistedBeneficiaryReverts_untilQuarantineLands() public {
        // Placeholder for the quarantine slice: today a frozen beneficiary makes
        // execute revert. When quarantine lands this must become Quarantined.
        uint256 id = _openDefault();
        usdc.setBlacklisted(beneficiary, true);
        vm.expectRevert(bytes("blacklisted"));
        writ.execute(id);
    }

    // ============================================================ executor fee (§5.5, §6.2)

    function test_executorFee_isMeterPlusTip_atFloorPrice() public {
        uint256 id = _openDefault();
        vm.txGasPrice(20_000_000_010); // Arc's observed floor, §3.2
        vm.prank(executor);
        writ.execute(id);

        uint256 fee = usdc.balanceOf(executor);
        // gasUsed is roughly 30k (overhead) to 250k. At 20 gwei that is 600 to
        // 5,000 units of 6dp USDC on top of the 10,000 tip. Inverting
        // NATIVE_TO_ERC20 would blow straight through FEE_CAP, so this bound is
        // also the mutation test for the 1e12 constant (§11.2).
        assertGt(fee, writ.EXECUTOR_TIP() + 600, "meter missing");
        assertLt(fee, writ.EXECUTOR_TIP() + 5_000, "meter too large: decimal conversion wrong?");
        assertLt(fee, FEE_CAP);
        _checkBooks();
    }

    function test_executorFee_cappedAtCeilingPrice() public {
        uint256 id = _openDefault();
        vm.txGasPrice(20_000 gwei); // Arc's maximum base fee, §3.2
        vm.prank(executor);
        writ.execute(id);
        assertEq(usdc.balanceOf(executor), FEE_CAP);
        _checkBooks();
    }

    function test_executorFee_absurdGasPriceStillCapped() public {
        uint256 id = _openDefault();
        vm.txGasPrice(type(uint64).max);
        vm.prank(executor);
        writ.execute(id);
        assertEq(usdc.balanceOf(executor), FEE_CAP);
        _checkBooks();
    }

    function test_executorFee_neverExceedsRemainingBalance() public {
        uint256 id = _open(_terms(), AMOUNT); // nothing left after the payment
        vm.txGasPrice(20 gwei);
        vm.prank(executor);
        writ.execute(id);
        assertEq(usdc.balanceOf(executor), 0);
        assertEq(_balance(id), 0);
        _checkBooks();
    }

    function testFuzz_executorFee_boundedByCap(uint64 gasPrice, uint128 cap) public {
        cap = uint128(bound(cap, 1, AMOUNT - 1));
        Writ.Terms memory t = _terms();
        t.maxExecutorFee = cap;
        uint256 id = _open(t, 12 * (AMOUNT + cap));
        vm.txGasPrice(gasPrice);
        vm.prank(executor);
        writ.execute(id);
        assertLe(usdc.balanceOf(executor), cap);
        _checkBooks();
    }

    // ============================================================ reentrancy

    function test_reentrantUsdcCannotReenterExecute() public {
        uint256 id = _openDefault();
        vm.warp(block.timestamp + PERIOD); // a second period is due, so re-entry would otherwise pay
        usdc.setHook(address(writ), abi.encodeCall(Writ.execute, (id)));
        vm.expectRevert(Writ.Reentrancy.selector);
        writ.execute(id);
        _checkBooks();
    }

    // ============================================================ amend (§5.6)

    address newBen = makeAddr("newBeneficiary");

    function _amend(uint256 id, uint128 amt, uint64 per, uint64 end, uint128 cap, uint64 deadline, bytes memory sig)
        internal
    {
        writ.amend(id, newBen, amt, per, end, cap, deadline, sig);
    }

    function test_amend_changesTermsKeepsSchedule() public {
        uint256 id = _openDefault();
        writ.execute(id); // first period paid; next due in 30 days
        uint64 due = _nextDueAt(id);
        uint64 newEnd = due + 52 weeks;
        _mockPq(true);

        vm.expectEmit(address(writ));
        emit Writ.Amended(id, newBen, 500e6, 7 days, newEnd, 0);
        _amend(id, 500e6, 7 days, newEnd, 2e6, uint64(block.timestamp + 1 hours), _sig());

        assertEq(_pqNonce(id), 1);
        assertEq(_nextDueAt(id), due, "amend must not move nextDueAt");
        (, address b, uint128 amt, , uint128 cap, uint64 per, , uint64 end,,,,,,) = writ.obligations(id);
        assertEq(b, newBen);
        assertEq(amt, 500e6);
        assertEq(cap, 2e6);
        assertEq(per, 7 days);
        assertEq(end, newEnd);

        // The next payment is on the old date, at the new terms; the new period applies after it.
        vm.warp(due);
        writ.execute(id);
        assertEq(usdc.balanceOf(newBen), 500e6);
        assertEq(_nextDueAt(id), due + 7 days);
        _checkBooks();
    }

    function test_amend_sendsExactBytesToPrecompile() public {
        uint256 id = _openDefault();
        uint64 end = uint64(block.timestamp) + 52 weeks;
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory sig = _sig();
        sig[0] = 0x42;
        bytes32 d = writ.digestFor(
            id, Writ.Action.Amend, abi.encode(newBen, uint128(500e6), uint64(7 days), end, uint128(2e6)), deadline
        );
        _mockPq(true);

        vm.expectCall(
            PQ_ADDR,
            abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (abi.encodePacked(PQ_KEY), abi.encodePacked(d), sig))
        );
        vm.expectEmit(address(writ));
        emit Writ.PQVerified(id, Writ.Action.Amend, d, 0);
        _amend(id, 500e6, 7 days, end, 2e6, deadline, sig);
    }

    function test_amend_consumesNonceSoDigestChanges() public {
        uint256 id = _openDefault();
        uint64 end = uint64(block.timestamp) + 52 weeks;
        uint64 deadline = uint64(block.timestamp + 1 hours);
        bytes memory payload = abi.encode(newBen, uint128(500e6), uint64(7 days), end, uint128(2e6));
        bytes32 before = writ.digestFor(id, Writ.Action.Amend, payload, deadline);
        _mockPq(true);
        _amend(id, 500e6, 7 days, end, 2e6, deadline, _sig());
        // A captured signature over `before` can never verify again.
        assertTrue(writ.digestFor(id, Writ.Action.Amend, payload, deadline) != before);
    }

    function test_amend_badSignatureReverts_nonceUnchanged() public {
        uint256 id = _openDefault();
        _mockPq(false);
        vm.expectRevert(Writ.BadSignature.selector);
        _amend(id, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp + 1), _sig());
        assertEq(_pqNonce(id), 0);
    }

    function test_amend_payerWalletAloneCannotAmend() public {
        uint256 id = _openDefault();
        _mockPq(false); // the payer has no key card signature
        vm.prank(payer);
        vm.expectRevert(Writ.BadSignature.selector);
        _amend(id, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp + 1), _sig());
    }

    function test_amend_badSignatureLength_neverReachesPrecompile() public {
        uint256 id = _openDefault();
        uint256[3] memory lens = [uint256(0), 7855, 7857];
        vm.expectCall(PQ_ADDR, abi.encodeWithSelector(IPQVerify.verifySlhDsaSha2128s.selector), 0);
        for (uint256 i; i < 3; i++) {
            vm.expectRevert(Writ.BadSignatureLength.selector);
            _amend(id, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp + 1),
                   new bytes(lens[i]));
        }
    }

    function test_amend_expiredDeadline() public {
        uint256 id = _openDefault();
        _mockPq(true);
        vm.expectRevert(Writ.Expired.selector);
        _amend(id, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp - 1), _sig());
    }

    function test_amend_rejectsUnopened() public {
        _mockPq(true);
        vm.expectRevert(Writ.NotActive.selector);
        _amend(99, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp + 1), _sig());
    }

    function test_amend_rejectsCompleted() public {
        Writ.Terms memory t = _terms();
        t.endTime = t.startAt + PERIOD; // payments at start and +P
        uint256 id = _open(t, 2 * (AMOUNT + FEE_CAP));
        writ.execute(id);
        vm.warp(block.timestamp + PERIOD);
        writ.execute(id);
        _mockPq(true);
        vm.expectRevert(Writ.NotActive.selector);
        _amend(id, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp + 1), _sig());
    }

    function test_amend_rejectsEndTimeBeforeNextDue() public {
        uint256 id = _openDefault();
        writ.execute(id);
        uint64 due = _nextDueAt(id); // in the future
        _mockPq(true);
        vm.expectRevert(Writ.InvalidEndTime.selector);
        _amend(id, 500e6, 7 days, due - 1, 2e6, uint64(block.timestamp + 1), _sig());
        _amend(id, 500e6, 7 days, due, 2e6, uint64(block.timestamp + 1), _sig()); // boundary is allowed
    }

    function test_amend_rejectsEndTimeInPastWhenOverdue() public {
        uint256 id = _openDefault();
        vm.warp(block.timestamp + 3 * PERIOD); // nextDueAt is now in the past
        _mockPq(true);
        vm.expectRevert(Writ.InvalidEndTime.selector);
        _amend(id, 500e6, 7 days, uint64(block.timestamp - 1), 2e6, uint64(block.timestamp + 1), _sig());
    }

    function test_amend_overduePeriodsPayAtNewTerms() public {
        uint256 id = _openDefault();
        vm.warp(block.timestamp + PERIOD); // two periods due
        _mockPq(true);
        _amend(id, 500e6, 7 days, uint64(block.timestamp) + 52 weeks, 2e6, uint64(block.timestamp + 1), _sig());
        writ.execute(id);
        writ.execute(id);
        assertEq(usdc.balanceOf(newBen), 1_000e6);
        assertEq(usdc.balanceOf(beneficiary), 0);
    }

    function test_amend_revalidatesTerms() public {
        uint256 id = _openDefault();
        _mockPq(true);
        uint64 end = uint64(block.timestamp) + 52 weeks;
        uint64 dl = uint64(block.timestamp + 1);

        usdc.setBlacklisted(newBen, true);
        vm.expectRevert(Writ.BeneficiaryBlacklisted.selector);
        _amend(id, 500e6, 7 days, end, 2e6, dl, _sig());
        usdc.setBlacklisted(newBen, false);

        vm.expectRevert(Writ.InvalidBeneficiary.selector);
        writ.amend(id, address(0), 500e6, 7 days, end, 2e6, dl, _sig());

        vm.expectRevert(Writ.ZeroAmount.selector);
        _amend(id, 0, 7 days, end, 2e6, dl, _sig());

        vm.expectRevert(Writ.InvalidPeriod.selector);
        _amend(id, 500e6, 59 minutes, end, 2e6, dl, _sig());

        vm.expectRevert(Writ.InvalidExecutorFee.selector);
        _amend(id, 500e6, 7 days, end, 500e6, dl, _sig());

        assertEq(_pqNonce(id), 0);
    }
}
