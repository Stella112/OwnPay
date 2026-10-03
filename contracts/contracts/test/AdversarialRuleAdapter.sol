// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "../OwnRules.sol";
contract AdversarialRuleAdapter is IOwnershipAdapter {
    address public immutable asset;
    OwnRules public immutable router;
    bool public immutable reenter;
    constructor(address token, address router_, bool reenter_) { asset = token; router = OwnRules(router_); reenter = reenter_; }
    function buy(uint256, address recipient, uint256 minimum) external returns(uint256) {
        if (reenter) router.pay(recipient, 1, bytes32(0));
        return minimum; // Claim output that was never transferred.
    }
}
