// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ, IUSDC, IPQVerify} from "../src/Writ.sol";
import {ArcForkBase} from "./ArcForkBase.sol";

/// §11.3 row 8 — the quarantine demo. Nobody outside Circle can blocklist an
/// address, so this fakes exactly one thing: isBlacklisted(beneficiary) = true.
/// Everything else is the real contract on an Arc testnet fork, and
/// resolveQuarantine is authorized by a real SLH-DSA signature that the real
/// Arc precompile verifies (via vm.rpc, see ArcForkBase).
///
///   forge test --fork-url arc_testnet --match-contract WritQuarantineForkTest -vvvv
contract WritQuarantineForkTest is ArcForkBase {
    string fx;
    Writ w;
    address successor;
    uint64 deadline;

    function setUp() public override {
        if (block.chainid != ARC_TESTNET) return;
        super.setUp();
        fx = vm.readFile(string.concat(vm.projectRoot(), "/../shared/fixtures/pq-resolve.json"));
        assertEq(vm.parseJsonUint(fx, ".chainId"), ARC_TESTNET);
        successor = vm.parseJsonAddress(fx, ".successor");
        deadline = uint64(vm.parseJsonUint(fx, ".deadline"));

        // The fixture signatures were made for this exact Writ address and id 1.
        address at = vm.parseJsonAddress(fx, ".writ");
        deployCodeTo("Writ.sol:Writ", at);
        w = Writ(at);
        vm.prank(payer);
        usdc.approve(at, type(uint256).max);

        Writ.Terms memory t = _terms();
        t.pqKey = vm.parseJsonBytes32(fx, ".pqKey");
        vm.prank(payer);
        assertEq(w.open(t, 12 * (AMOUNT + FEE_CAP)), 1);
    }

    function _state() internal view returns (Writ.State s) {
        (,,,,,,,,,,, s,,) = w.obligations(1);
    }

    /// Fake the freeze, execute, and check: Quarantined, executor paid, and no
    /// transfer to the frozen beneficiary was even attempted.
    function _quarantine() internal {
        vm.mockCall(USDC_ADDR, abi.encodeCall(IUSDC.isBlacklisted, (beneficiary)), abi.encode(true));
        vm.expectCall(USDC_ADDR, abi.encodeCall(IUSDC.transfer, (beneficiary, AMOUNT)), 0);
        vm.expectEmit(address(w));
        emit Writ.Quarantined(1, beneficiary, uint64(block.timestamp));

        vm.txGasPrice(20 gwei);
        vm.prank(executor);
        w.execute(1);

        assertEq(uint8(_state()), uint8(Writ.State.Quarantined), "not quarantined");
        assertGt(usdc.balanceOf(executor), 0, "executor paid for the transition");
        assertEq(usdc.balanceOf(beneficiary), 0, "nothing sent to the frozen beneficiary");
    }

    function _resolveCall(address to, bytes memory sig) internal view returns (bytes memory) {
        bytes32 d = w.digestFor(1, Writ.Action.ResolveQuarantine, abi.encode(to), deadline);
        bytes memory vk = abi.encodePacked(vm.parseJsonBytes32(fx, ".pqKey"));
        return abi.encodeCall(IPQVerify.verifySlhDsaSha2128s, (vk, abi.encodePacked(d), sig));
    }

    function test_quarantine_thenResolveToSuccessor() public onlyArcTestnetFork {
        _quarantine();

        bytes32 d = w.digestFor(1, Writ.Action.ResolveQuarantine, abi.encode(successor), deadline);
        assertEq(d, vm.parseJsonBytes32(fx, ".successorDigest"), "Writ digest != the digest noble signed");
        bytes memory sig = vm.parseJsonBytes(fx, ".successorSig");
        assertTrue(_replayRealVerdict(_resolveCall(successor, sig)), "Arc precompile rejected the key card");

        vm.expectEmit(address(w));
        emit Writ.QuarantineResolved(1, successor);
        w.resolveQuarantine(1, successor, deadline, sig);
        assertEq(uint8(_state()), uint8(Writ.State.Active));

        // The period that triggered quarantine is still due: the successor gets it now.
        vm.expectEmit(address(w));
        emit Writ.Paid(1, successor, AMOUNT, 1, REF);
        w.execute(1);
        assertEq(usdc.balanceOf(successor), AMOUNT);
        _checkBooksOf(w);
    }

    function test_quarantine_thenResolveByCancelling() public onlyArcTestnetFork {
        _quarantine();
        (,,, uint128 bal,,,,,,,,,,) = w.obligations(1);
        uint256 payerBefore = usdc.balanceOf(payer);

        bytes memory sig = vm.parseJsonBytes(fx, ".cancelSig");
        assertTrue(_replayRealVerdict(_resolveCall(address(0), sig)));

        vm.expectEmit(address(w));
        emit Writ.Cancelled(1, bal, true);
        w.resolveQuarantine(1, address(0), deadline, sig);

        assertEq(uint8(_state()), uint8(Writ.State.Cancelled));
        assertEq(usdc.balanceOf(payer), payerBefore + bal, "payer refunded");
        _checkBooksOf(w);
    }

    /// The successor's signature cannot be redirected to an attacker: the real
    /// precompile says no, and Writ reverts BadSignature.
    function test_quarantine_signatureCannotBeRedirected() public onlyArcTestnetFork {
        _quarantine();
        address attacker = makeAddr("attacker");
        bytes memory sig = vm.parseJsonBytes(fx, ".successorSig");
        assertFalse(_replayRealVerdict(_resolveCall(attacker, sig)));

        vm.expectRevert(Writ.BadSignature.selector);
        w.resolveQuarantine(1, attacker, deadline, sig);
        assertEq(uint8(_state()), uint8(Writ.State.Quarantined));
    }

    function _checkBooksOf(Writ x) internal view {
        uint256 sum;
        for (uint256 i = 1; i < x.nextId(); i++) {
            (,,, uint128 b,,,,,,,,,,) = x.obligations(i);
            sum += b;
        }
        assertEq(x.totalCommitted(), sum);
        assertGe(usdc.balanceOf(address(x)), x.totalCommitted());
    }
}
