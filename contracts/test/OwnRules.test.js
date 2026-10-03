const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

async function fixture() {
  const [admin, owner, payer, agent, attacker] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory('MockB20')).deploy('Test USDG', 'USDG', 6);
  const router = await (await ethers.getContractFactory('OwnRules')).deploy(await token.getAddress());
  const adapter = await (await ethers.getContractFactory('DemoOwnershipAdapter')).deploy(await router.getAddress(), await token.getAddress());
  await router.setAdapter(await adapter.getAddress(), true);
  const expiry = (await time.latest()) + 86400;
  for (const who of [owner, payer]) await router.setCompliance(who.address, expiry, false);
  await router.connect(owner).createAccount();
  await router.connect(owner).saveRule(1000, 2000, 100e6, 200e6, ethers.ZeroAddress, 0, true);
  await token.mint(payer.address, 1000e6);
  await token.connect(payer).approve(await router.getAddress(), 1000e6);
  return { admin, owner, payer, agent, attacker, token, router, adapter };
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
    await relay(1, coder.encode(['uint16','uint16','uint128','uint128','address','uint128','bool'], [1000,2000,100e6,200e6,ethers.ZeroAddress,0,true]));
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
    const other = await sign(f, 9, '0x', { verifyingContract: await f.adapter.getAddress() });
    await expect(f.router.executeSigned(f.owner.address, 9, '0x', other.deadline, other.signature)).to.be.revertedWith('wrong signer');
    expect(await f.router.nonces(f.owner.address)).to.equal(0);
  });
  it('blocks reentrancy and dishonest adapters without losing any payer funds', async () => {
    for (const reenter of [true, false]) {
      const f = await fixture();
      const evil = await (await ethers.getContractFactory('AdversarialRuleAdapter')).deploy(await f.token.getAddress(), await f.router.getAddress(), reenter);
      await f.router.setAdapter(await evil.getAddress(), true);
      await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, await evil.getAddress(), 1e6, true);
      await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.be.revertedWith(reenter ? 'reentrant' : 'ownership output shortfall');
      expect(await f.token.balanceOf(f.payer.address)).to.equal(1000e6);
      expect(await f.router.savings(f.owner.address)).to.equal(0);
      expect(await f.router.receiptCount()).to.equal(0);
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
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, await f.adapter.getAddress(), 10n ** 18n, true);
    await f.router.connect(f.owner).setVestingSeconds(100);
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    const vesting = await ethers.getContractAt('OwnAssetVesting', await f.router.vesting());
    const asset = await ethers.getContractAt('DemoOwnershipUnits', await f.adapter.asset());
    expect(await vesting.grantCount(f.owner.address)).to.equal(1);
    expect(await vesting.grantId(f.owner.address, 0)).to.equal(0);
    expect(await asset.balanceOf(f.owner.address)).to.equal(0);
    expect(await asset.balanceOf(await vesting.getAddress())).to.equal(20n * 10n ** 18n);
    await expect(vesting.connect(f.attacker).credit(f.attacker.address, await asset.getAddress(), 1, 100)).to.be.revertedWith('invalid credit');
    await time.increase(50);
    await vesting.connect(f.attacker).claim(0);
    expect(await asset.balanceOf(f.attacker.address)).to.equal(0);
    expect(await asset.balanceOf(f.owner.address)).to.be.greaterThan(0);
    await time.increase(100);
    await vesting.claim(0);
    expect(await asset.balanceOf(f.owner.address)).to.equal(20n * 10n ** 18n);
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
  it('buys actual explicitly DEMO units through an approved adapter', async () => {
    const f = await fixture();
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, await f.adapter.getAddress(), 10n ** 18n, true);
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    const asset = await ethers.getContractAt('DemoOwnershipUnits', await f.adapter.asset());
    expect(await asset.balanceOf(f.owner.address)).to.equal(20n * 10n ** 18n);
    expect(await f.token.balanceOf(f.admin.address)).to.equal(20e6);
    expect(await f.router.ownershipReserve(f.owner.address)).to.equal(0);
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
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, ethers.ZeroAddress, 0, true);
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
  it('fails closed for unknown or blocked payer and blocked recipient', async () => {
    const f = await fixture();
    await expect(f.router.connect(f.attacker).pay(f.owner.address, 1, memo)).to.be.revertedWith('compliance denied');
    await f.router.setCompliance(f.payer.address, (await time.latest()) + 3600, true);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('compliance denied');
    await f.router.setCompliance(f.payer.address, (await time.latest()) + 3600, false);
    await f.router.setCompliance(f.owner.address, (await time.latest()) + 3600, true);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('compliance denied');
    expect(await f.token.balanceOf(f.payer.address)).to.equal(1000e6);
  });
  it('rejects expired compliance and unauthorized policy edits', async () => {
    const f = await fixture(); await time.increase(86401);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('compliance denied');
    await expect(f.router.connect(f.attacker).setCompliance(f.attacker.address, 9999999999, false)).to.be.revertedWith('not policy admin');
  });
  it('rejects invalid split, limits and unapproved adapter', async () => {
    const f = await fixture();
    await expect(f.router.connect(f.owner).saveRule(9000, 2000, 1, 1, ethers.ZeroAddress, 0, true)).to.be.revertedWith('split over 100%');
    await expect(f.router.connect(f.owner).saveRule(0, 0, 2, 1, ethers.ZeroAddress, 0, true)).to.be.revertedWith('invalid limits');
    await expect(f.router.connect(f.owner).saveRule(0, 2000, 1, 1, f.attacker.address, 1, true)).to.be.revertedWith('unapproved adapter/price');
  });
  it('rejects zero, oversize and disabled payments', async () => {
    const f = await fixture();
    for (const amount of [0, 101e6]) await expect(f.router.connect(f.payer).pay(f.owner.address, amount, memo)).to.be.revertedWith('payment policy denied');
    await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, ethers.ZeroAddress, 0, false);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('payment policy denied');
  });
  it('enforces cumulative daily limit, resets next day', async () => {
    const f = await fixture();
    await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo); await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 1, memo)).to.be.revertedWith('daily limit');
    await time.increase(86400);
    for (const who of [f.owner, f.payer]) await f.router.setCompliance(who.address, (await time.latest()) + 86400, false);
    await f.router.connect(f.payer).pay(f.owner.address, 1, memo);
  });
  it('withdrawals conserve escrow and cannot exceed balance, even with revoked compliance', async () => {
    const f = await fixture(); await f.router.connect(f.payer).pay(f.owner.address, 100e6, memo);
    await f.router.setCompliance(f.owner.address, 0, true);
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
  it('adapter disable and minimum output cause atomic rollback', async () => {
    const f = await fixture(); await f.router.connect(f.owner).saveRule(1000, 2000, 100e6, 200e6, await f.adapter.getAddress(), 2n * 10n ** 18n, true);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.be.revertedWith('minimum output');
    expect(await f.router.savings(f.owner.address)).to.equal(0);
    await f.router.setAdapter(await f.adapter.getAddress(), false);
    await expect(f.router.connect(f.payer).pay(f.owner.address, 100e6, memo)).to.be.revertedWith('adapter disabled');
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
