// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IRouterReenter { function withdraw(bool ownership, uint256 amount) external; function buyPending(address owner, uint256 amount) external; }

/// @notice Test-only dishonest venue. mode 1: claims output without delivering it.
/// mode 2: tries to re-enter OwnRules during buy. NOT for production.
contract AdversarialDesk {
    uint8 public mode; address public router; address public immutable usdg;
    constructor(address usdg_) { usdg = usdg_; }
    function configure(uint8 m, address r) external { mode = m; router = r; }
    function listed(address) external pure returns (bool) { return true; }
    function quote(address, uint256 usdgIn) external pure returns (uint256) { return usdgIn; }
    function buy(address, uint256 usdgIn, uint256, address) external returns (uint256) {
        if (mode == 2) IRouterReenter(router).buyPending(msg.sender, 1);
        if (mode == 2) IRouterReenter(router).withdraw(true, 1);
        return usdgIn; // mode 1 (and 2 if reentry somehow passed): lie, deliver nothing
    }
}
