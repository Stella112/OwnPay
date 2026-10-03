const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const { verify, USDG } = require('./verify-robinhood');
async function main() {
  const evidence = await verify();
  if (!evidence.eth || Number(evidence.eth) === 0) throw new Error('BLOCKED: deployer needs Robinhood TESTNET ETH. No deployment sent.');
  const [deployer] = await ethers.getSigners();
  const directory = path.join(__dirname, '../deployments');
  fs.mkdirSync(directory, { recursive: true });
  const checkpointPath = path.join(directory, 'robinhood-testnet.pending.json');
  const checkpoint = fs.existsSync(checkpointPath) ? JSON.parse(fs.readFileSync(checkpointPath)) : { chainId: 46630, deployer: deployer.address };
  if (checkpoint.chainId !== 46630 || checkpoint.deployer.toLowerCase() !== deployer.address.toLowerCase()) throw new Error('Deployment checkpoint belongs to a different chain/deployer');
  const save = () => fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2) + '\n');
  let router;
  if (checkpoint.ownRules) {
    if (await ethers.provider.getCode(checkpoint.ownRules) === '0x') throw new Error('Checkpoint router has no bytecode');
    router = await ethers.getContractAt('OwnRules', checkpoint.ownRules);
    if ((await router.usdg()).toLowerCase() !== USDG.toLowerCase() || (await router.policyAdmin()).toLowerCase() !== deployer.address.toLowerCase()) throw new Error('Checkpoint router configuration mismatch');
  } else {
    router = await (await ethers.getContractFactory('OwnRules')).deploy(USDG); await router.waitForDeployment();
    checkpoint.ownRules = await router.getAddress(); checkpoint.routerTx = router.deploymentTransaction().hash;
    checkpoint.deploymentBlock = (await router.deploymentTransaction().wait()).blockNumber; save();
  }
  let demo;
  if (checkpoint.demoAdapter) {
    if (await ethers.provider.getCode(checkpoint.demoAdapter) === '0x') throw new Error('Checkpoint adapter has no bytecode');
    demo = await ethers.getContractAt('DemoOwnershipAdapter', checkpoint.demoAdapter);
    if ((await demo.router()).toLowerCase() !== checkpoint.ownRules.toLowerCase() || (await demo.usdg()).toLowerCase() !== USDG.toLowerCase()) throw new Error('Checkpoint adapter configuration mismatch');
  } else {
    demo = await (await ethers.getContractFactory('DemoOwnershipAdapter')).deploy(await router.getAddress(), USDG); await demo.waitForDeployment();
    checkpoint.demoAdapter = await demo.getAddress(); checkpoint.adapterTx = demo.deploymentTransaction().hash; save();
  }
  const allowed = await router.allowedAdapters(await demo.getAddress());
  if (!allowed) { const receipt = await (await router.setAdapter(await demo.getAddress(), true)).wait(); checkpoint.adapterApprovalTx = receipt.hash; save(); }
  const manifest = { chainId: 46630, usdg: USDG, ownRules: await router.getAddress(), vesting: await router.vesting(), demoAdapter: await demo.getAddress(), demoAsset: await demo.asset(), deployedAt: new Date().toISOString(), deploymentBlock: checkpoint.deploymentBlock,
    deployer: deployer.address, transactions: { ownRules: checkpoint.routerTx, demoAdapter: checkpoint.adapterTx, adapterApproval: checkpoint.adapterApprovalTx }, demoAssetDisclaimer: 'DEMO-OWN has no value; not a Robinhood Stock Token or real equity.' };
  for (const address of [manifest.ownRules, manifest.vesting, manifest.demoAdapter, manifest.demoAsset]) if (await ethers.provider.getCode(address) === '0x') throw new Error(`Missing deployment code ${address}`);
  fs.mkdirSync(path.join(__dirname, '../deployments'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../deployments/robinhood-testnet.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
