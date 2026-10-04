// Dedicated Robinhood testnet agent. No database polling and no Base transactions.
// Default observe-only; execute mode must be explicitly configured.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, erc20Abi, parseAbi, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decideIncoming } from './robinhood-agent-policy.mjs';
const rpc = process.env.ROBINHOOD_TESTNET_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
const chain = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const usdg = '0x7E955252E15c84f5768B83c41a71F9eba181802F';
const router = process.env.ROBINHOOD_OWNRULES_ADDRESS;
if (!/^0x[0-9a-fA-F]{40}$/.test(router || '')) throw new Error('Configure the deployed ROBINHOOD_OWNRULES_ADDRESS.');
const abi = parseAbi([
  'event AccountCreated(address indexed owner,address indexed account)',
  'function rules(address) view returns(uint16,uint16,uint128,uint128,address,uint128,uint64,bool)',
  'function delegations(address) view returns(address,uint64,uint64)',
  'function policies(address) view returns(bool,bool,uint128)',
  'function spentDay(address) view returns(uint256)',
  'function spentToday(address) view returns(uint256)',
  'function usdg() view returns(address)',
  'function processIncoming(address owner,uint256 amount,bytes32 metadataCommitment)',
]);
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 15000, retryCount: 1 }) });
const key = process.env.ROBINHOOD_AGENT_PRIVATE_KEY;
const signer = key ? privateKeyToAccount(key) : null;
const execute = process.env.ROBINHOOD_AGENT_MODE === 'execute';
if (execute && !signer) throw new Error('Execute mode requires a dedicated testnet agent signer.');
if (signer && process.env.ROBINHOOD_AGENT_ADDRESS && signer.address.toLowerCase() !== process.env.ROBINHOOD_AGENT_ADDRESS.toLowerCase()) throw new Error('Configured agent address does not match the dedicated signer.');
const wallet = signer ? createWalletClient({ account: signer, chain, transport: http(rpc) }) : null;
if (await client.getChainId() !== 46630 || !await client.getCode({ address: router }) || (await client.readContract({ address: router, abi, functionName: 'usdg' })).toLowerCase() !== usdg.toLowerCase()) throw new Error('Testnet/contract/token verification failed.');
const stateFile = path.resolve(process.env.ROBINHOOD_AGENT_STATE_FILE || '.robinhood-agent/state.json');
const healthFile = path.resolve(process.env.ROBINHOOD_AGENT_HEALTH_FILE || path.join(path.dirname(stateFile), 'health.json'));
await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
await fs.mkdir(path.dirname(healthFile), { recursive: true, mode: 0o700 });
let state;
try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch (e) {
  if (e.code !== 'ENOENT') throw e;
  state = { chainId: 46630, router: router.toLowerCase(), nextBlock: process.env.ROBINHOOD_DEPLOYMENT_BLOCK || '0', accounts: {}, pending: [] };
}
if (state.chainId !== 46630 || state.router !== router.toLowerCase()) throw new Error('Checkpoint belongs to another deployment. Use a new state path.');
async function persist() { const tmp = `${stateFile}.tmp`; await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 }); await fs.rename(tmp, stateFile); }
const mode = execute ? 'execute' : 'observe';
const startedAt = new Date().toISOString();
let lastActionAt = null;
let lastCycleOk = null;
let lastErrorAt = null;
async function writeHealth() {
  const health = {
    chainId: 46630,
    router: router.toLowerCase(),
    mode,
    startedAt,
    updatedAt: new Date().toISOString(),
    lastActionAt,
    lastCycleOk,
    lastErrorAt,
    trackedAccounts: Object.keys(state.accounts).length,
    pendingAccounts: state.pending.length,
  };
  const tmp = `${healthFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(health), { mode: 0o600 });
  await fs.rename(tmp, healthFile);
}
console.log(JSON.stringify({ event: 'agent_started', chainId: 46630, mode, agent: signer?.address || null, router }));
const transfer = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])[0];
let stop = false; process.on('SIGINT', () => { stop = true; }); process.on('SIGTERM', () => { stop = true; });
while (!stop) {
  let behind = false;
  try {
    const latest = await client.getBlockNumber(); const safe = latest > 2n ? latest - 2n : 0n;
    let from = BigInt(state.nextBlock);
    // Robinhood testnet produces ~7 blocks/s; a small fixed chunk can never keep up.
    // RPC getLogs handles 50k-block spans (~0.5s), so scan in large chunks and skip
    // the sleep while behind (see `behind` below) to catch up quickly.
    const chunk = BigInt(Math.max(100, Number(process.env.ROBINHOOD_AGENT_BLOCK_CHUNK || 10000)));
    if (from <= safe) {
      const end = from + chunk - 1n < safe ? from + chunk - 1n : safe;
      behind = end < safe;
      const accounts = await client.getContractEvents({ address: router, abi, eventName: 'AccountCreated', fromBlock: from, toBlock: end });
      for (const log of accounts) state.accounts[log.args.account.toLowerCase()] = log.args.owner;
      // Global token Transfer logs (bounded), no unbounded recipient-array query.
      const transfers = await client.getLogs({ address: usdg, event: transfer, fromBlock: from, toBlock: end });
      const pending = new Set(state.pending);
      for (const log of transfers) if (state.accounts[log.args.to?.toLowerCase()]) pending.add(log.args.to.toLowerCase());
      state.pending = [...pending]; state.nextBlock = String(end + 1n); await persist();
    }
    const latestBlock = await client.getBlock({ blockNumber: latest });
    const today = latestBlock.timestamp / 86400n;
    for (const account of [...state.pending]) {
      const owner = state.accounts[account];
      const read = functionName => client.readContract({ address: router, abi, functionName, args: [owner] });
      const [balance, rule, delegation, policy, day, spent] = await Promise.all([
        client.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
        read('rules'), read('delegations'), read('policies'), read('spentDay'), read('spentToday'),
      ]);
      if (!balance) { state.pending = state.pending.filter(a => a !== account); await persist(); continue; }
      // Allowlist-only recipients reject direct deposits (sender unverifiable): skip, never spin on a revert.
      if (policy[0]) { if (!state.deferred?.[account] || state.deferred[account].reason !== 'allowlist_only_rejects_direct_deposits') { state.deferred ||= {}; state.deferred[account] = { account, owner, rawUsdg: String(balance), reason: 'allowlist_only_rejects_direct_deposits' }; await persist(); } continue; }
      if (!rule[7] || delegation[0] === zeroAddress || delegation[1] < latestBlock.timestamp || delegation[2] !== rule[6]) continue;
      if (signer && delegation[0].toLowerCase() !== signer.address.toLowerCase()) continue;
      const decision = decideIncoming({ balance, maxPayment: rule[2], dailyLimit: rule[3], spentDay: day, spentToday: spent, today });
      if (decision.action === 'ignore') { state.pending = state.pending.filter(a => a !== account); await persist(); continue; }
      if (decision.action === 'defer') {
        const deferred = { account, owner, rawUsdg: String(balance), reason: decision.reason };
        if (JSON.stringify(state.deferred?.[account]) !== JSON.stringify(deferred)) {
          state.deferred ||= {};
          state.deferred[account] = deferred;
          await persist();
          console.log(JSON.stringify({ event: 'income_deferred_by_saved_limit', ...deferred }));
        }
        continue;
      }
      const amount = decision.amount;
      if (!execute) { lastActionAt = new Date().toISOString(); console.log(JSON.stringify({ event: 'eligible_income_observed', owner, rawUsdg: String(amount) })); continue; }
      const simulation = await client.simulateContract({ account: signer, address: router, abi, functionName: 'processIncoming', args: [owner, amount, `0x${'00'.repeat(32)}`] });
      const hash = await wallet.writeContract(simulation.request); const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error(`Agent reverted: ${hash}`);
      lastActionAt = new Date().toISOString();
      console.log(JSON.stringify({ event: 'income_split_confirmed', owner, rawUsdg: String(amount), hash, block: String(receipt.blockNumber) }));
      state.deferred && delete state.deferred[account];
      await persist();
    }
    lastCycleOk = true;
  } catch (e) { lastCycleOk = false; lastErrorAt = new Date().toISOString(); console.error(JSON.stringify({ event: 'agent_cycle_failed', error: e.shortMessage || e.message })); }
  try { await writeHealth(); } catch (e) { console.error(JSON.stringify({ event: 'agent_health_write_failed', error: e.message })); }
  if (process.env.ROBINHOOD_AGENT_ONCE === 'true') break;
  if (behind) continue; // catching up on history: no sleep
  await new Promise(r => setTimeout(r, Math.max(15000, Number(process.env.ROBINHOOD_AGENT_INTERVAL_MS || 60000))));
}
