// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Stand-in for Arc's PQ precompile, placed at 0x1800…0004 with deployCodeTo.
/// A "signature" is keccak256(vk, message) in the first 32 bytes, zero-padded
/// to 7,856 bytes. That keeps the property the adversarial tests need: a
/// signature verifies only for the exact key and digest it was made for. Like
/// the real precompile (§3.4) it reverts on wrong key or signature lengths.
contract MockPQVerifier {
    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata sig)
        external pure returns (bool)
    {
        require(vk.length == 32, "Invalid verifying key length");
        require(sig.length == 7856, "Invalid signature length");
        return bytes32(sig[:32]) == keccak256(abi.encode(vk, message));
    }

    /// Test helper: the signature `vk` would produce over `digest`.
    function sign(bytes32 vk, bytes32 digest) external pure returns (bytes memory sig) {
        sig = new bytes(7856);
        bytes32 tag = keccak256(abi.encode(abi.encodePacked(vk), abi.encodePacked(digest)));
        assembly { mstore(add(sig, 32), tag) }
    }
}
