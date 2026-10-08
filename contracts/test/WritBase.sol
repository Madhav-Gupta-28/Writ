// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Writ, IPQVerify} from "../src/Writ.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockPQVerifier} from "./mocks/MockPQVerifier.sol";

/// Shared setup: MockUSDC at the real USDC address, a funded payer, and helpers.
/// The PQ precompile is mocked per test: either vm.mockCall (any signature
/// passes or fails), or MockPQVerifier via _useMockVerifier() (a signature
/// passes only for the exact key and digest it was made for). Not deployed by
/// default, so fork tests keep the real placeholder at 0x1800…0004.
abstract contract WritBase is Test {
    address constant USDC_ADDR = 0x3600000000000000000000000000000000000000;
    address constant PQ_ADDR   = 0x1800000000000000000000000000000000000004;

    uint128 constant AMOUNT = 1_000e6;     // 1,000 USDC per period
    uint128 constant FEE_CAP = 1e6;        // 1 USDC; well above the floor-price meter
    /// The smallest funding that makes one period payable: the payment plus its
    /// reserved executor fee. Writ enforces this at open and at execute (§6.3).
    uint128 constant ONE_PERIOD = AMOUNT + FEE_CAP;
    uint64  constant PERIOD = 30 days;
    bytes32 constant PQ_KEY = keccak256("test pq key");
    bytes32 constant REF    = keccak256("INV-2026-001");

    Writ writ;
    MockUSDC usdc;

    address payer       = makeAddr("payer");
    uint256 payerKey    = uint256(keccak256(abi.encodePacked("payer"))); // forge-std makeAddr derivation
    address beneficiary = makeAddr("beneficiary");
    address executor    = makeAddr("executor");
    address executor2   = makeAddr("executor2");
    address stranger    = makeAddr("stranger");

    function setUp() public virtual {
        deployCodeTo("MockUSDC.sol:MockUSDC", USDC_ADDR);
        usdc = MockUSDC(USDC_ADDR);
        // On a fork, deployCodeTo replaces the code at 0x3600…0000 but keeps the
        // real USDC's storage, which overlaps MockUSDC's hook slots (the token
        // name ends up as hookData). Clear them so transfer doesn't call junk.
        usdc.setHook(address(0), "");
        // Same hazard, one slot further on: the real USDC holds 6 (its decimals)
        // where MockUSDC keeps transferReturnsFalse, so on a fork every transfer
        // would return false until this is cleared.
        usdc.setTransferFails(false);
        usdc.setTransferFromFails(false);
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

    MockPQVerifier pqv;

    function _useMockVerifier() internal {
        deployCodeTo("MockPQVerifier.sol:MockPQVerifier", PQ_ADDR);
        pqv = MockPQVerifier(PQ_ADDR);
    }

    /// A MockPQVerifier signature by `key` over w.digestFor(...) as of now.
    function _pqSign(Writ w, bytes32 key, uint256 id, Writ.Action a, bytes memory payload, uint64 deadline)
        internal view returns (bytes memory)
    {
        return pqv.sign(key, w.digestFor(id, a, payload, deadline));
    }

    /// An EIP-3009 ReceiveWithAuthorization signed with `pk`, against MockUSDC's domain.
    function _signAuth(uint256 pk, address to, uint256 value, bytes32 nonce)
        internal view returns (Writ.Authorization memory a)
    {
        address from = vm.addr(pk);
        a.validAfter = block.timestamp - 1;
        a.validBefore = block.timestamp + 1 hours;
        a.nonce = nonce;
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", usdc.DOMAIN_SEPARATOR(), keccak256(abi.encode(
            usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), from, to, value, a.validAfter, a.validBefore, nonce
        ))));
        (a.v, a.r, a.s) = vm.sign(pk, digest);
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

    function _beneficiary(uint256 id) internal view returns (address b) {
        (, b,,,,,,,,,,,,) = writ.obligations(id);
    }

    function _cancelReadyAt(uint256 id) internal view returns (uint64 c) {
        (,,,,,,,,, c,,,,) = writ.obligations(id);
    }

    function _pqKeyOf(uint256 id) internal view returns (bytes32 k) {
        (,,,,,,,,,,,, k,) = writ.obligations(id);
    }

    function _endTime(uint256 id) internal view returns (uint64 e) {
        (,,,,,,, e,,,,,,) = writ.obligations(id);
    }

    /// Invariants 1 and 2 (§10).
    function _checkBooks() internal view {
        uint256 sum;
        for (uint256 i = 1; i < writ.nextId(); i++) sum += _balance(i);
        assertEq(writ.totalCommitted(), sum, "inv1: totalCommitted != sum of balances");
        assertGe(usdc.balanceOf(address(writ)), writ.totalCommitted(), "inv2: contract holds less than it owes");
    }
}
