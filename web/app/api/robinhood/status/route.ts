import { readFile } from 'node:fs/promises';
import { erc20Abi, isAddress, zeroAddress } from 'viem';
import { ownRulesAbi, stockDeskAbi, TEST_USDG } from '@/lib/robinhood';
import { RH_STOCKS } from '@/lib/robinhood-stocks';
import { rhVestingAbi } from '@/lib/robinhood-vesting';
import { rhPublic, verifyRhDeployment } from '@/lib/robinhood-server';
export const runtime = 'nodejs';

async function readAgentService(router: string) {
  const path = process.env.ROBINHOOD_AGENT_HEALTH_FILE;
  if (!path) return { state: 'not-reporting', mode: null, updatedAt: null, lastActionAt: null, lastCycleOk: null, trackedAccounts: 0, pendingAccounts: 0 };
  try {
    const health = JSON.parse(await readFile(path, 'utf8'));
    const updatedMs = typeof health.updatedAt === 'string' ? Date.parse(health.updatedAt) : NaN;
    if (health.chainId !== 46630 || typeof health.router !== 'string' || health.router.toLowerCase() !== router.toLowerCase() || !Number.isFinite(updatedMs)) {
      return { state: 'not-reporting', mode: null, updatedAt: null, lastActionAt: null, lastCycleOk: null, trackedAccounts: 0, pendingAccounts: 0 };
    }
    const age = Date.now() - updatedMs;
    const state = age > 180_000 || age < -60_000 ? 'stale' : health.lastCycleOk === false ? 'degraded' : 'online';
    return {
      state,
      mode: health.mode === 'execute' || health.mode === 'observe' ? health.mode : null,
      updatedAt: new Date(updatedMs).toISOString(),
      lastActionAt: typeof health.lastActionAt === 'string' ? health.lastActionAt : null,
      lastCycleOk: typeof health.lastCycleOk === 'boolean' ? health.lastCycleOk : null,
      trackedAccounts: Number.isSafeInteger(health.trackedAccounts) && health.trackedAccounts >= 0 ? health.trackedAccounts : 0,
      pendingAccounts: Number.isSafeInteger(health.pendingAccounts) && health.pendingAccounts >= 0 ? health.pendingAccounts : 0,
    };
  } catch {
    return { state: 'not-reporting', mode: null, updatedAt: null, lastActionAt: null, lastCycleOk: null, trackedAccounts: 0, pendingAccounts: 0 };
  }
}

export async function GET(request: Request) {
  try {
    const config = await verifyRhDeployment();
    const agentService = await readAgentService(config.router);
    const value = new URL(request.url).searchParams.get('owner');
    const owners = (process.env.ROBINHOOD_SPONSORED_OWNERS || '').toLowerCase().split(',');
    const base = { chainId: 46630, router: config.router, demoAdapter: config.demoAdapter, demoAsset: config.demoAsset,
      agent: process.env.ROBINHOOD_AGENT_ADDRESS || null, relayEnabled: !!process.env.ROBINHOOD_RELAY_PRIVATE_KEY && !!value && owners.includes(value.toLowerCase()),
      agentService, sponsorship: 'Custom signed-intent relay; not an ERC-4337 paymaster', stockTokens: 'No official testnet deployments found in registry', complianceMode: 'Recipient-programmed policy (allowlist, blocklist, required memo, per-sender daily cap); no admin; not KYC' };
    const deskAddress = process.env.ROBINHOOD_STOCK_DESK;
    const desk = deskAddress && isAddress(deskAddress) ? {
      address: deskAddress,
      maxAge: String(await rhPublic.readContract({ address: deskAddress, abi: stockDeskAbi, functionName: 'maxAge' })),
      prices: await Promise.all(RH_STOCKS.map(async (t) => {
        const [usdPerShare, quoteTime] = await rhPublic.readContract({ address: deskAddress, abi: stockDeskAbi, functionName: 'prices', args: [t.address] });
        const fresh = await rhPublic.readContract({ address: deskAddress, abi: stockDeskAbi, functionName: 'isFresh', args: [t.address] });
        return { asset: t.address, usdPerShare: String(usdPerShare), quoteTime: String(quoteTime), fresh };
      })),
    } : null;
    if (!value || !isAddress(value)) return Response.json({ ...base, desk });
    const owner = value;
    const read = { address: config.router, abi: ownRulesAbi, args: [owner] } as const;
    const [account, rule, savings, reserve, delegation, policy, nonce, balance] = await Promise.all([
      rhPublic.readContract({ ...read, functionName: 'accounts' }), rhPublic.readContract({ ...read, functionName: 'rules' }),
      rhPublic.readContract({ ...read, functionName: 'savings' }), rhPublic.readContract({ ...read, functionName: 'ownershipReserve' }),
      rhPublic.readContract({ ...read, functionName: 'delegations' }), rhPublic.readContract({ ...read, functionName: 'policies' }),
      rhPublic.readContract({ ...read, functionName: 'nonces' }),
      rhPublic.readContract({ address: TEST_USDG, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }),
    ]);
    const incoming = account === zeroAddress ? 0n : await rhPublic.readContract({ address: TEST_USDG, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
    const assetBalance = config.demoAsset && isAddress(config.demoAsset) ? await rhPublic.readContract({ address: config.demoAsset, abi: erc20Abi, functionName: 'balanceOf', args: [owner] }) : null;
    const vesting = await rhPublic.readContract({ address: config.router, abi: ownRulesAbi, functionName: 'vesting' });
    const vestingSeconds = await rhPublic.readContract({ ...read, functionName: 'vestingSeconds' });
    const portfolio = (await rhPublic.readContract({ ...read, functionName: 'portfolioOf' })).map((p) => ({ asset: p.asset, weightBps: Number(p.weightBps) }));
    const grantCount = await rhPublic.readContract({ address: vesting, abi: rhVestingAbi, functionName: 'grantCount', args: [owner] });
    const grants = await Promise.all(Array.from({ length: Number(grantCount < 25n ? grantCount : 25n) }, async (_, i) => {
      const id = await rhPublic.readContract({ address: vesting, abi: rhVestingAbi, functionName: 'grantId', args: [owner, grantCount - 1n - BigInt(i)] });
      const [grant, claimable] = await Promise.all([
        rhPublic.readContract({ address: vesting, abi: rhVestingAbi, functionName: 'grants', args: [id] }),
        rhPublic.readContract({ address: vesting, abi: rhVestingAbi, functionName: 'claimable', args: [id] }),
      ]); return { id, asset: grant[1], total: grant[2], released: grant[3], start: grant[4], end: grant[4] + grant[5], claimable };
    }));
    return new Response(JSON.stringify({ ...base, account, rule, savings, reserve, delegation, policy, nonce, balance, incoming, assetBalance, vesting, vestingSeconds, grants, grantCount, portfolio, desk }, (_, v) => typeof v === 'bigint' ? String(v) : v), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Testnet unavailable' }, { status: 503 }); }
}
