// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WritBase} from "./WritBase.sol";

/// Helpers for tests that run on an Arc testnet fork:
///   forge test --fork-url arc_testnet --match-contract ForkTest
///
/// Arc's precompiles are native node code. On a forge fork, 0x1800…0004 holds
/// a placeholder byte (0x01 on testnet) that the local EVM would execute as
/// bytecode, so calling it inside the fork cannot work (§11.3). Instead a
/// verification goes to the real testnet node as an eth_call, and the verdict
/// is replayed into the fork with an exact-calldata vm.mockCall. If Writ sent
/// any other bytes, no mock would match, the call would hit the placeholder and
/// revert — so a passing PQ action proves Writ sent exactly the bytes the real
/// precompile judged.
///
/// USDC is MockUSDC here too (WritBase). Measured against an anvil fork of Arc
/// mainnet on 2026-10-08, the real USDC splits in two: plain storage reads work,
/// but anything that goes through a Native Coin precompile reverts with empty
/// data.
///
///   decimals()        fork: 6          mainnet: 6
///   balanceOf(a)      fork: works      mainnet: works
///   totalSupply()     fork: REVERTS    mainnet: 525,120,173.350594
///   transfer(...)     fork: REVERTS    mainnet: true
///   isBlacklisted(a)  fork: REVERTS    mainnet: false
///
/// So a fork cannot run Writ against the real token at all: execute()'s first
/// USDC call is isBlacklisted, which already reverts. MockUSDC is not a
/// convenience here, it is the only way these tests can exist.
abstract contract ArcForkBase is WritBase {
    uint256 constant ARC_TESTNET = 5042002;

    modifier onlyArcTestnetFork() {
        if (block.chainid != ARC_TESTNET) vm.skip(true);
        _;
    }

    function _ethCallParams(bytes memory data) internal pure returns (string memory) {
        return string.concat(
            '[{"to":"0x1800000000000000000000000000000000000004","data":"', vm.toString(data), '"},"latest"]'
        );
    }

    /// eth_call against the real Arc testnet node.
    function _realVerify(bytes memory data) internal returns (bool) {
        return abi.decode(vm.rpc("eth_call", _ethCallParams(data)), (bool));
    }

    function _realCallSucceeds(bytes memory data) internal returns (bool) {
        try vm.rpc("eth_call", _ethCallParams(data)) returns (bytes memory) {
            return true;
        } catch {
            return false;
        }
    }

    /// Ask the real precompile, then make the fork answer the same for exactly these bytes.
    function _replayRealVerdict(bytes memory data) internal returns (bool real) {
        real = _realVerify(data);
        vm.mockCall(PQ_ADDR, data, abi.encode(real));
    }
}
