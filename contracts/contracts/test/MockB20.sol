// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title MockB20
 * @notice Test-only mock of a Coinbase B20 tokenized stock. NOT for production.
 *         Mirrors the REAL Base B20 read surface as verified on mainnet
 *         (chainId 8453) on 2026-09-09: multiplier(), scaledBalanceOf(account),
 *         toScaledBalance(raw), toRawBalance(scaled), transferWithMemo and
 *         transferFromWithMemo. It deliberately does NOT expose toUIAmount /
 *         fromUIAmount / balanceOfUI / uiMultiplier — those do not exist on the
 *         real token — so local tests actually predict mainnet behavior.
 *
 *         Multiplier is fixed-point with 1e18 == 1.0x:
 *           scaled = raw    * multiplier / 1e18
 *           raw    = scaled * 1e18 / multiplier
 */
contract MockB20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf; // RAW units
    mapping(address => mapping(address => uint256)) public allowance;

    uint256 private constant ONE = 1e18;
    uint256 private _multiplier = ONE; // 1.0x by default

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MemoTransfer(address indexed from, address indexed to, uint256 value, bytes32 memo);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    // --- test helpers ---
    function mint(address to, uint256 rawAmount) external {
        balanceOf[to] += rawAmount;
        totalSupply += rawAmount;
        emit Transfer(address(0), to, rawAmount);
    }

    function setMultiplier(uint256 newMultiplier) external {
        require(newMultiplier > 0, "mult=0");
        _multiplier = newMultiplier;
    }

    // --- ERC-20 (RAW units) ---
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    // --- native memo transfer (preferred Tip path, no approval/escrow) ---
    function transferWithMemo(address to, uint256 amount, bytes32 memo) external returns (bool) {
        _transfer(msg.sender, to, amount);
        emit MemoTransfer(msg.sender, to, amount, memo);
        return true;
    }

    function transferFromWithMemo(address from, address to, uint256 amount, bytes32 memo)
        external
        returns (bool)
    {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _transfer(from, to, amount);
        emit MemoTransfer(from, to, amount, memo);
        return true;
    }

    // --- B20 conversion surface (real mainnet names only) ---
    function multiplier() external view returns (uint256) {
        return _multiplier;
    }

    function toScaledBalance(uint256 rawAmount) public view returns (uint256) {
        return (rawAmount * _multiplier) / ONE;
    }

    function toRawBalance(uint256 scaledAmount) public view returns (uint256) {
        return (scaledAmount * ONE) / _multiplier;
    }

    function scaledBalanceOf(address account) external view returns (uint256) {
        return toScaledBalance(balanceOf[account]);
    }
}
