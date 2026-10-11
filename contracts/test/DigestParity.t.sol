// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Writ} from "../src/Writ.sol";
import {WritBase} from "./WritBase.sol";

/// Writ.digestFor() must equal shared/digest.ts byte for byte (ARCHITECTURE.md §5.6).
/// Both sides check the same committed vectors in shared/fixtures/digest.json:
/// test/digest.test.ts for the TypeScript, this file for the contract.
contract DigestParityTest is WritBase {
    string json;

    function setUp() public override {
        super.setUp();
        json = vm.readFile(string.concat(vm.projectRoot(), "/../shared/fixtures/digest.json"));
    }

    function test_digestFor_matchesTypeScriptFixtures() public {
        uint256 n = vm.parseJsonUint(json, ".count");
        assertGe(n, 6, "fixture file too small");
        for (uint256 i; i < n; i++) _checkCase(i);
    }

    function _checkCase(uint256 i) internal {
        string memory k = string.concat(".cases[", vm.toString(i), "]");
        string memory name = vm.parseJsonString(json, string.concat(k, ".name"));
        uint256 chainId    = vm.parseJsonUint(json, string.concat(k, ".chainId"));
        address at         = vm.parseJsonAddress(json, string.concat(k, ".writ"));
        uint256 id         = vm.parseJsonUint(json, string.concat(k, ".id"));
        uint8 action       = uint8(vm.parseJsonUint(json, string.concat(k, ".action")));
        bytes memory payload = vm.parseJsonBytes(json, string.concat(k, ".payload"));
        uint256 nonce      = vm.parseJsonUint(json, string.concat(k, ".pqNonce"));
        uint64 deadline    = uint64(vm.parseJsonUint(json, string.concat(k, ".deadline")));
        bytes32 expected   = vm.parseJsonBytes32(json, string.concat(k, ".digest"));

        // chainid and address(this) are both inside the digest, so reproduce them.
        vm.chainId(chainId);
        deployCodeTo("Writ.sol:Writ", at);
        Writ w = Writ(at);

        if (nonce > 0) _advanceNonce(w, id, nonce);
        assertEq(_nonceOf(w, id), nonce, name);

        assertEq(w.digestFor(id, Writ.Action(action), payload, deadline), expected, name);
    }

    /// Writ.openAuthNonce / fundAuthNonce must equal shared/auth.ts (§5.8).
    function test_authNonces_matchTypeScriptFixtures() public {
        uint256 n = vm.parseJsonUint(json, ".openAuthCount");
        assertGe(n, 4);
        for (uint256 i; i < n; i++) {
            string memory k = string.concat(".openAuth[", vm.toString(i), "]");
            Writ w = _writAt(vm.parseJsonAddress(json, string.concat(k, ".writ")));
            Writ.Terms memory t = _termsAt(string.concat(k, ".terms"));
            assertEq(
                w.openAuthNonce(vm.parseJsonUint(json, string.concat(k, ".id")), t),
                vm.parseJsonBytes32(json, string.concat(k, ".nonce")),
                vm.parseJsonString(json, string.concat(k, ".name"))
            );
        }
        n = vm.parseJsonUint(json, ".fundAuthCount");
        assertGe(n, 3);
        for (uint256 i; i < n; i++) {
            string memory k = string.concat(".fundAuth[", vm.toString(i), "]");
            Writ w = _writAt(vm.parseJsonAddress(json, string.concat(k, ".writ")));
            assertEq(
                w.fundAuthNonce(vm.parseJsonUint(json, string.concat(k, ".id")),
                                vm.parseJsonBytes32(json, string.concat(k, ".salt"))),
                vm.parseJsonBytes32(json, string.concat(k, ".nonce")),
                vm.parseJsonString(json, string.concat(k, ".name"))
            );
        }
    }

    function _writAt(address at) internal returns (Writ) {
        if (at.code.length == 0) deployCodeTo("Writ.sol:Writ", at);
        return Writ(at);
    }

    function _termsAt(string memory k) internal view returns (Writ.Terms memory t) {
        t.beneficiary     = vm.parseJsonAddress(json, string.concat(k, ".beneficiary"));
        t.amountPerPeriod = uint128(vm.parseJsonUint(json, string.concat(k, ".amountPerPeriod")));
        t.periodSeconds   = uint64(vm.parseJsonUint(json, string.concat(k, ".periodSeconds")));
        t.startAt         = uint64(vm.parseJsonUint(json, string.concat(k, ".startAt")));
        t.endTime         = uint64(vm.parseJsonUint(json, string.concat(k, ".endTime")));
        t.maxExecutorFee  = uint128(vm.parseJsonUint(json, string.concat(k, ".maxExecutorFee")));
        t.pqKey           = vm.parseJsonBytes32(json, string.concat(k, ".pqKey"));
        t.ref             = vm.parseJsonBytes32(json, string.concat(k, ".ref"));
    }

    /// Reach pqNonce = n the only way the contract allows: n successful amends.
    function _advanceNonce(Writ w, uint256 id, uint256 n) internal {
        require(id == 1, "nonce > 0 fixtures must use id 1");
        vm.prank(payer);
        usdc.approve(address(w), type(uint256).max);
        vm.prank(payer);
        w.open(_terms(), ONE_PERIOD);
        _mockPq(true);
        for (uint256 j; j < n; j++) {
            w.amend(id, beneficiary, AMOUNT, PERIOD, uint64(block.timestamp) + 11 * PERIOD, FEE_CAP,
                    type(uint64).max, _sig());
        }
    }

    function _nonceOf(Writ w, uint256 id) internal view returns (uint64 n) {
        (,,,,,,,, n,,,,,) = w.obligations(id);
    }
}
