const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');
const USDG = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
async function verify() {
  const chain = (await ethers.provider.getNetwork()).chainId;
  if (chain !== 46630n) throw new Error(`Wrong network ${chain}; require 46630`);
  const code = await ethers.provider.getCode(USDG);
  if (code === '0x') throw new Error('Official USDG has no bytecode');
  const token = new ethers.Contract(USDG, ['function decimals() view returns(uint8)', 'function symbol() view returns(string)', 'function balanceOf(address) view returns(uint256)'], ethers.provider);
  if (await token.decimals() !== 6n || await token.symbol() !== 'USDG') throw new Error('USDG metadata mismatch');
  const [deployer] = await ethers.getSigners();
  const report = { checkedAt: new Date().toISOString(), chainId: Number(chain), rpc: 'https://rpc.testnet.chain.robinhood.com', usdg: USDG, decimals: 6, symbol: 'USDG', bytecodeHash: ethers.keccak256(code), deployer: deployer?.address,
    eth: deployer ? ethers.formatEther(await ethers.provider.getBalance(deployer.address)) : null,
    usdgBalance: deployer ? String(await token.balanceOf(deployer.address)) : null };
  fs.mkdirSync(path.join(__dirname, '../../docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../../docs/evidence/robinhood-network.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2)); return report;
}
if (require.main === module) verify().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { verify, USDG };
