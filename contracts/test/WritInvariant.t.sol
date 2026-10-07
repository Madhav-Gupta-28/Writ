// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Writ} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Drives random sequences of every state-changing entry point. The PQ
/// precompile is mocked to accept, so PQ actions happen as often as wallet
/// ones; signature checking itself is covered by WritAdversarial.t.sol.
contract WritHandler is Test {
    Writ immutable writ;
    MockUSDC immutable usdc;
    address[3] payers;
    address[4] bens;

    // ghost state for the per-obligation invariants
    mapping(uint256 => uint64) public lastNonce;
    mapping(uint256 => uint64) public lastDue;
    uint256 public maxFeeSeen;      // largest executor fee paid / its cap, scaled 1e18
    bool public nonceWentBackwards;
    bool public dueWentBackwards;
    bool public returnedToNone;
    bool public leftCompleted;
    mapping(uint256 => bool) public wasCompleted;

    mapping(bytes4 => uint256) public calls;
    mapping(bytes4 => uint256) public ok;   // calls that did not revert

    constructor(Writ w, MockUSDC u) {
        writ = w;
        usdc = u;
        for (uint256 i; i < 3; i++) {
            payers[i] = makeAddr(string.concat("payer", vm.toString(i)));
            usdc.mint(payers[i], 1e15);
            vm.prank(payers[i]);
            usdc.approve(address(w), type(uint256).max);
        }
        for (uint256 i; i < 4; i++) bens[i] = makeAddr(string.concat("ben", vm.toString(i)));
    }

    modifier track(bytes4 sel) {
        calls[sel]++;
        _;
        _snapshot();
    }

    function _id(uint256 seed) internal view returns (uint256) {
        uint256 n = writ.nextId();
        return n == 1 ? 1 : 1 + seed % (n - 1);
    }

    function _payer(uint256 id) internal view returns (address p) {
        (p,,,,,,,,,,,,,) = writ.obligations(id);
    }

    function _endTime(uint256 id) internal view returns (uint64 e) {
        (,,,,,,, e,,,,,,) = writ.obligations(id);
    }

    function open(uint256 who, uint256 ben, uint128 amount, uint64 period, uint8 periods, uint128 fee, uint128 funding)
        external track(this.open.selector)
    {
        amount = uint128(bound(amount, 1e6, 1e12));
        period = uint64(bound(period, 1 hours, 365 days));
        periods = uint8(bound(periods, 1, 24));
        fee = uint128(bound(fee, 1, amount - 1));
        funding = uint128(bound(funding, amount, uint256(amount) * 30));
        uint64 start = uint64(block.timestamp);
        Writ.Terms memory t = Writ.Terms(bens[ben % 4], amount, period, start,
            start + uint64(periods) * period, fee, keccak256(abi.encode(who)), bytes32(0));
        vm.prank(payers[who % 3]);
        try writ.open(t, funding) { ok[msg.sig]++; } catch {}
    }

    function fund(uint256 seed, uint256 who, uint128 amount) external track(this.fund.selector) {
        amount = uint128(bound(amount, 1, 1e13));
        uint256 id = _id(seed); // before the prank: _id makes an external call that would consume it
        vm.prank(payers[who % 3]);
        try writ.fund(id, amount) { ok[msg.sig]++; } catch {}
    }

    function execute(uint256 seed, uint64 gasPrice) external track(this.execute.selector) {
        vm.txGasPrice(bound(gasPrice, 0, 20_000 gwei));
        uint256 id = _id(seed);
        (,,,, uint128 cap,,,,,,,,,) = writ.obligations(id);
        uint256 before = usdc.balanceOf(address(this));
        try writ.execute(id) { ok[msg.sig]++; } catch {}
        uint256 fee = usdc.balanceOf(address(this)) - before;
        if (cap > 0 && fee * 1e18 / cap > maxFeeSeen) maxFeeSeen = fee * 1e18 / cap;
    }

    function amend(uint256 seed, uint256 ben, uint128 amount, uint64 period, uint64 extend)
        external track(this.amend.selector)
    {
        uint256 id = _id(seed);
        amount = uint128(bound(amount, 2, 1e12));
        period = uint64(bound(period, 1 hours, 365 days));
        uint64 end = uint64(block.timestamp) + uint64(bound(extend, 1 hours, 3 * 365 days));
        try writ.amend(id, bens[ben % 4], amount, period, end, amount / 2 + 1 < amount ? amount / 2 : 1,
                       uint64(block.timestamp), new bytes(7856)) { ok[msg.sig]++; } catch {}
    }

    function cancelByPq(uint256 seed) external track(this.cancelByPq.selector) {
        try writ.cancelByPq(_id(seed), uint64(block.timestamp), new bytes(7856)) { ok[msg.sig]++; } catch {}
    }

    function rotateKey(uint256 seed, bytes32 k) external track(this.rotateKey.selector) {
        try writ.rotateKey(_id(seed), k, uint64(block.timestamp), new bytes(7856)) { ok[msg.sig]++; } catch {}
    }

    function resolveQuarantine(uint256 seed, uint256 ben, bool cancel) external track(this.resolveQuarantine.selector) {
        try writ.resolveQuarantine(_id(seed), cancel ? address(0) : bens[ben % 4], uint64(block.timestamp),
                                   new bytes(7856)) { ok[msg.sig]++; } catch {}
    }

    function beginWalletCancel(uint256 seed) external track(this.beginWalletCancel.selector) {
        uint256 id = _id(seed);
        vm.prank(_payer(id));
        try writ.beginWalletCancel(id) { ok[msg.sig]++; } catch {}
    }

    function vetoWalletCancel(uint256 seed) external track(this.vetoWalletCancel.selector) {
        try writ.vetoWalletCancel(_id(seed), uint64(block.timestamp), new bytes(7856)) { ok[msg.sig]++; } catch {}
    }

    function finalizeWalletCancel(uint256 seed) external track(this.finalizeWalletCancel.selector) {
        uint256 id = _id(seed);
        vm.prank(_payer(id));
        try writ.finalizeWalletCancel(id) { ok[msg.sig]++; } catch {}
    }

    function reclaim(uint256 seed) external track(this.reclaim.selector) {
        uint256 id = _id(seed);
        vm.prank(_payer(id));
        try writ.reclaim(id) { ok[msg.sig]++; } catch {}
    }

    function setBlacklisted(uint256 who, bool v) external track(this.setBlacklisted.selector) {
        // beneficiaries and payers both get frozen and unfrozen
        address a = who % 2 == 0 ? bens[(who / 2) % 4] : payers[(who / 2) % 3];
        usdc.setBlacklisted(a, v);
    }

    function warp(uint32 dt) external track(this.warp.selector) {
        vm.warp(block.timestamp + bound(dt, 1, 120 days));
    }

    function _snapshot() internal {
        for (uint256 id = 1; id < writ.nextId(); id++) {
            (,,,,,, uint64 due,, uint64 nonce,,, Writ.State st,,) = writ.obligations(id);
            if (nonce < lastNonce[id]) nonceWentBackwards = true;
            if (due < lastDue[id]) dueWentBackwards = true;
            if (st == Writ.State.None) returnedToNone = true;
            if (wasCompleted[id] && st != Writ.State.Completed) leftCompleted = true;
            if (st == Writ.State.Completed) wasCompleted[id] = true;
            lastNonce[id] = nonce;
            lastDue[id] = due;
        }
    }
}

