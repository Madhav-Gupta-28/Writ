// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ, IPQVerify} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";

/// §11.2: signatures must not be replayable across time, chains, contracts,
/// obligations, actions or payloads. MockPQVerifier makes a signature valid
/// only for the exact (key, digest) it was made for, so every case below is a
/// real binding check, not a mocked "false".
contract WritAdversarialTest is WritBase {
    address newBen = makeAddr("newBen");

    function setUp() public override {
        super.setUp();
        _useMockVerifier();
    }

    function _dl() internal view returns (uint64) {
        return uint64(block.timestamp + 1 hours);
    }

    function _amendPayload(address b) internal view returns (bytes memory) {
        return abi.encode(b, AMOUNT, PERIOD, uint64(block.timestamp) + 52 weeks, FEE_CAP);
    }

    function _amend(Writ w, uint256 id, address b, uint64 dl, bytes memory sig) internal {
        w.amend(id, b, AMOUNT, PERIOD, uint64(block.timestamp) + 52 weeks, FEE_CAP, dl, sig);
    }

    function test_replay_sameSignatureTwice() public {
        uint256 id = _openDefault();
        bytes memory sig = _pqSign(writ, PQ_KEY, id, Writ.Action.Amend, _amendPayload(newBen), _dl());
        _amend(writ, id, newBen, _dl(), sig);
        vm.expectRevert(Writ.BadSignature.selector);
        _amend(writ, id, newBen, _dl(), sig);
    }

    function test_replay_staleSignatureAfterAnotherActionUsedTheNonce() public {
        uint256 id = _openDefault();
        // Two signatures made at nonce 0. Once one lands, the other is dead.
        bytes memory sigA = _pqSign(writ, PQ_KEY, id, Writ.Action.Amend, _amendPayload(newBen), _dl());
        bytes memory sigB = _pqSign(writ, PQ_KEY, id, Writ.Action.Cancel, "", _dl());
        _amend(writ, id, newBen, _dl(), sigA);
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id, _dl(), sigB);
    }

    function test_crossChain_testnetSignatureOnMainnet() public {
        uint256 id = _openDefault();
        vm.chainId(5042002);
        bytes memory sig = _pqSign(writ, PQ_KEY, id, Writ.Action.Cancel, "", _dl());
        vm.chainId(5042);
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id, _dl(), sig);

        vm.chainId(5042002); // control: valid where it was signed
        writ.cancelByPq(id, _dl(), sig);
    }

    function test_crossContract_signatureForAnotherDeployment() public {
        Writ other = new Writ();
        vm.prank(payer);
        usdc.approve(address(other), type(uint256).max);
        vm.prank(payer);
        uint256 id = other.open(_terms(), ONE_PERIOD); // same id, same key, other contract
        uint256 mine = _openDefault();
        assertEq(id, mine);

        bytes memory sig = _pqSign(writ, PQ_KEY, mine, Writ.Action.Cancel, "", _dl());
        vm.expectRevert(Writ.BadSignature.selector);
        other.cancelByPq(id, _dl(), sig);
    }

    function test_crossObligation_sameKeyDifferentId() public {
        uint256 id1 = _openDefault();
        uint256 id2 = _openDefault(); // same key card on both
        bytes memory sig = _pqSign(writ, PQ_KEY, id1, Writ.Action.Cancel, "", _dl());
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id2, _dl(), sig);
    }

    function test_crossAction_cancelSignatureUsedAsVeto() public {
        uint256 id = _openDefault();
        vm.prank(payer);
        writ.beginWalletCancel(id);
        bytes memory sig = _pqSign(writ, PQ_KEY, id, Writ.Action.Cancel, "", _dl()); // same empty payload
        vm.expectRevert(Writ.BadSignature.selector);
        writ.vetoWalletCancel(id, _dl(), sig);
    }

    function test_crossPayload_amendToOneAddressUsedForAnother() public {
        uint256 id = _openDefault();
        bytes memory sig = _pqSign(writ, PQ_KEY, id, Writ.Action.Amend, _amendPayload(newBen), _dl());
        vm.expectRevert(Writ.BadSignature.selector);
        _amend(writ, id, makeAddr("attacker"), _dl(), sig);
    }

    function test_deadlineIsBound() public {
        uint256 id = _openDefault();
        uint64 dl = _dl();
        bytes memory sig = _pqSign(writ, PQ_KEY, id, Writ.Action.Cancel, "", dl);
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id, dl + 1, sig); // extending the deadline invalidates it
    }

    function test_expiredDeadline() public {
        uint256 id = _openDefault();
        uint64 dl = _dl();
        bytes memory sig = _pqSign(writ, PQ_KEY, id, Writ.Action.Cancel, "", dl);
        vm.warp(uint256(dl) + 1);
        vm.expectRevert(Writ.Expired.selector);
        writ.cancelByPq(id, dl, sig);
    }

    function test_wrongKey() public {
        uint256 id = _openDefault();
        bytes memory sig = _pqSign(writ, keccak256("someone else's card"), id, Writ.Action.Cancel, "", _dl());
        vm.expectRevert(Writ.BadSignature.selector);
        writ.cancelByPq(id, _dl(), sig);
    }

    /// Every PQ entry point rejects every wrong length with a typed error and
    /// never reaches the precompile (whose own revert would be opaque, §3.4).
    function test_wrongSignatureLengths_everyEntryPoint() public {
        uint256 id = _openDefault();
        uint256 q = _openDefault();
        vm.prank(payer);
        writ.beginWalletCancel(id);
        usdc.setBlacklisted(beneficiary, true);
        writ.execute(q); // q is Quarantined
        usdc.setBlacklisted(beneficiary, false);

        uint256[5] memory lens = [uint256(0), 1, 7855, 7857, 15712];
        vm.expectCall(PQ_ADDR, abi.encodeWithSelector(IPQVerify.verifySlhDsaSha2128s.selector), 0);
        for (uint256 i; i < lens.length; i++) {
            bytes memory s = new bytes(lens[i]);
            vm.expectRevert(Writ.BadSignatureLength.selector);
            _amend(writ, id, newBen, _dl(), s);
            vm.expectRevert(Writ.BadSignatureLength.selector);
            writ.cancelByPq(id, _dl(), s);
            vm.expectRevert(Writ.BadSignatureLength.selector);
            writ.rotateKey(id, keccak256("k"), _dl(), s);
            vm.expectRevert(Writ.BadSignatureLength.selector);
            writ.vetoWalletCancel(id, _dl(), s);
            vm.expectRevert(Writ.BadSignatureLength.selector);
            writ.resolveQuarantine(q, newBen, _dl(), s);
        }
    }

    /// The payer's ECDSA wallet has no path to change the beneficiary: the only
    /// functions that do require a PQ signature, and a wallet has none.
    function test_payerWallet_cannotRedirect() public {
        uint256 id = _openDefault();
        vm.startPrank(payer);
        vm.expectRevert(Writ.BadSignature.selector);
        _amend(writ, id, payer, _dl(), _sig());
        vm.stopPrank();
        assertEq(_beneficiary(id), beneficiary);
    }
}
