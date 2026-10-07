// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Writ, IPQVerify} from "../src/Writ.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// Shared setup: MockUSDC at the real USDC address, a funded payer, and helpers.
/// The PQ precompile is mocked per test with vm.mockCall (§11.1).
abstract contract WritBase is Test {
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    address constant PQ_ADDR   = 0x1800000000000000000000000000000000000004;

    uint128 constant AMOUNT = 1_000e6;     // 1,000 USDC per period
    uint128 constant FEE_CAP = 1e6;        // 1 USDC; well above the floor-price meter
    uint64  constant PERIOD = 30 days;
    bytes32 constant PQ_KEY = keccak256("test pq key");
    bytes32 constant REF    = keccak256("INV-2026-001");

    Writ writ;
    MockUSDC usdc;

    address payer       = makeAddr("payer");
    address beneficiary = makeAddr("beneficiary");
    address executor    = makeAddr("executor");
    address stranger    = makeAddr("stranger");

    function setUp() public virtual {
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);
        writ = new Writ();
        vm.warp(1_800_000_000);
        _fundAndApprove(payer, 1_000_000e6, address(writ));
    }

    function _fundAndApprove(address who, uint256 amount, address spender) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(spender, type(uint256).max);
    }

    /// Twelve monthly payments: startAt, startAt + P, ..., startAt + 11P.
    function _terms() internal view returns (Writ.Terms memory t) {
        t = Writ.Terms({
            beneficiary: beneficiary,
            amountPerPeriod: AMOUNT,
            periodSeconds: PERIOD,
            startAt: uint64(block.timestamp),
            endTime: uint64(block.timestamp) + 11 * PERIOD,
            maxExecutorFee: FEE_CAP,
            pqKey: PQ_KEY,
            ref: REF
        });
    }

    function _open(Writ.Terms memory t, uint128 funding) internal returns (uint256 id) {
        vm.prank(payer);
        id = writ.open(t, funding);
    }

    function _openDefault() internal returns (uint256) {
        return _open(_terms(), 12 * (AMOUNT + FEE_CAP));
    }

    function _mockPq(bool ok) internal {
        vm.mockCall(PQ_ADDR, abi.encodeWithSelector(IPQVerify.verifySlhDsaSha2128s.selector), abi.encode(ok));
    }

    function _sig() internal pure returns (bytes memory) {
        return new bytes(7856);
    }

    // ---- reading the 14-field public getter

    function _balance(uint256 id) internal view returns (uint128 b) {
        (,,, b,,,,,,,,,,) = writ.obligations(id);
    }

    function _nextDueAt(uint256 id) internal view returns (uint64 n) {
        (,,,,,, n,,,,,,,) = writ.obligations(id);
    }

    function _pqNonce(uint256 id) internal view returns (uint64 n) {
        (,,,,,,,, n,,,,,) = writ.obligations(id);
    }

    function _state(uint256 id) internal view returns (Writ.State s) {
        (,,,,,,,,,,, s,,) = writ.obligations(id);
    }

    /// Invariants 1 and 2 (§10).
    function _checkBooks() internal view {
        uint256 sum;
        for (uint256 i = 1; i < writ.nextId(); i++) sum += _balance(i);
        assertEq(writ.totalCommitted(), sum, "inv1: totalCommitted != sum of balances");
        assertGe(usdc.balanceOf(address(writ)), writ.totalCommitted(), "inv2: contract holds less than it owes");
    }
}
