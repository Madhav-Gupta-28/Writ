// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";

/// openWithAuthorization / fundWithAuthorization (§5.8). MockUSDC checks real
/// EIP-712 signatures and single-use nonces, like FiatTokenV2.
contract WritAuthTest is WritBase {
    address attacker = makeAddr("attacker");
    address relayer  = makeAddr("relayer");
    uint256 funderKey = 0xF00D;
    address funder;

    function setUp() public override {
        super.setUp();
        funder = vm.addr(funderKey);
        usdc.mint(funder, 10_000e6);
    }

    function _openAuth(Writ.Terms memory t, uint128 funding) internal view returns (Writ.Authorization memory) {
        return _signAuth(payerKey, address(writ), funding, writ.openAuthNonce(writ.nextId(), t));
    }

    // ============================================================ openWithAuthorization

    function test_openWithAuthorization_relayedByAnyone_payerIsSigner() public {
        Writ.Terms memory t = _terms();
        uint128 funding = 5 * AMOUNT;
        Writ.Authorization memory a = _openAuth(t, funding);
        uint256 payerBefore = usdc.balanceOf(payer);

        vm.prank(relayer);
        uint256 id = writ.openWithAuthorization(t, payer, funding, a);

        assertEq(id, 1);
        (address p,,,,,,,,,,,,,) = writ.obligations(id);
        assertEq(p, payer, "payer is `from`, not the relayer");
        assertEq(_beneficiary(id), beneficiary);
        assertEq(_balance(id), funding);
        assertEq(usdc.balanceOf(payer), payerBefore - funding);
        assertTrue(usdc.authorizationState(payer, a.nonce));
        _checkBooks();
    }

    function test_openWithAuthorization_signedForAnotherId() public {
        Writ.Terms memory t = _terms();
        Writ.Authorization memory a = _signAuth(payerKey, address(writ), AMOUNT, writ.openAuthNonce(2, t));
        vm.expectRevert(Writ.BadAuthorizationNonce.selector);
        writ.openWithAuthorization(t, payer, ONE_PERIOD, a);
    }

    function test_openWithAuthorization_idRace_revertsAndAuthStaysUnused() public {
        Writ.Terms memory t = _terms();
        Writ.Authorization memory a = _openAuth(t, ONE_PERIOD); // signed for id 1
        _open(_terms(), ONE_PERIOD);                              // someone else takes id 1

        uint256 payerBefore = usdc.balanceOf(payer);
        vm.expectRevert(Writ.BadAuthorizationNonce.selector);
        writ.openWithAuthorization(t, payer, ONE_PERIOD, a);
        assertFalse(usdc.authorizationState(payer, a.nonce), "authorization not consumed");
        assertEq(usdc.balanceOf(payer), payerBefore);
    }

    function test_openWithAuthorization_attackerChangesBeneficiary() public {
        Writ.Terms memory t = _terms();
        Writ.Authorization memory a = _openAuth(t, ONE_PERIOD);

        Writ.Terms memory evil = t;
        evil.beneficiary = attacker;
        vm.prank(attacker);
        vm.expectRevert(Writ.BadAuthorizationNonce.selector);
        writ.openWithAuthorization(evil, payer, ONE_PERIOD, a);
    }

    function test_openWithAuthorization_attackerRecomputesNonce_usdcRejectsSignature() public {
        Writ.Terms memory t = _terms();
        Writ.Authorization memory a = _openAuth(t, ONE_PERIOD);

        Writ.Terms memory evil = t;
        evil.beneficiary = attacker;
        a.nonce = writ.openAuthNonce(1, evil); // passes Writ's check; the payer never signed it
        vm.prank(attacker);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        writ.openWithAuthorization(evil, payer, ONE_PERIOD, a);
    }

    function test_openWithAuthorization_attackerChangesAmount() public {
        Writ.Terms memory t = _terms();
        Writ.Authorization memory a = _openAuth(t, ONE_PERIOD);
        vm.expectRevert(bytes("FiatTokenV2: invalid signature"));
        writ.openWithAuthorization(t, payer, AMOUNT * 2, a);
    }

    function test_openWithAuthorization_replayAfterSuccess() public {
        Writ.Terms memory t = _terms();
        Writ.Authorization memory a = _openAuth(t, ONE_PERIOD);
        writ.openWithAuthorization(t, payer, ONE_PERIOD, a);
        vm.expectRevert(Writ.BadAuthorizationNonce.selector); // nextId moved on
        writ.openWithAuthorization(t, payer, ONE_PERIOD, a);
    }

    function test_openWithAuthorization_stillValidatesTerms() public {
        Writ.Terms memory t = _terms();
        t.pqKey = bytes32(0);
        Writ.Authorization memory a = _openAuth(t, ONE_PERIOD);
        vm.expectRevert(Writ.InvalidPqKey.selector);
        writ.openWithAuthorization(t, payer, ONE_PERIOD, a);
    }

    function test_openAuthNonce_bindsTheContract() public {
        Writ other = new Writ();
        assertTrue(other.openAuthNonce(1, _terms()) != writ.openAuthNonce(1, _terms()));
    }

    // ============================================================ fundWithAuthorization

    function test_fundWithAuthorization_thirdPartyTopUp() public {
        uint256 id = _openDefault();
        uint128 before = _balance(id);
        bytes32 salt = keccak256("top-up 1");
        Writ.Authorization memory a = _signAuth(funderKey, address(writ), 500e6, writ.fundAuthNonce(id, salt));

        vm.expectEmit(address(writ));
        emit Writ.Funded(id, funder, 500e6, before + 500e6);
        vm.prank(relayer);
        writ.fundWithAuthorization(id, funder, 500e6, salt, a);

        assertEq(_balance(id), before + 500e6);
        assertEq(usdc.balanceOf(funder), 10_000e6 - 500e6);
        _checkBooks();
    }

    function test_fundWithAuthorization_resubmittedUnderAnotherId() public {
        uint256 id1 = _openDefault();
        uint256 id2 = _openDefault();
        bytes32 salt = keccak256("s");
        Writ.Authorization memory a = _signAuth(funderKey, address(writ), 500e6, writ.fundAuthNonce(id1, salt));

        vm.prank(attacker);
        vm.expectRevert(Writ.BadAuthorizationNonce.selector);
        writ.fundWithAuthorization(id2, funder, 500e6, salt, a);
        assertFalse(usdc.authorizationState(funder, a.nonce));
    }

    function test_fundWithAuthorization_sameAuthTwice() public {
        uint256 id = _openDefault();
        bytes32 salt = keccak256("s");
        Writ.Authorization memory a = _signAuth(funderKey, address(writ), 500e6, writ.fundAuthNonce(id, salt));
        writ.fundWithAuthorization(id, funder, 500e6, salt, a);
        vm.expectRevert(bytes("FiatTokenV2: authorization is used or canceled"));
        writ.fundWithAuthorization(id, funder, 500e6, salt, a);
    }

    function test_fundWithAuthorization_rejectsClosedObligation() public {
        uint256 id = _openDefault();
        _mockPq(true);
        writ.cancelByPq(id, uint64(block.timestamp + 1), _sig());
        bytes32 salt = keccak256("s");
        Writ.Authorization memory a = _signAuth(funderKey, address(writ), 500e6, writ.fundAuthNonce(id, salt));
        vm.expectRevert(Writ.NotFundable.selector);
        writ.fundWithAuthorization(id, funder, 500e6, salt, a);
    }
}