/// §10 invariants under random sequences of every entry point.
contract WritInvariantTest is WritBase {
    WritHandler handler;

    function setUp() public override {
        super.setUp();
        _mockPq(true);
        handler = new WritHandler(writ, usdc);
        // Every run starts with three live obligations, so a run whose random
        // blacklisting blocks every later open still exercises real state.
        handler.open(0, 0, 5e6, 2 hours, 6, 1e6, 40e6);
        handler.open(1, 1, 7e6, 1 days, 12, 2e6, 100e6);
        handler.open(2, 2, 3e6, 30 days, 3, 1e5, 9e6);
        targetContract(address(handler));
    }

    /// Invariant 1: totalCommitted == Σ balances.
    function invariant_totalCommittedEqualsSumOfBalances() public view {
        uint256 sum;
        for (uint256 i = 1; i < writ.nextId(); i++) sum += _balance(i);
        assertEq(writ.totalCommitted(), sum);
    }

    /// Invariant 2: the contract never holds less than it owes. Nothing else
    /// sends USDC to Writ here, so it holds exactly what it owes.
    function invariant_contractHoldsWhatItOwes() public view {
        assertEq(usdc.balanceOf(address(writ)), writ.totalCommitted());
    }

    /// Invariants 4 and 5: pqNonce and nextDueAt never decrease.
    function invariant_monotonicNonceAndSchedule() public view {
        assertFalse(handler.nonceWentBackwards(), "pqNonce decreased");
        assertFalse(handler.dueWentBackwards(), "nextDueAt decreased");
    }

    /// Invariant 8: executor fee never exceeds maxExecutorFee.
    function invariant_executorFeeWithinCap() public view {
        assertLe(handler.maxFeeSeen(), 1e18);
    }

    /// Invariant 9: no path back to None, and Completed is terminal.
    function invariant_stateTransitions() public view {
        assertFalse(handler.returnedToNone(), "an obligation returned to None");
        assertFalse(handler.leftCompleted(), "an obligation left Completed");
    }

    /// Coverage: with INVARIANT_REPORT=true, appends how many calls of each kind
    /// succeeded in every run to cache/invariant-coverage.log.
    function afterInvariant() external {
        assertGt(writ.nextId(), 3);
        if (!vm.envOr("INVARIANT_REPORT", false)) return;
        bytes4[12] memory sels = [handler.open.selector, handler.fund.selector, handler.execute.selector,
            handler.amend.selector, handler.cancelByPq.selector, handler.rotateKey.selector,
            handler.resolveQuarantine.selector, handler.beginWalletCancel.selector,
            handler.vetoWalletCancel.selector, handler.finalizeWalletCancel.selector,
            handler.reclaim.selector, handler.setBlacklisted.selector];
        string memory line;
        for (uint256 i; i < 12; i++) line = string.concat(line, vm.toString(handler.ok(sels[i])), " ");
        vm.writeLine("cache/invariant-coverage.log", line);
    }
}
