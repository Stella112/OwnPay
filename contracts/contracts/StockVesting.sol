// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Minimal ERC-20 surface used for escrow moves. B20 tokenized stocks
///      expose standard transfer/transferFrom over RAW (unscaled) units.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev B20 scaled-balance conversion surface (Coinbase tokenized stock).
///      Used ONLY by the optional display helper `releasableShares`.
///      `toScaledBalance` is retained by the current B20 spec as a backward
///      compatible alias of `toUIAmount`.
interface IB20Scaled {
    function toScaledBalance(uint256 rawAmount) external view returns (uint256);
}

/**
 * @title StockVesting
 * @notice Escrow + linear vesting for Coinbase B20 tokenized stocks on Base.
 *         Grants hold RAW B20 units. All fund accounting is in RAW units so it
 *         stays correct across B20 multiplier (corporate-action) changes; only
 *         *display* conversion to UI/scaled amounts happens off-chain (or via the
 *         optional `releasableShares` helper).
 *
 *         Two product modes share this one escrow:
 *           - Pay:  revocable = true  (employer may reclaim the unvested portion)
 *           - Gift: revocable = false, with cliff == end for an all-or-nothing unlock
 */
contract StockVesting {
    struct Grant {
        address token;     // B20 token being vested
        address from;      // creator / employer (funds escrow; revoke refunds here)
        address to;        // recipient
        uint256 total;     // total RAW B20 units escrowed for this grant
        uint256 released;  // RAW B20 units already released to recipient
        uint64 start;      // vesting start (unix seconds)
        uint64 cliff;      // nothing vests before this time
        uint64 duration;   // seconds from `start` to fully vested
        bool revocable;    // employer may revoke the unvested portion
        bool revoked;      // set once revoked
        bytes32 memo;      // onchain memo (UTF-8, validated off-chain to fit 32 bytes)
    }

    /// @notice Auto-generated getter exposes `grants(id)` returning every field
    ///         (token, from, to, total, released, start, cliff, duration, revocable, revoked, memo).
    mapping(uint256 => Grant) public grants;

    /// @notice Total number of grants ever created. IDs are 0..grantCount-1.
    /// @dev    Consumers MUST read a new grant's id from the GrantCreated event,
    ///         never infer it as `grantCount - 1`.
    uint256 public grantCount;

    // --- reentrancy guard ---
    uint256 private _lock = 1;
    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    event GrantCreated(
        uint256 indexed id,
        address indexed token,
        address indexed to,
        address from,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 duration,
        bool revocable,
        bytes32 memo
    );
    event Released(uint256 indexed id, address indexed to, uint256 rawAmount);
    event Revoked(uint256 indexed id, address indexed from, uint256 refundedRaw);
    event MemoTransfer(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 rawAmount,
        bytes32 memo
    );

    /**
     * @notice Create a vesting grant and pull `total` RAW B20 units into escrow.
     * @dev    Caller must have approved this contract for `total` on `token`.
     * @return id The new grant id (also emitted in GrantCreated).
     */
    function createGrant(
        address token,
        address to,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint64 duration,
        bool revocable,
        bytes32 memo
    ) external nonReentrant returns (uint256 id) {
        require(token != address(0), "token=0");
        require(to != address(0), "to=0");
        require(total > 0, "total=0");
        require(duration > 0, "duration=0");
        require(cliff >= start, "cliff<start");
        require(uint256(cliff) <= uint256(start) + uint256(duration), "cliff>end");

        id = grantCount++;
        grants[id] = Grant({
            token: token,
            from: msg.sender,
            to: to,
            total: total,
            released: 0,
            start: start,
            cliff: cliff,
            duration: duration,
            revocable: revocable,
            revoked: false,
            memo: memo
        });

        // Effects done; now the external pull. Requires prior approval.
        require(IERC20(token).transferFrom(msg.sender, address(this), total), "pull failed");

        emit GrantCreated(id, token, to, msg.sender, total, start, cliff, duration, revocable, memo);
    }

    /**
     * @notice RAW B20 units vested so far for `id`.
     * @dev    Before cliff: 0. At/after start+duration: total. Linear in between.
     *         A revoked grant's `total` was already capped to its vested amount,
     *         so it returns that capped total.
     */
    function vestedRaw(uint256 id) public view returns (uint256) {
        Grant storage g = grants[id];
        if (g.to == address(0)) return 0; // nonexistent
        if (g.revoked) return g.total; // capped at revoke time
        uint256 t = block.timestamp;
        if (t < g.cliff) return 0;
        uint256 end = uint256(g.start) + uint256(g.duration);
        if (t >= end) return g.total;
        // t >= cliff >= start, so (t - start) is non-negative.
        return (g.total * (t - uint256(g.start))) / uint256(g.duration);
    }

    /// @notice RAW B20 units currently claimable (vested minus already released).
    function releasableRaw(uint256 id) public view returns (uint256) {
        Grant storage g = grants[id];
        if (g.to == address(0)) return 0;
        uint256 vested = vestedRaw(id);
        if (vested <= g.released) return 0;
        return vested - g.released;
    }

    /**
     * @notice Optional display helper: claimable amount converted to B20 scaled/UI
     *         units via the token's `toScaledBalance`.
     * @dev    Reverts if the token does not expose the selector; that is a display
     *         concern only and does not affect RAW fund accounting. Callers should
     *         treat a revert here as "use off-chain conversion instead".
     */
    function releasableShares(uint256 id) external view returns (uint256) {
        Grant storage g = grants[id];
        if (g.to == address(0)) return 0;
        return IB20Scaled(g.token).toScaledBalance(releasableRaw(id));
    }

    /**
     * @notice Release all currently claimable RAW B20 units to the recipient.
     * @dev    Callable by anyone; funds always go to the grant's recipient.
     * @return amount RAW B20 units transferred.
     */
    function release(uint256 id) external nonReentrant returns (uint256 amount) {
        Grant storage g = grants[id];
        require(g.to != address(0), "no grant");
        amount = releasableRaw(id);
        require(amount > 0, "nothing to release");
        g.released += amount;
        require(IERC20(g.token).transfer(g.to, amount), "transfer failed");
        emit Released(id, g.to, amount);
    }

    /**
     * @notice Revoke the unvested portion of a revocable grant, refunding it to the
     *         employer. The recipient keeps whatever has already vested.
     * @dev    Only the grant creator may revoke, only once, only if revocable.
     */
    function revoke(uint256 id) external nonReentrant {
        Grant storage g = grants[id];
        require(g.to != address(0), "no grant");
        require(g.revocable, "not revocable");
        require(!g.revoked, "already revoked");
        require(msg.sender == g.from, "not employer");

        uint256 vestedNow = vestedRaw(id);
        uint256 refund = g.total - vestedNow; // unvested portion
        g.total = vestedNow; // recipient may still claim vestedNow - released
        g.revoked = true;

        if (refund > 0) {
            require(IERC20(g.token).transfer(g.from, refund), "refund failed");
        }
        emit Revoked(id, g.from, refund);
    }

    /**
     * @notice Fallback tip path for tokens WITHOUT a native memo transfer: moves
     *         `amount` RAW B20 units from caller to `to` and records `memo` onchain.
     * @dev    Requires the caller to have approved this contract. The frontend
     *         prefers the token's own `transferWithMemo` (no approval, no escrow)
     *         and only uses this when the token lacks that selector.
     */
    function tipWithMemo(address token, address to, uint256 amount, bytes32 memo)
        external
        nonReentrant
    {
        require(token != address(0), "token=0");
        require(to != address(0), "to=0");
        require(amount > 0, "amount=0");
        require(IERC20(token).transferFrom(msg.sender, to, amount), "transfer failed");
        emit MemoTransfer(token, msg.sender, to, amount, memo);
    }
}
