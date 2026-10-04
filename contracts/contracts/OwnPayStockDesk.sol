// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IDeskToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}
/// ERC-8056-style display multiplier exposed by Robinhood testnet stock tokens.
interface IUiMultiplier { function uiMultiplier() external view returns (uint256); }

/// @title OwnPayStockDesk
/// @notice TESTNET venue that sells faucet-issued stock tokens for USDG at real market
/// prices relayed onchain. Prices carry the MARKET'S OWN quote time (not the relay
/// time), so outside trading sessions quotes are correctly stale and purchases are
/// refused; OwnRules then queues the ownership share until the next session.
/// Inventory is supplied by the desk owner. Not a DEX, not an investment venue,
/// no monetary value.
contract OwnPayStockDesk {
    struct Price { uint128 usdPerShare; uint64 quoteTime; } // 8-decimal USD price per whole share

    address public immutable usdg;
    address public owner;
    address public relayer;
    uint64 public maxAge;      // max age of the market quote, seconds
    uint16 public spreadBps;   // desk spread charged on buys
    mapping(address => bool) public listed;
    mapping(address => Price) public prices;

    event Listed(address indexed asset, bool listed);
    event PriceUpdated(address indexed asset, uint128 usdPerShare, uint64 quoteTime);
    event Bought(address indexed asset, address indexed buyer, address indexed recipient, uint256 usdgIn, uint256 rawOut);
    event ConfigChanged(address relayer, uint64 maxAge, uint16 spreadBps);
    event Withdrawn(address indexed token, uint256 amount);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address usdg_, address relayer_, uint64 maxAge_, uint16 spreadBps_) {
        require(usdg_.code.length > 0, "USDG has no code");
        require(maxAge_ > 0 && spreadBps_ <= 500, "invalid config");
        usdg = usdg_; owner = msg.sender; relayer = relayer_; maxAge = maxAge_; spreadBps = spreadBps_;
        emit ConfigChanged(relayer_, maxAge_, spreadBps_);
    }

    function configure(address relayer_, uint64 maxAge_, uint16 spreadBps_) external onlyOwner {
        require(maxAge_ > 0 && spreadBps_ <= 500, "invalid config");
        relayer = relayer_; maxAge = maxAge_; spreadBps = spreadBps_;
        emit ConfigChanged(relayer_, maxAge_, spreadBps_);
    }
    function list(address asset, bool on) external onlyOwner {
        require(asset.code.length > 0 && asset != usdg, "invalid asset");
        if (on) { require(IDeskToken(asset).decimals() == 18, "unsupported decimals"); require(IUiMultiplier(asset).uiMultiplier() > 0, "no uiMultiplier"); }
        listed[asset] = on; emit Listed(asset, on);
    }

    /// Relayer publishes market prices with the source's quote timestamps.
    function pushPrices(address[] calldata assets, uint128[] calldata usdPerShare, uint64[] calldata quoteTimes) external {
        require(msg.sender == relayer, "not relayer");
        require(assets.length == usdPerShare.length && assets.length == quoteTimes.length, "length mismatch");
        for (uint256 i; i < assets.length; i++) {
            require(listed[assets[i]] && usdPerShare[i] > 0, "invalid price");
            require(quoteTimes[i] <= block.timestamp + 120, "quote from the future");
            if (quoteTimes[i] <= prices[assets[i]].quoteTime) continue; // monotonic; ignore older quotes
            prices[assets[i]] = Price(usdPerShare[i], quoteTimes[i]);
            emit PriceUpdated(assets[i], usdPerShare[i], quoteTimes[i]);
        }
    }

    function isFresh(address asset) public view returns (bool) {
        Price memory p = prices[asset];
        return listed[asset] && p.usdPerShare > 0 && block.timestamp <= uint256(p.quoteTime) + maxAge;
    }

    /// Raw token units out for `usdgIn` (6-decimal USDG valued at $1), after spread.
    function quote(address asset, uint256 usdgIn) public view returns (uint256 rawOut) {
        require(isFresh(asset), "stale price");
        Price memory p = prices[asset];
        // display shares (18 dec) = usdgIn * 1e12 * 1e8 / price ; raw = shares * 1e18 / uiMultiplier
        uint256 shares = usdgIn * 1e20 / p.usdPerShare * (10000 - spreadBps) / 10000;
        rawOut = shares * 1e18 / IUiMultiplier(asset).uiMultiplier();
    }

    function buy(address asset, uint256 usdgIn, uint256 minOut, address recipient) external returns (uint256 rawOut) {
        require(usdgIn > 0 && recipient != address(0), "invalid order");
        rawOut = quote(asset, usdgIn);
        require(rawOut > 0 && rawOut >= minOut, "insufficient output");
        require(IDeskToken(asset).balanceOf(address(this)) >= rawOut, "insufficient inventory");
        uint256 before = IDeskToken(usdg).balanceOf(address(this));
        require(IDeskToken(usdg).transferFrom(msg.sender, address(this), usdgIn), "usdg pull failed");
        require(IDeskToken(usdg).balanceOf(address(this)) == before + usdgIn, "unsupported usdg");
        require(IDeskToken(asset).transfer(recipient, rawOut), "asset transfer failed");
        emit Bought(asset, msg.sender, recipient, usdgIn, rawOut);
    }

    function withdraw(address token, uint256 amount) external onlyOwner {
        require(IDeskToken(token).transfer(owner, amount), "withdraw failed");
        emit Withdrawn(token, amount);
    }
}
