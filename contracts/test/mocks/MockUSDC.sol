// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Minimal stand-in for Arc's USDC ERC-20 (6 decimals), placed at
/// 0x3600…0000 with deployCodeTo. Like Arc, a transfer to or from a
/// blocklisted address reverts. Implements EIP-3009 receiveWithAuthorization
/// with real EIP-712 signature checks, modelled on FiatTokenV2 (§3.8). An
/// optional hook re-enters a target during `transfer`, for the reentrancy test.
contract MockUSDC {
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isBlacklisted;

    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    address public hookTarget;
    bytes public hookData;

    /// Arc's USDC always reverts rather than returning false, but Writ still
    /// checks the boolean (§5.4). This makes `transfer` return false without
    /// reverting, so the TransferFailed path is reachable in tests.
    bool public transferReturnsFalse;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setBlacklisted(address who, bool v) external {
        isBlacklisted[who] = v;
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
    }

    function setTransferFails(bool v) external {
        transferReturnsFalse = v;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transferReturnsFalse) return false;
        _move(msg.sender, to, amount);
        if (hookTarget != address(0)) {
            (bool ok, bytes memory ret) = hookTarget.call(hookData);
            if (!ok) assembly { revert(add(ret, 32), mload(ret)) }
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("USDC"), keccak256("2"), block.chainid, address(this)
        ));
    }

    function receiveWithAuthorization(
        address from, address to, uint256 value,
        uint256 validAfter, uint256 validBefore, bytes32 nonce,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(to == msg.sender, "FiatTokenV2: caller must be the payee");
        require(block.timestamp > validAfter, "FiatTokenV2: authorization is not yet valid");
        require(block.timestamp < validBefore, "FiatTokenV2: authorization is expired");
        require(!authorizationState[from][nonce], "FiatTokenV2: authorization is used or canceled");
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", DOMAIN_SEPARATOR(), keccak256(abi.encode(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
        ))));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == from, "FiatTokenV2: invalid signature");
        authorizationState[from][nonce] = true;
        _move(from, to, value);
    }

    function _move(address from, address to, uint256 amount) private {
        require(!isBlacklisted[from] && !isBlacklisted[to], "blacklisted");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
