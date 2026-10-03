// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IRuleToken {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

library RuleToken {
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

interface IOwnershipAdapter {
    function asset() external view returns (address);
    function buy(uint256 usdgAmount, address recipient, uint256 minOut) external returns (uint256);
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

/// @notice Financial split router: spendable goes to owner, savings stays redeemable
/// in this contract, ownership buys an explicitly allowed asset or stays as USDG reserve.
/// Compliance is a locally administered test policy, not a KYC/sanctions provider.
contract OwnRules {
    struct Rule {
        uint16 savingsBps;
        uint16 ownershipBps;
        uint128 maxPayment;
        uint128 dailyLimit;
        address adapter;
        uint128 minAssetPerUsdg; // raw asset units per 1e6 raw USDG, minimum acceptable price
        uint64 version;
        bool enabled;
    }
    struct Delegation { address agent; uint64 expires; uint64 ruleVersion; }
    struct Compliance { uint64 expires; bool blocked; }
    address public immutable usdg;
    address public immutable policyAdmin;
    OwnAssetVesting public immutable vesting;
    mapping(address => uint64) public vestingSeconds;
    mapping(address => address) public accounts;
    mapping(address => Rule) public rules;
    mapping(address => Delegation) public delegations;
    mapping(address => Compliance) public compliance;
    mapping(address => bool) public allowedAdapters;
    mapping(address => uint256) public savings;
    mapping(address => uint256) public ownershipReserve;
    mapping(address => uint256) public nonces;
    mapping(address => uint256) public spentDay;
    mapping(address => uint256) public spentToday;
    uint256 public receiptCount;
    uint256 private lock = 1;
    bytes32 private constant INTENT_TYPEHASH = keccak256("Intent(address owner,uint8 action,bytes32 dataHash,uint256 nonce,uint256 deadline)");
    modifier guarded() { require(lock == 1, "reentrant"); lock = 2; _; lock = 1; }
    modifier admin() { require(msg.sender == policyAdmin, "not policy admin"); _; }
    event AccountCreated(address indexed owner, address indexed account);
    event RuleSaved(address indexed owner, uint64 version, uint16 savingsBps, uint16 ownershipBps, address adapter);
    event AgentChanged(address indexed owner, address agent, uint64 expires, uint64 version);
    event ComplianceChanged(address indexed account, uint64 expires, bool blocked);
    event AdapterChanged(address indexed adapter, bool enabled);
    event PaymentReceipt(uint256 indexed id, address indexed owner, address indexed payer, uint256 amount,
        uint256 spendable, uint256 saved, uint256 ownership, uint256 assetOut, uint64 ruleVersion, bytes32 metadataCommitment);
    event Withdrawal(address indexed owner, bool ownership, uint256 amount);
    event VestingChanged(address indexed owner, uint64 seconds_, uint64 version);

    constructor(address usdg_) {
        require(usdg_.code.length > 0, "USDG has no code");
        usdg = usdg_; policyAdmin = msg.sender;
        vesting = new OwnAssetVesting();
    }
    function setCompliance(address account, uint64 expires, bool blocked) external admin {
        require(account != address(0), "zero account");
        compliance[account] = Compliance(expires, blocked);
        emit ComplianceChanged(account, expires, blocked);
    }
    function setAdapter(address adapter, bool enabled) external admin {
        require(adapter.code.length > 0, "adapter has no code");
        allowedAdapters[adapter] = enabled; emit AdapterChanged(adapter, enabled);
    }
    function createAccount() external guarded returns (address) { return _create(msg.sender); }
    function _create(address owner) internal returns (address) {
        require(accounts[owner] == address(0), "account exists");
        address account = address(new OwnReceiveAccount(owner, usdg));
        accounts[owner] = account; emit AccountCreated(owner, account); return account;
    }
    function saveRule(uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit,
        address adapter, uint128 minRate, bool enabled) external guarded {
        _save(msg.sender, saved, owned, maxPayment, dailyLimit, adapter, minRate, enabled);
    }
    function _save(address owner, uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit,
        address adapter, uint128 minRate, bool enabled) internal {
        require(uint256(saved) + owned <= 10000, "split over 100%");
        require(maxPayment > 0 && dailyLimit >= maxPayment, "invalid limits");
        require(adapter == address(0) || (allowedAdapters[adapter] && minRate > 0), "unapproved adapter/price");
        uint64 version = rules[owner].version + 1;
        rules[owner] = Rule(saved, owned, maxPayment, dailyLimit, adapter, minRate, version, enabled);
        // Any rule modification invalidates previous agent authority.
        delete delegations[owner];
        emit RuleSaved(owner, version, saved, owned, adapter);
    }
    function delegate(address agent, uint64 expires) external guarded { _delegate(msg.sender, agent, expires); }
    function _delegate(address owner, address agent, uint64 expires) internal {
        require(agent == address(0) || (expires > block.timestamp && expires <= block.timestamp + 30 days), "invalid expiry");
        require(rules[owner].enabled || agent == address(0), "rule disabled");
        delegations[owner] = Delegation(agent, expires, rules[owner].version);
        emit AgentChanged(owner, agent, expires, rules[owner].version);
    }
    function _eligible(address account) internal view {
        Compliance memory c = compliance[account];
        require(!c.blocked && c.expires >= block.timestamp, "compliance denied");
    }
    function setVestingSeconds(uint64 seconds_) external guarded { _vesting(msg.sender, seconds_); }
    function _vesting(address owner, uint64 seconds_) internal {
        require(seconds_ <= 365 days, "vesting over one year");
        require(rules[owner].version > 0, "save rule first");
        vestingSeconds[owner] = seconds_; rules[owner].version++;
        delete delegations[owner]; emit VestingChanged(owner, seconds_, rules[owner].version);
    }
    function pay(address owner, uint256 amount, bytes32 metadataCommitment) external guarded {
        _eligible(msg.sender);
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
        _eligible(owner);
        Rule memory r = rules[owner];
        require(r.enabled && amount > 0 && amount <= r.maxPayment, "payment policy denied");
        uint256 today = block.timestamp / 1 days;
        if (spentDay[owner] != today) { spentDay[owner] = today; spentToday[owner] = 0; }
        spentToday[owner] += amount; require(spentToday[owner] <= r.dailyLimit, "daily limit");
        uint256 saved = amount * r.savingsBps / 10000;
        uint256 owned = amount * r.ownershipBps / 10000;
        uint256 cash = amount - saved - owned;
        savings[owner] += saved;
        uint256 assetOut;
        if (owned > 0 && r.adapter != address(0)) {
            require(allowedAdapters[r.adapter], "adapter disabled");
            uint256 minimum = owned * r.minAssetPerUsdg / 1e6;
            require(minimum > 0, "ownership dust");
            address asset = IOwnershipAdapter(r.adapter).asset();
            address recipient = vestingSeconds[owner] > 0 ? address(vesting) : owner;
            uint256 beforeAsset = IRuleToken(asset).balanceOf(recipient);
            RuleToken.send(usdg, r.adapter, owned);
            assetOut = IOwnershipAdapter(r.adapter).buy(owned, recipient, minimum);
            require(assetOut >= minimum && IRuleToken(asset).balanceOf(recipient) >= beforeAsset + assetOut, "ownership output shortfall");
            if (vestingSeconds[owner] > 0) vesting.credit(owner, asset, assetOut, vestingSeconds[owner]);
        } else { ownershipReserve[owner] += owned; }
        if (cash > 0) RuleToken.send(usdg, owner, cash);
        emit PaymentReceipt(receiptCount++, owner, payer, amount, cash, saved, owned, assetOut, r.version, memo);
    }
    function withdraw(bool ownership, uint256 amount) external guarded { _withdraw(msg.sender, ownership, amount); }
    function _withdraw(address owner, bool ownership, uint256 amount) internal {
        require(amount > 0, "zero withdrawal");
        // Withdrawals remain available even when allocation compliance is revoked.
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
            (uint16 saved, uint16 owned, uint128 maxPayment, uint128 dailyLimit, address adapter, uint128 rate, bool enabled) =
                abi.decode(data, (uint16, uint16, uint128, uint128, address, uint128, bool));
            _save(owner, saved, owned, maxPayment, dailyLimit, adapter, rate, enabled);
        } else if (action == 2) { (address agent, uint64 expiry) = abi.decode(data, (address, uint64)); _delegate(owner, agent, expiry); }
        else if (action == 3) { (bool owned, uint256 amount) = abi.decode(data, (bool, uint256)); _withdraw(owner, owned, amount); }
        else if (action == 4) { _vesting(owner, abi.decode(data, (uint64))); }
        else { revert("unknown action"); }
    }
}
