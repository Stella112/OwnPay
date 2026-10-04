// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IRuleToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}

library RuleToken {
    function approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(IRuleToken.approve, (spender, amount)));
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "token approve failed");
    }
    function send(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(IRuleToken.transfer, (to, amount)));
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "token transfer failed");
    }
    function pull(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory result) = token.call(abi.encodeCall(IRuleToken.transferFrom, (from, to, amount)));
        require(ok && (result.length == 0 || abi.decode(result, (bool))), "token pull failed");
    }
}

/// @notice Purpose-limited receive account. NOT an ERC-4337 Kernel wallet.
/// The router may only take USDG for the owner's saved rule. No arbitrary execution.
contract OwnReceiveAccount {
    address public immutable owner;
    address public immutable router;
    address public immutable usdg;
    constructor(address owner_, address usdg_) {
        owner = owner_; router = msg.sender; usdg = usdg_;
    }
    function route(uint256 amount) external {
        require(msg.sender == router, "not router");
        RuleToken.send(usdg, router, amount);
    }
    function recover(address token, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        RuleToken.send(token, owner, amount);
    }
}

/// Venue that sells stock tokens for USDG at fresh market prices (see OwnPayStockDesk).
interface IStockDesk {
    function listed(address asset) external view returns (bool);
    function quote(address asset, uint256 usdgIn) external view returns (uint256);
    function buy(address asset, uint256 usdgIn, uint256 minOut, address recipient) external returns (uint256);
}

/// @notice Linear escrow for ownership assets actually received; not an investment product.
contract OwnAssetVesting {
    struct Grant { address owner; address asset; uint256 total; uint256 released; uint64 start; uint64 duration; }
    address public immutable router;
    uint256 public count;
    mapping(uint256 => Grant) public grants;
    mapping(address => uint256[]) private incoming;
    mapping(address => uint256) public escrowed;
    uint256 private lock = 1;
    event GrantCreated(uint256 indexed id, address indexed owner, address indexed asset, uint256 amount, uint64 start, uint64 duration);
    event Claimed(uint256 indexed id, address indexed owner, uint256 amount);
    constructor() { router = msg.sender; }
    function credit(address owner, address asset, uint256 amount, uint64 duration) external {
        require(msg.sender == router && amount > 0 && duration > 0, "invalid credit");
        escrowed[asset] += amount;
        require(IRuleToken(asset).balanceOf(address(this)) >= escrowed[asset], "unfunded grant");
        uint256 id = count++; grants[id] = Grant(owner, asset, amount, 0, uint64(block.timestamp), duration);
        incoming[owner].push(id); emit GrantCreated(id, owner, asset, amount, uint64(block.timestamp), duration);
    }
    function grantCount(address owner) external view returns(uint256) { return incoming[owner].length; }
    function grantId(address owner, uint256 index) external view returns(uint256) { return incoming[owner][index]; }
    function claimable(uint256 id) public view returns(uint256) {
        Grant memory g = grants[id]; if (g.owner == address(0)) return 0;
        uint256 elapsed = block.timestamp - g.start;
        uint256 vested = elapsed >= g.duration ? g.total : g.total * elapsed / g.duration;
        return vested - g.released;
    }
    function claim(uint256 id) external {
        require(lock == 1, "reentrant"); lock = 2;
        Grant storage g = grants[id]; uint256 amount = claimable(id); require(amount > 0, "nothing vested");
        g.released += amount; escrowed[g.asset] -= amount;
        RuleToken.send(g.asset, g.owner, amount); emit Claimed(id, g.owner, amount); lock = 1;
    }
}

