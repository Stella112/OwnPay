const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

async function fixture() {
  const [admin, owner, payer, agent, attacker] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory('MockB20')).deploy('Test USDG', 'USDG', 6);
  const Stock = await ethers.getContractFactory('MockStockToken');
  const tsla = await Stock.deploy('Tesla', 'TSLA'); const amzn = await Stock.deploy('Amazon', 'AMZN');
  // relayer = admin, quotes valid for 30 min, no spread (keeps the math exact in tests)
  const desk = await (await ethers.getContractFactory('OwnPayStockDesk')).deploy(await token.getAddress(), admin.address, 1800, 0);
  for (const t of [tsla, amzn]) { await desk.list(await t.getAddress(), true); await t.mint(await desk.getAddress(), 1000n * 10n ** 18n); }
  const fresh = async () => desk.pushPrices([await tsla.getAddress(), await amzn.getAddress()], [250n * 10n ** 8n, 200n * 10n ** 8n], [await time.latest(), await time.latest()]);
  await fresh();
  const router = await (await ethers.getContractFactory('OwnRules')).deploy(await token.getAddress(), await desk.getAddress());
  await router.connect(owner).createAccount();
  await router.connect(owner).saveRule(1000, 2000, 100e6, 200e6, [], [], true);
  await token.mint(payer.address, 1000e6);
  await token.connect(payer).approve(await router.getAddress(), 1000e6);
  return { admin, owner, payer, agent, attacker, token, router, desk, tsla, amzn, fresh };
}
const memo = ethers.keccak256(ethers.toUtf8Bytes('random salt + encrypted private memo'));
async function sign(f, action, data = '0x', overrides = {}) {
  const deadline = BigInt(await time.latest()) + 600n;
  const domain = { name: 'OwnPay OwnRules', version: '1', chainId: 31337, verifyingContract: await f.router.getAddress(), ...overrides };
  const types = { Intent: [{ name: 'owner', type: 'address' }, { name: 'action', type: 'uint8' }, { name: 'dataHash', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  const signature = await f.owner.signTypedData(domain, types, { owner: f.owner.address, action, dataHash: ethers.keccak256(data), nonce: await f.router.nonces(f.owner.address), deadline });
  return { deadline, signature, data, action };
}
describe('OwnRules financial and security integration', function () {
  it('relays receive-account creation and refuses unexpected creation data', async () => {
    const f = await fixture(); const newcomer = { router: f.router, owner: f.attacker };
    const malformed = await sign(newcomer, 0, '0x01');
    await expect(f.router.executeSigned(f.attacker.address, 0, '0x01', malformed.deadline, malformed.signature)).to.be.revertedWith('unexpected data');
    expect(await f.router.nonces(f.attacker.address)).to.equal(0);
    const good = await sign(newcomer, 0);
    await f.router.connect(f.agent).executeSigned(f.attacker.address, 0, '0x', good.deadline, good.signature);
    expect(await f.router.accounts(f.attacker.address)).not.to.equal(ethers.ZeroAddress);
    expect(await f.router.nonces(f.attacker.address)).to.equal(1);
  });
  it('relays rule edits, vesting and withdrawals without granting the sponsor ownership', async () => {
    const f = await fixture(); const coder = ethers.AbiCoder.defaultAbiCoder();
    async function relay(action, data) {
      const s = await sign(f, action, data);
      await f.router.connect(f.attacker).executeSigned(f.owner.address, action, data, s.deadline, s.signature);
    }
    await relay(1, coder.encode(['uint16','uint16','uint128','uint128','address[]','uint16[]','bool'], [1000,2000,100e6,200e6,[],[],true]));
    await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 3600);
    await relay(4, coder.encode(['uint64'], [60]));
    expect(await f.router.vestingSeconds(f.owner.address)).to.equal(60);
    expect((await f.router.delegations(f.owner.address)).agent).to.equal(ethers.ZeroAddress);
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    await relay(3, coder.encode(['bool','uint256'], [false,10e6]));
    expect(await f.token.balanceOf(f.owner.address)).to.equal(80e6);
    expect(await f.token.balanceOf(f.attacker.address)).to.equal(0);
    expect(await f.router.nonces(f.owner.address)).to.equal(3);
  });
  it('rejects malleable signatures and signatures for another router', async () => {
    const f = await fixture(); const s = await sign(f, 9);
    const parsed = ethers.Signature.from(s.signature);
    const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const high = ethers.concat([parsed.r, ethers.toBeHex(order - BigInt(parsed.s), 32), ethers.toBeHex(parsed.v === 27 ? 28 : 27, 1)]);
    await expect(f.router.executeSigned(f.owner.address, 9, '0x', s.deadline, high)).to.be.revertedWith('noncanonical signature');
    const other = await sign(f, 9, '0x', { verifyingContract: await f.desk.getAddress() });
    await expect(f.router.executeSigned(f.owner.address, 9, '0x', other.deadline, other.signature)).to.be.revertedWith('wrong signer');
    expect(await f.router.nonces(f.owner.address)).to.equal(0);
  });
  it('dishonest or reentrant venues cannot take funds: payment succeeds, ownership stays queued', async () => {
    for (const mode of [1, 2]) {
      const f = await fixture();
      const evil = await (await ethers.getContractFactory('AdversarialDesk')).deploy(await f.token.getAddress());
      const router = await (await ethers.getContractFactory('OwnRules')).deploy(await f.token.getAddress(), await evil.getAddress());
      await evil.configure(mode, await router.getAddress());
      await router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [await f.tsla.getAddress()], [10000], true);
      await f.token.connect(f.payer).approve(await router.getAddress(), 1000e6);
      await expect(router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.emit(router, 'OwnershipQueued').withArgs(f.owner.address, 20e6);
      expect(await router.ownershipReserve(f.owner.address)).to.equal(20e6);
      expect(await f.token.balanceOf(await router.getAddress())).to.equal(30e6); // savings + queued ownership, nothing leaked
      await expect(router.connect(f.owner).buyPending(f.owner.address, 20e6)).to.be.revertedWith(mode === 1 ? 'ownership output shortfall' : 'reentrant');
      expect(await router.ownershipReserve(f.owner.address)).to.equal(20e6);
    }
  });
  it('conserves funds across multiple integer-rounding cases', async () => {
    const f = await fixture(); let aggregate = 0n;
    for (const amount of [1n, 7n, 13n, 100001n, 99999999n]) {
      await f.router.connect(f.payer).pay(f.owner.address, amount, memo); aggregate += amount;
      const received = await f.token.balanceOf(f.owner.address);
      expect(received + await f.router.savings(f.owner.address) + await f.router.ownershipReserve(f.owner.address)).to.equal(aggregate);
      expect(await f.token.balanceOf(await f.router.getAddress())).to.equal(await f.router.savings(f.owner.address) + await f.router.ownershipReserve(f.owner.address));
    }
  });
  it('vests real received demo assets, discovers grants without links, and claims only to owner', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [await f.tsla.getAddress()], [10000], true);
    await f.router.connect(f.owner).setVestingSeconds(100);
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo); // 20 USDG at $250 = 0.08 TSLA, into vesting
    const vesting = await ethers.getContractAt('OwnAssetVesting', await f.router.vesting());
    const asset = f.tsla;
    expect(await vesting.grantCount(f.owner.address)).to.equal(1);
    expect(await vesting.grantId(f.owner.address, 0)).to.equal(0);
    expect(await asset.balanceOf(f.owner.address)).to.equal(0);
    expect(await asset.balanceOf(await vesting.getAddress())).to.equal(8n * 10n ** 16n);
    await expect(vesting.connect(f.attacker).credit(f.attacker.address, await asset.getAddress(), 1, 100)).to.be.revertedWith('invalid credit');
    await time.increase(50);
    await vesting.connect(f.attacker).claim(0);
    expect(await asset.balanceOf(f.attacker.address)).to.equal(0);
    expect(await asset.balanceOf(f.owner.address)).to.be.greaterThan(0);
    await time.increase(100);
    await vesting.claim(0);
    expect(await asset.balanceOf(f.owner.address)).to.equal(8n * 10n ** 16n);
    expect(await vesting.escrowed(await asset.getAddress())).to.equal(0);
    await expect(vesting.claim(0)).to.be.revertedWith('nothing vested');
  });
  it('vesting schedule changes invalidate authority and reject over-one-year schedules', async () => {
    const f = await fixture(); await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 3600);
    await f.router.connect(f.owner).setVestingSeconds(100);
    await expect(f.router.connect(f.agent).processIncoming(f.owner.address, 1, memo)).to.be.revertedWith('agent denied');
    await expect(f.router.connect(f.owner).setVestingSeconds(366 * 86400)).to.be.revertedWith('vesting over one year');
  });
  it('executes 100 USDG as actual 70/10/20 movements and auditable receipt', async () => {
    const f = await fixture();
    await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.emit(f.router, 'PaymentReceipt')
      .withArgs(0, f.owner.address, f.payer.address, 100e6, 70e6, 10e6, 20e6, 0, 1, memo);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(70e6);
    expect(await f.token.balanceOf(await f.router.getAddress())).to.equal(30e6);
    expect(await f.router.savings(f.owner.address)).to.equal(10e6);
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(20e6);
  });
  it('buys a 50/50 stock portfolio instantly when prices are fresh', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [await f.tsla.getAddress(), await f.amzn.getAddress()], [5000, 5000], true);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo))
      .to.emit(f.router, 'OwnershipBought').withArgs(f.owner.address, await f.tsla.getAddress(), 10e6, 4n * 10n ** 16n)
      .and.to.emit(f.router, 'OwnershipBought').withArgs(f.owner.address, await f.amzn.getAddress(), 10e6, 5n * 10n ** 16n);
    expect(await f.tsla.balanceOf(f.owner.address)).to.equal(4n * 10n ** 16n);  // $10 / $250
    expect(await f.amzn.balanceOf(f.owner.address)).to.equal(5n * 10n ** 16n);  // $10 / $200
    expect(await f.token.balanceOf(await f.desk.getAddress())).to.equal(20e6);
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(0);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(70e6);
  });
  it('queues ownership while the market is closed, then the agent buys at the next session', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [await f.tsla.getAddress()], [10000], true);
    await time.increase(3600); // quotes now older than maxAge: market closed
    await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.emit(f.router, 'OwnershipQueued').withArgs(f.owner.address, 20e6);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(70e6);          // spendable arrives anyway
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(20e6); // earmarked
    expect(await f.tsla.balanceOf(f.owner.address)).to.equal(0);
    await expect(f.router.connect(f.agent).buyPending(f.owner.address, 20e6)).to.be.revertedWith('agent denied');
    await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 86400);
    await expect(f.router.connect(f.agent).buyPending(f.owner.address, 20e6)).to.be.revertedWith('stale price');
    await f.fresh(); // next session opens
    await f.router.connect(f.agent).buyPending(f.owner.address, 20e6);
    expect(await f.tsla.balanceOf(f.owner.address)).to.equal(8n * 10n ** 16n);
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(0);
  });
  it('validates portfolios: listed, unique, non-zero, totals 100%, at most 5', async () => {
    const f = await fixture(); const t = await f.tsla.getAddress(); const a = await f.amzn.getAddress();
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [f.attacker.address], [10000], true)).to.be.revertedWith('asset not listed');
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [t, a], [5000, 4000], true)).to.be.revertedWith('weights must total 100%');
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [t, t], [5000, 5000], true)).to.be.revertedWith('duplicate asset');
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [t, a], [10000, 0], true)).to.be.revertedWith('zero weight');
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [t, a, t, a, t, a], [1, 1, 1, 1, 1, 1], true)).to.be.revertedWith('invalid portfolio');
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [t], [], true)).to.be.revertedWith('invalid portfolio');
    await f.router.connect(f.owner).saveRule(0, 2000, 1, 1, [t, a], [7000, 3000], true);
    const p = await f.router.portfolioOf(f.owner.address);
    expect(p.map((x) => [x.asset, Number(x.weightBps)])).to.deep.equal([[t, 7000], [a, 3000]]);
  });
  it('owner can cancel queued ownership by withdrawing it as USDG', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [await f.tsla.getAddress()], [10000], true);
    await time.increase(3600);
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    await f.router.connect(f.owner).withdraw(true, 20e6);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(90e6);
    await expect(f.router.connect(f.owner).buyPending(f.owner.address, 1)).to.be.revertedWith('exceeds earmarked ownership');
  });
  it('desk: only the relayer prices, no future quotes, honors uiMultiplier and inventory', async () => {
    const f = await fixture(); const t = await f.tsla.getAddress();
    await expect(f.desk.connect(f.attacker).pushPrices([t], [1], [await time.latest()])).to.be.revertedWith('not relayer');
    await expect(f.desk.pushPrices([t], [1], [(await time.latest()) + 3600])).to.be.revertedWith('quote from the future');
    expect(await f.desk.quote(t, 10e6)).to.equal(4n * 10n ** 16n);
    await f.tsla.setUiMultiplier(2n * 10n ** 18n); // 1 raw unit now displays as 2 shares
    expect(await f.desk.quote(t, 10e6)).to.equal(2n * 10n ** 16n);
    await f.tsla.setUiMultiplier(10n ** 18n);
    await expect(f.desk.quote(t, 10n ** 15n)).to.not.be.reverted;
    const hugeBuyer = f.payer; await f.token.mint(hugeBuyer.address, 10n ** 12n); await f.token.connect(hugeBuyer).approve(await f.desk.getAddress(), 10n ** 12n);
    await expect(f.desk.connect(hugeBuyer).buy(t, 10n ** 12n, 0, hugeBuyer.address)).to.be.revertedWith('insufficient inventory');
    await time.increase(3600);
    await expect(f.desk.quote(t, 10e6)).to.be.revertedWith('stale price');
  });
  it('agent processes incoming USDG without arbitrary transfer authority', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 3600);
    await f.token.connect(f.payer).transfer(await f.router.accounts(f.owner.address), 100e6);
    await f.router.connect(f.agent).processIncoming(f.owner.address, 100e6, memo);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(70e6);
    await expect(f.router.connect(f.agent).processIncoming(f.owner.address, 1, memo)).to.be.reverted;
  });
  it('owner can recover a deposit without the agent', async () => {
    const f = await fixture(); const account = await ethers.getContractAt('OwnReceiveAccount', await f.router.accounts(f.owner.address));
    await f.token.connect(f.payer).transfer(await account.getAddress(), 5e6);
    await expect(account.connect(f.attacker).recover(await f.token.getAddress(), 5e6)).to.be.revertedWith('not owner');
    await account.connect(f.owner).recover(await f.token.getAddress(), 5e6);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(5e6);
  });
  it('prevents outsiders taking receive-account funds', async () => {
    const f = await fixture(); const account = await ethers.getContractAt('OwnReceiveAccount', await f.router.accounts(f.owner.address));
    await expect(account.connect(f.attacker).route(1)).to.be.revertedWith('not router');
    await expect(f.router.connect(f.attacker).processIncoming(f.owner.address, 1, memo)).to.be.revertedWith('agent denied');
  });
  it('revokes delegation and invalidates it on rule edit', async () => {
    const f = await fixture(); await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 3600);
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [], [], true);
    await expect(f.router.connect(f.agent).processIncoming(f.owner.address, 1, memo)).to.be.revertedWith('agent denied');
    await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 3600);
    await f.router.connect(f.owner).delegate(ethers.ZeroAddress, 0);
    await expect(f.router.connect(f.agent).processIncoming(f.owner.address, 1, memo)).to.be.revertedWith('agent denied');
  });
  it('rejects expired delegation', async () => {
    const f = await fixture(); await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 60);
    await time.increase(61);
    await expect(f.router.connect(f.agent).processIncoming(f.owner.address, 1, memo)).to.be.revertedWith('agent denied');
  });
  it('has no admin compliance gate: anyone can pay an open recipient', async () => {
    const f = await fixture();
    expect(f.router.setCompliance).to.equal(undefined);
    await f.token.mint(f.attacker.address, 5e6); await f.token.connect(f.attacker).approve(await f.router.getAddress(), 5e6);
    await f.router.connect(f.attacker).pay(f.owner.address, 5e6, memo);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(3.5e6);
  });
  it('recipient blocklist rejects a sender and keeps their funds', async () => {
    const f = await fixture();
    await expect(f.router.connect(f.owner).setSender(f.payer.address, 2)).to.emit(f.router, 'SenderStatusChanged').withArgs(f.owner.address, f.payer.address, 2);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1e6, memo)).to.be.revertedWith('policy: sender blocked');
    expect(await f.token.balanceOf(f.payer.address)).to.equal(1000e6);
    await f.router.connect(f.owner).setSender(f.payer.address, 0);
    await f.router.connect(f.payer).pay(f.owner.address, 1e6, memo);
  });
  it('allowlist-only accepts only approved senders and fails closed on unverifiable direct deposits', async () => {
    const f = await fixture();
    await expect(f.router.connect(f.owner).setPolicy(true, false, 0)).to.emit(f.router, 'PolicySaved').withArgs(f.owner.address, true, false, 0);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1e6, memo)).to.be.revertedWith('policy: sender not allowlisted');
    await f.router.connect(f.owner).setSender(f.payer.address, 1);
    await f.router.connect(f.payer).pay(f.owner.address, 1e6, memo);
    const account = await ethers.getContractAt('OwnReceiveAccount', await f.router.accounts(f.owner.address));
    await f.token.connect(f.payer).transfer(await account.getAddress(), 5e6);
    await f.router.connect(f.owner).delegate(f.agent.address, (await time.latest()) + 3600);
    await expect(f.router.connect(f.agent).processIncoming(f.owner.address, 5e6, memo)).to.be.revertedWith('policy: sender unverifiable');
    await expect(f.router.connect(f.owner).processIncoming(f.owner.address, 5e6, memo)).to.be.revertedWith('policy: sender unverifiable');
    expect(await f.token.balanceOf(await account.getAddress())).to.equal(5e6);
    await account.connect(f.owner).recover(await f.token.getAddress(), 5e6);
  });
  it('require-memo rejects payments without a note', async () => {
    const f = await fixture(); await f.router.connect(f.owner).setPolicy(false, true, 0);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1e6, ethers.ZeroHash)).to.be.revertedWith('policy: memo required');
    await f.router.connect(f.payer).pay(f.owner.address, 1e6, memo);
  });
  it('per-sender daily cap limits one sender, not others, and resets next day', async () => {
    const f = await fixture(); await f.router.connect(f.owner).setPolicy(false, false, 50e6);
    await f.router.connect(f.payer).pay(f.owner.address, 40e6, memo);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 20e6, memo)).to.be.revertedWith('policy: sender daily cap');
    await f.token.mint(f.attacker.address, 20e6); await f.token.connect(f.attacker).approve(await f.router.getAddress(), 20e6);
    await f.router.connect(f.attacker).pay(f.owner.address, 20e6, memo);
    await time.increase(86400);
    await f.router.connect(f.payer).pay(f.owner.address, 20e6, memo);
  });
  it('only the recipient controls their policy; invalid sender entries rejected', async () => {
    const f = await fixture();
    await f.router.connect(f.attacker).setPolicy(true, true, 1);
    await f.router.connect(f.attacker).setSender(f.payer.address, 2);
    await f.router.connect(f.payer).pay(f.owner.address, 1e6, memo); // attacker's settings only affect attacker
    await expect(f.router.connect(f.owner).setSender(ethers.ZeroAddress, 1)).to.be.revertedWith('invalid sender status');
    await expect(f.router.connect(f.owner).setSender(f.owner.address, 1)).to.be.revertedWith('invalid sender status');
    await expect(f.router.connect(f.owner).setSender(f.payer.address, 3)).to.be.revertedWith('invalid sender status');
  });
  it('relays signed policy and sender intents (actions 5 and 6)', async () => {
    const f = await fixture(); const coder = ethers.AbiCoder.defaultAbiCoder();
    const p = await sign(f, 5, coder.encode(['bool', 'bool', 'uint128'], [false, true, 0]));
    await f.router.connect(f.attacker).executeSigned(f.owner.address, 5, p.data, p.deadline, p.signature);
    expect((await f.router.policies(f.owner.address)).requireMemo).to.equal(true);
    const q = await sign(f, 6, coder.encode(['address', 'uint8'], [f.payer.address, 2]));
    await f.router.connect(f.attacker).executeSigned(f.owner.address, 6, q.data, q.deadline, q.signature);
    expect(await f.router.senderStatus(f.owner.address, f.payer.address)).to.equal(2);
  });
  it('rejects invalid split and limits', async () => {
    const f = await fixture();
    await expect(f.router.connect(f.owner).saveRule(9000, 2000, 1, 1, [], [], true)).to.be.revertedWith('split over 100%');
    await expect(f.router.connect(f.owner).saveRule(0, 0, 2, 1, [], [], true)).to.be.revertedWith('invalid limits');
  });
  it('rejects zero, oversize and disabled payments', async () => {
    const f = await fixture();
    for (const amount of [0, 101e6]) await expect(f.router.connect(f.payer).pay(f.owner.address, amount, memo)).to.be.revertedWith('payment policy denied');
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [], [], false);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('payment policy denied');
  });
  it('enforces cumulative daily limit, resets next day', async () => {
    const f = await fixture();
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo); await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('daily limit');
    await time.increase(86400);
    await f.router.connect(f.payer).pay(f.owner.address, 1, memo);
  });
  it('withdrawals conserve escrow and cannot exceed balance, regardless of payment policy', async () => {
    const f = await fixture(); await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    await f.router.connect(f.owner).setPolicy(true, true, 1);
    await f.router.connect(f.owner).withdraw(false, 10e6); await f.router.connect(f.owner).withdraw(true, 20e6);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(100e6);
    expect(await f.token.balanceOf(await f.router.getAddress())).to.equal(0);
    await expect(f.router.connect(f.owner).withdraw(false, 1)).to.be.reverted;
    await expect(f.router.connect(f.attacker).withdraw(true, 1)).to.be.reverted;
  });
  it('rounding preserves all funds for tiny payments', async () => {
    const f = await fixture(); await f.router.connect(f.payer).pay(f.owner.address, 7, memo);
    expect(await f.token.balanceOf(f.owner.address)).to.equal(6);
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(1);
  });
  it('out-of-inventory purchase queues instead of failing the payment', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, [await f.tsla.getAddress()], [10000], true);
    await f.desk.withdraw(await f.tsla.getAddress(), 1000n * 10n ** 18n); // desk empty
    await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.emit(f.router, 'OwnershipQueued');
    expect(await f.router.savings(f.owner.address)).to.equal(10e6);
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(20e6);
  });
  it('sponsor executes signed intent; replay, changed data and cross-chain signatures fail', async () => {
    const f = await fixture(); const data = ethers.AbiCoder.defaultAbiCoder().encode(['address', 'uint64'], [f.agent.address, (await time.latest()) + 3600]);
    const s = await sign(f, 2, data);
    await f.router.connect(f.attacker).executeSigned(f.owner.address, 2, data, s.deadline, s.signature);
    expect((await f.router.delegations(f.owner.address)).agent).to.equal(f.agent.address);
    await expect(f.router.executeSigned(f.owner.address, 2, data, s.deadline, s.signature)).to.be.revertedWith('wrong signer');
    const wrongChain = await sign(f, 2, data, { chainId: 8453 });
    await expect(f.router.executeSigned(f.owner.address, 2, data, wrongChain.deadline, wrongChain.signature)).to.be.revertedWith('wrong signer');
    const good = await sign(f, 2, data);
    await expect(f.router.executeSigned(f.owner.address, 2, '0x00', good.deadline, good.signature)).to.be.revertedWith('wrong signer');
  });
  it('rejects expired intent, invalid signature and unknown action without consuming nonce', async () => {
    const f = await fixture(); const s = await sign(f, 9);
    await expect(f.router.executeSigned(f.owner.address, 9, '0x', s.deadline, s.signature)).to.be.revertedWith('unknown action');
    expect(await f.router.nonces(f.owner.address)).to.equal(0);
    await expect(f.router.executeSigned(f.owner.address, 9, '0x', s.deadline, '0x')).to.be.revertedWith('invalid signature');
    await time.increase(601);
    await expect(f.router.executeSigned(f.owner.address, 9, '0x', s.deadline, s.signature)).to.be.revertedWith('intent expired');
  });
});
