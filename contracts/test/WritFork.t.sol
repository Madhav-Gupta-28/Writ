// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ, IPQVerify} from "../src/Writ.sol";
import {ArcForkBase} from "./ArcForkBase.sol";

/// §11.3 rows 1-2 against Arc testnet. Run with:
///   forge test --fork-url arc_testnet --match-contract ForkTest -vv
/// Skipped unless the fork is Arc testnet. See ArcForkBase for why the
/// precompile is reached through vm.rpc.
contract WritForkTest is ArcForkBase {
    string pq;
    Writ w;

    function setUp() public override {
        if (block.chainid != ARC_TESTNET) return;
        super.setUp();
        pq = vm.readFile(string.concat(vm.projectRoot(), "/../shared/fixtures/pq-amend.json"));
        assertEq(vm.parseJsonUint(pq, ".chainId"), ARC_TESTNET);

        // The fixture digest was signed for this exact Writ address.
        address at = vm.parseJsonAddress(pq, ".writ");
        deployCodeTo("Writ.sol:Writ", at);
        w = Writ(at);
        vm.prank(payer);
        usdc.approve(at, type(uint256).max);

        Writ.Terms memory t = _terms();
        t.pqKey = vm.parseJsonBytes32(pq, ".pqKey");
        vm.prank(payer);
        assertEq(w.open(t, 12 * (AMOUNT + FEE_CAP)), 1);
    }

    /// The real precompile accepts a real noble (pure) signature over a digest
    /// computed by Writ.digestFor, and Writ.amend accepts that verdict.
    function test_realPrecompile_verifiesNobleSignature_andAmendAccepts() public onlyArcTestnetFork {
        (address ben, uint128 amt, uint64 per, uint64 end, uint128 cap, uint64 deadline) = _amendTerms();
        bytes32 d = w.digestFor(1, Writ.Action.Amend, abi.encode(ben, amt, per, end, cap), deadline);
        assertEq(d, vm.parseJsonBytes32(pq, ".digest"), "Writ digest != the digest noble signed");

        bytes memory vk = abi.encodePacked(vm.parseJsonBytes32(pq, ".pqKey"));
        bytes memory sig = vm.parseJsonBytes(pq, ".pureSig");
        bytes memory call_ = abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (vk, abi.encodePacked(d), sig));

        bool real = _realVerify(call_);
        assertTrue(real, "Arc testnet precompile rejected a pure noble signature");

        vm.mockCall(PQ_ADDR, call_, abi.encode(real));
        w.amend(1, ben, amt, per, end, cap, deadline, sig);

        (, address b, uint128 a,,,,,, uint64 nonce,,,,,) = w.obligations(1);
        assertEq(b, ben);
        assertEq(a, amt);
        assertEq(nonce, 1);
    }

    /// §3.4: the "internal" variant is rejected by Arc, so Writ reverts BadSignature.
    function test_realPrecompile_rejectsInternalVariant() public onlyArcTestnetFork {
        (address ben, uint128 amt, uint64 per, uint64 end, uint128 cap, uint64 deadline) = _amendTerms();
        bytes32 d = vm.parseJsonBytes32(pq, ".digest");
        bytes memory vk = abi.encodePacked(vm.parseJsonBytes32(pq, ".pqKey"));
        bytes memory sig = vm.parseJsonBytes(pq, ".internalSig");
        bytes memory call_ = abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (vk, abi.encodePacked(d), sig));

        bool real = _realVerify(call_);
        assertFalse(real, "Arc accepted an .internal signature: ARCHITECTURE.md 3.4 no longer holds");

        vm.mockCall(PQ_ADDR, call_, abi.encode(real));
        vm.expectRevert(Writ.BadSignature.selector);
        w.amend(1, ben, amt, per, end, cap, deadline, sig);
    }

    /// A one-bit change to the digest makes the real precompile return false.
    function test_realPrecompile_rejectsFlippedDigest() public onlyArcTestnetFork {
        bytes32 d = vm.parseJsonBytes32(pq, ".digest") ^ bytes32(uint256(1));
        bytes memory vk = abi.encodePacked(vm.parseJsonBytes32(pq, ".pqKey"));
        bytes memory sig = vm.parseJsonBytes(pq, ".pureSig");
        assertFalse(_realVerify(abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (vk, abi.encodePacked(d), sig))));
    }

    /// §3.4 / §11.3 row 2: wrong lengths make the precompile revert rather than
    /// return false. This is why Writ checks sig.length itself.
    function test_realPrecompile_revertsOnWrongLengths() public onlyArcTestnetFork {
        bytes memory d = abi.encodePacked(vm.parseJsonBytes32(pq, ".digest"));
        bytes memory vk = abi.encodePacked(vm.parseJsonBytes32(pq, ".pqKey"));
        bytes memory sig = vm.parseJsonBytes(pq, ".pureSig");

        bytes memory shortVk = new bytes(31);
        bytes memory shortSig = new bytes(7855);
        assertFalse(_realCallSucceeds(abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (shortVk, d, sig))), "31-byte vk");
        assertFalse(_realCallSucceeds(abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (vk, d, shortSig))), "7855-byte sig");
    }

    // ---- helpers

    function _amendTerms()
        internal view returns (address, uint128, uint64, uint64, uint128, uint64)
    {
        return (
            vm.parseJsonAddress(pq, ".newBeneficiary"),
            uint128(vm.parseJsonUint(pq, ".newAmount")),
            uint64(vm.parseJsonUint(pq, ".newPeriodSeconds")),
            uint64(vm.parseJsonUint(pq, ".newEndTime")),
            uint128(vm.parseJsonUint(pq, ".newMaxExecutorFee")),
            uint64(vm.parseJsonUint(pq, ".deadline"))
        );
    }
}
