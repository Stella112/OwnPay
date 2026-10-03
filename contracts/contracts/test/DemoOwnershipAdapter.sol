// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "../OwnRules.sol";

/// @notice Explicit no-value demo ownership units. NOT Robinhood Stock Tokens,
/// NOT backed by equities, not a market price, not intended for production.
contract DemoOwnershipUnits {
    string public constant name = "OwnPay DEMO Ownership Units (no value)";
    string public constant symbol = "DEMO-OWN";
    uint8 public constant decimals = 18;
    address public immutable minter;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 amount);
    constructor() { minter = msg.sender; }
    function mint(address to, uint256 amount) external {
        require(msg.sender == minter, "not minter");
        totalSupply += amount; balanceOf[to] += amount; emit Transfer(address(0), to, amount);
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(to != address(0), "zero recipient");
        balanceOf[msg.sender] -= amount; balanceOf[to] += amount; emit Transfer(msg.sender, to, amount); return true;
    }
}

contract DemoOwnershipAdapter is IOwnershipAdapter {
    address public immutable router;
    address public immutable usdg;
    address public immutable treasury;
    address public immutable asset;
    constructor(address router_, address usdg_) {
        router = router_; usdg = usdg_; treasury = msg.sender; asset = address(new DemoOwnershipUnits());
    }
    function buy(uint256 amount, address to, uint256 minOut) external returns (uint256 out) {
        require(msg.sender == router, "not router");
        out = amount * 1e12; // DEMO ONLY: one no-value unit per test USDG
        require(out >= minOut, "minimum output");
        RuleToken.send(usdg, treasury, amount);
        DemoOwnershipUnits(asset).mint(to, out);
    }
}
