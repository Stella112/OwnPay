// Real-network eth_call only: no transaction, funds or persistent deployment.
const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const { verify, USDG } = require('./verify-robinhood');
async function main() {
  const network = await verify();
  const factory = await ethers.getContractFactory('OwnRules');
  const request = await factory.getDeployTransaction(USDG);
  const runtime = await ethers.provider.call({ data: request.data, from: network.deployer, gasLimit: 8000000n });
  if (!runtime || runtime === '0x') throw new Error('Constructor eth_call returned no runtime bytecode');
  const evidence = { checkedAt: new Date().toISOString(), chainId: 46630,
    method: 'eth_call contract-creation simulation', status: 'simulation-only',
    runtimeBytes: (runtime.length - 2) / 2, runtimeHash: ethers.keccak256(runtime),
    disclaimer: 'No transaction sent, no deployed address and no persistent contract state. Not deployment/demo evidence.' };
  fs.writeFileSync(path.join(__dirname, '../../docs/evidence/robinhood-constructor.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error.shortMessage || error.message); process.exitCode = 1; });
