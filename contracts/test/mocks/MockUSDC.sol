// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Minimal stand-in for Arc's USDC ERC-20 (6 decimals), placed at
/// 0x3600…0000 with deployCodeTo. Like Arc, a transfer to or from a
/// blocklisted address reverts. An optional hook re-enters a target during
/// `transfer`, for the reentrancy test.
contract MockUSDC {
    uint8 public constant decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public isBlacklisted;

    address public hookTarget;
    bytes public hookData;

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

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
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

    function _move(address from, address to, uint256 amount) private {
        require(!isBlacklisted[from] && !isBlacklisted[to], "blacklisted");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