/// @notice Financial split router: spendable goes to the owner, savings stays redeemable
/// here, and the ownership share buys the owner's chosen stock portfolio. If the
/// market is closed (stale price) or the desk can't fill, the ownership share is
/// queued as earmarked USDG and bought later (owner or delegated agent calls
/// buyPending); the payment itself never fails because of the market.
/// Compliance is recipient-programmed: each owner sets who may pay them and on what
/// terms (allowlist, blocklist, required memo, per-sender daily cap). There is no
/// administrator in the payment path. This is not KYC or sanctions screening.
contract OwnRules {
    struct Rule {
        uint16 savingsBps;
        uint16 ownershipBps;
        uint128 maxPayment;
        uint128 dailyLimit;
        uint64 version;
        bool enabled;
    }
    /// One slice of the ownership portfolio: `weightBps` of the ownership share buys `asset`.
    struct Allocation { address asset; uint16 weightBps; }
    uint256 public constant MAX_ASSETS = 5;
    struct Delegation { address agent; uint64 expires; uint64 ruleVersion; }
    /// Recipient-programmed payment policy; only the recipient can change it.
    struct Policy { bool allowlistOnly; bool requireMemo; uint128 perSenderDailyCap; }
    uint8 public constant SENDER_UNSET = 0;
    uint8 public constant SENDER_ALLOWED = 1;
    uint8 public constant SENDER_BLOCKED = 2;
    address public immutable usdg;
    /// Stock venue used for ownership purchases (address(0) = keep ownership as USDG).
    IStockDesk public immutable desk;
    OwnAssetVesting public immutable vesting;
    mapping(address => Allocation[]) private portfolio;
    mapping(address => uint64) public vestingSeconds;
    mapping(address => address) public accounts;
    mapping(address => Rule) public rules;
    mapping(address => Delegation) public delegations;
    mapping(address => Policy) public policies;
    mapping(address => mapping(address => uint8)) public senderStatus; // owner => sender => status
    mapping(address => mapping(address => uint256)) public senderSpentDay;
    mapping(address => mapping(address => uint256)) public senderSpentToday;
    mapping(address => uint256) public savings;
    /// USDG earmarked for the owner's portfolio, waiting to be bought (or withdrawn).
    mapping(address => uint256) public ownershipReserve;
    mapping(address => uint256) public nonces;
    mapping(address => uint256) public spentDay;
    mapping(address => uint256) public spentToday;
    uint256 public receiptCount;
    uint256 private lock = 1;
    bytes32 private constant INTENT_TYPEHASH = keccak256("Intent(address owner,uint8 action,bytes32 dataHash,uint256 nonce,uint256 deadline)");
    modifier guarded() { require(lock == 1, "reentrant"); lock = 2; _; lock = 1; }
    event AccountCreated(address indexed owner, address indexed account);
    event RuleSaved(address indexed owner, uint64 version, uint16 savingsBps, uint16 ownershipBps, address[] assets, uint16[] weightsBps);
    event OwnershipQueued(address indexed owner, uint256 usdgAmount);
    event OwnershipBought(address indexed owner, address indexed asset, uint256 usdgIn, uint256 rawOut);
    event AgentChanged(address indexed owner, address agent, uint64 expires, uint64 version);
    event PolicySaved(address indexed owner, bool allowlistOnly, bool requireMemo, uint128 perSenderDailyCap);
    event SenderStatusChanged(address indexed owner, address indexed sender, uint8 status);
    event PaymentReceipt(uint256 indexed id, address indexed owner, address indexed payer, uint256 amount,
        uint256 spendable, uint256 saved, uint256 ownership, uint256 assetOut, uint64 ruleVersion, bytes32 metadataCommitment);
    event Withdrawal(address indexed owner, bool ownership, uint256 amount);
    event VestingChanged(address indexed owner, uint64 seconds_, uint64 version);

    constructor(address usdg_, address desk_) {
        require(usdg_.code.length > 0, "USDG has no code");
        require(desk_ == address(0) || desk_.code.length > 0, "desk has no code");
        usdg = usdg_; desk = IStockDesk(desk_);
        vesting = new OwnAssetVesting();
    }
    function portfolioOf(address owner) external view returns (Allocation[] memory) { return portfolio[owner]; }
    function setPolicy(bool allowlistOnly, bool requireMemo, uint128 perSenderDailyCap) external guarded {
        _setPolicy(msg.sender, allowlistOnly, requireMemo, perSenderDailyCap);
    }
    function _setPolicy(address owner, bool allowlistOnly, bool requireMemo, uint128 perSenderDailyCap) internal {
        policies[owner] = Policy(allowlistOnly, requireMemo, perSenderDailyCap);
        emit PolicySaved(owner, allowlistOnly, requireMemo, perSenderDailyCap);
    }
    function setSender(address sender, uint8 status) external guarded { _setSender(msg.sender, sender, status); }
    function _setSender(address owner, address sender, uint8 status) internal {
        require(sender != address(0) && sender != owner && status <= SENDER_BLOCKED, "invalid sender status");
        senderStatus[owner][sender] = status;
        emit SenderStatusChanged(owner, sender, status);
    }
    function createAccount() external guarded returns (address) { return _create(msg.sender); }
    function _create(address owner) internal returns (address) {
        require(accounts[owner] == address(0), "account exists");
        address account = address(new OwnReceiveAccount(owner, usdg));
        accounts[owner] = account; emit AccountCreated(owner, account); return account;
    }
    /// @param assets / weightsBps  The ownership portfolio: weights (sum 10000) of the
    ///        ownership share buy each listed stock. Empty = keep ownership as USDG.
    function saveRule(uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit,
        address[] calldata assets, uint16[] calldata weightsBps, bool enabled) external guarded {
        _save(msg.sender, saved, owned, maxPayment, dailyLimit, assets, weightsBps, enabled);
    }
    function _save(address owner, uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit,
        address[] memory assets, uint16[] memory weightsBps, bool enabled) internal {
        require(uint256(saved) + owned <= 10000, "split over 100%");
        require(maxPayment > 0 && dailyLimit >= maxPayment, "invalid limits");
        require(assets.length == weightsBps.length && assets.length <= MAX_ASSETS, "invalid portfolio");
        delete portfolio[owner];
        uint256 total;
        for (uint256 i; i < assets.length; i++) {
            require(address(desk) != address(0) && desk.listed(assets[i]), "asset not listed");
            require(weightsBps[i] > 0, "zero weight");
            for (uint256 j; j < i; j++) require(assets[j] != assets[i], "duplicate asset");
            total += weightsBps[i];
            portfolio[owner].push(Allocation(assets[i], weightsBps[i]));
        }
        require(assets.length == 0 || total == 10000, "weights must total 100%");
        uint64 version = rules[owner].version + 1;
        rules[owner] = Rule(saved, owned, maxPayment, dailyLimit, version, enabled);
        // Any rule modification invalidates previous agent authority.
        delete delegations[owner];
        emit RuleSaved(owner, version, saved, owned, assets, weightsBps);
    }
    function delegate(address agent, uint64 expires) external guarded { _delegate(msg.sender, agent, expires); }
    function _delegate(address owner, address agent, uint64 expires) internal {
        require(agent == address(0) || (expires > block.timestamp && expires <= block.timestamp + 30 days), "invalid expiry");
        require(rules[owner].enabled || agent == address(0), "rule disabled");
        delegations[owner] = Delegation(agent, expires, rules[owner].version);
        emit AgentChanged(owner, agent, expires, rules[owner].version);
    }
    /// Enforce the recipient's own policy. `payer == address(0)` is a direct deposit
    /// whose sender cannot be verified onchain: allowlist-only recipients reject it
    /// (fail closed); the owner can still recover it from the receive account.
    function _checkPolicy(address owner, address payer, uint256 amount, bytes32 memo) internal {
        Policy memory p = policies[owner];
        if (payer == owner) return;
        if (payer == address(0)) { require(!p.allowlistOnly, "policy: sender unverifiable"); return; }
        uint8 status = senderStatus[owner][payer];
        require(status != SENDER_BLOCKED, "policy: sender blocked");
        require(!p.allowlistOnly || status == SENDER_ALLOWED, "policy: sender not allowlisted");
        require(!p.requireMemo || memo != bytes32(0), "policy: memo required");
        if (p.perSenderDailyCap > 0) {
            uint256 today = block.timestamp / 1 days;
            if (senderSpentDay[owner][payer] != today) { senderSpentDay[owner][payer] = today; senderSpentToday[owner][payer] = 0; }
            senderSpentToday[owner][payer] += amount;
            require(senderSpentToday[owner][payer] <= p.perSenderDailyCap, "policy: sender daily cap");
        }
    }
    function setVestingSeconds(uint64 seconds_) external guarded { _vesting(msg.sender, seconds_); }
    function _vesting(address owner, uint64 seconds_) internal {
        require(seconds_ <= 365 days, "vesting over one year");
        require(rules[owner].version > 0, "save rule first");
        vestingSeconds[owner] = seconds_; rules[owner].version++;
        delete delegations[owner]; emit VestingChanged(owner, seconds_, rules[owner].version);
    }
    function pay(address owner, uint256 amount, bytes32 metadataCommitment) external guarded {
        uint256 beforeBalance = IRuleToken(usdg).balanceOf(address(this));
        RuleToken.pull(usdg, msg.sender, address(this), amount);
        require(IRuleToken(usdg).balanceOf(address(this)) == beforeBalance + amount, "unsupported token behavior");
        _split(owner, msg.sender, amount, metadataCommitment);
    }
    /// @notice Process funds sent directly to the dedicated receive account.
    /// Agents cannot change recipients, rule, adapter, price, token or calldata.
    function processIncoming(address owner, uint256 amount, bytes32 metadataCommitment) external guarded {
        if (msg.sender != owner) {
            Delegation memory d = delegations[owner];
            require(d.agent == msg.sender && d.expires >= block.timestamp && d.ruleVersion == rules[owner].version, "agent denied");
        }
        address account = accounts[owner]; require(account != address(0), "no account");
        uint256 beforeBalance = IRuleToken(usdg).balanceOf(address(this));
        OwnReceiveAccount(account).route(amount);
        require(IRuleToken(usdg).balanceOf(address(this)) == beforeBalance + amount, "unsupported token behavior");
        // Direct deposits have no trustworthy payer identity; receipt explicitly uses zero.
        _split(owner, address(0), amount, metadataCommitment);
    }
    function _split(address owner, address payer, uint256 amount, bytes32 memo) internal {
        _checkPolicy(owner, payer, amount, memo);
        Rule memory r = rules[owner];
        require(r.enabled && amount > 0 && amount <= r.maxPayment, "payment policy denied");
        uint256 today = block.timestamp / 1 days;
        if (spentDay[owner] != today) { spentDay[owner] = today; spentToday[owner] = 0; }
        spentToday[owner] += amount; require(spentToday[owner] <= r.dailyLimit, "daily limit");
        uint256 saved = amount * r.savingsBps / 10000;
        uint256 owned = amount * r.ownershipBps / 10000;
        uint256 cash = amount - saved - owned;
        savings[owner] += saved;
        ownershipReserve[owner] += owned;
        if (cash > 0) RuleToken.send(usdg, owner, cash);
        // Buy the portfolio now if the market is open; otherwise keep it earmarked.
        // try/catch keeps the payment itself independent of market hours or inventory.
        if (owned > 0 && portfolio[owner].length > 0) {
            try this.buyFor(owner, owned) {} catch { emit OwnershipQueued(owner, owned); }
        }
        // Purchases are reported per asset in OwnershipBought; assetOut stays 0 here.
        emit PaymentReceipt(receiptCount++, owner, payer, amount, cash, saved, owned, 0, r.version, memo);
    }
    /// Self-call target so a failed purchase can be caught without failing the payment.
    function buyFor(address owner, uint256 amount) external {
        require(msg.sender == address(this), "internal only");
        _buy(owner, amount);
    }
    /// Buy earmarked ownership now (e.g. at the next market session). Callable by the
    /// owner, or by their delegated agent under the same rule-version-bound delegation.
    /// Reverts (nothing changes) if any slice can't be filled; it can be retried later.
    function buyPending(address owner, uint256 amount) external guarded {
        if (msg.sender != owner) {
            Delegation memory d = delegations[owner];
            require(d.agent == msg.sender && d.expires >= block.timestamp && d.ruleVersion == rules[owner].version, "agent denied");
        }
        _buy(owner, amount);
    }
    function _buy(address owner, uint256 amount) internal {
        Allocation[] memory p = portfolio[owner];
        require(p.length > 0, "no portfolio");
        require(amount > 0 && amount <= ownershipReserve[owner], "exceeds earmarked ownership");
        ownershipReserve[owner] -= amount;
        address recipient = vestingSeconds[owner] > 0 ? address(vesting) : owner;
        uint256 spent;
        for (uint256 i; i < p.length; i++) {
            uint256 slice = i == p.length - 1 ? amount - spent : amount * p[i].weightBps / 10000;
            spent += slice;
            if (slice == 0) continue;
            uint256 minOut = desk.quote(p[i].asset, slice); // reverts "stale price" when the market is closed
            uint256 before = IRuleToken(p[i].asset).balanceOf(recipient);
            RuleToken.approve(usdg, address(desk), slice);
            uint256 out = desk.buy(p[i].asset, slice, minOut, recipient);
            RuleToken.approve(usdg, address(desk), 0);
            // Trust received balances, not the venue's return value.
            require(out >= minOut && IRuleToken(p[i].asset).balanceOf(recipient) >= before + out, "ownership output shortfall");
            if (vestingSeconds[owner] > 0) vesting.credit(owner, p[i].asset, out, vestingSeconds[owner]);
            emit OwnershipBought(owner, p[i].asset, slice, out);
        }
    }
    function withdraw(bool ownership, uint256 amount) external guarded { _withdraw(msg.sender, ownership, amount); }
    function _withdraw(address owner, bool ownership, uint256 amount) internal {
        require(amount > 0, "zero withdrawal");
        // Withdrawals never depend on any payment policy.
        if (ownership) { ownershipReserve[owner] -= amount; } else { savings[owner] -= amount; }
        RuleToken.send(usdg, owner, amount); emit Withdrawal(owner, ownership, amount);
    }
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("OwnPay OwnRules"), keccak256("1"), block.chainid, address(this)));
    }
    function intentDigest(address owner, uint8 action, bytes calldata data, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(),
            keccak256(abi.encode(INTENT_TYPEHASH, owner, action, keccak256(data), nonces[owner], deadline))));
    }
    /// @notice Sponsor pays ETH for an owner-signed, replay-protected, purpose-limited intent.
    /// Custom testnet relay; not a third-party ERC-4337 paymaster.
    function executeSigned(address owner, uint8 action, bytes calldata data, uint256 deadline, bytes calldata signature) external guarded {
        require(owner != address(0) && deadline >= block.timestamp && deadline <= block.timestamp + 1 hours, "intent expired");
        require(signature.length == 65, "invalid signature");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        require(uint256(s) <= 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 && (v == 27 || v == 28), "noncanonical signature");
        require(ecrecover(intentDigest(owner, action, data, deadline), v, r, s) == owner, "wrong signer");
        nonces[owner]++;
        if (action == 0) { require(data.length == 0, "unexpected data"); _create(owner); }
        else if (action == 1) {
            (uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit, address[] memory assets, uint16[] memory weights, bool enabled) =
                abi.decode(data, (uint16, uint16, uint128, uint128, address[], uint16[], bool));
            _save(owner, saved, owned, maxPayment, dailyLimit, assets, weights, enabled);
        } else if (action == 2) { (address agent, uint64 expiry) = abi.decode(data, (address, uint64)); _delegate(owner, agent, expiry); }
        else if (action == 3) { (bool owned, uint256 amount) = abi.decode(data, (bool, uint256)); _withdraw(owner, owned, amount); }
        else if (action == 4) { _vesting(owner, abi.decode(data, (uint64))); }
        else if (action == 5) { (bool allowlistOnly, bool requireMemo, uint128 cap) = abi.decode(data, (bool, bool, uint128)); _setPolicy(owner, allowlistOnly, requireMemo, cap); }
        else if (action == 6) { (address sender, uint8 status) = abi.decode(data, (address, uint8)); _setSender(owner, sender, status); }
        else { revert("unknown action"); }
    }
}
