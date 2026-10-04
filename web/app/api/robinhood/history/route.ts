import { decodeEventLog, isAddress, parseAbi, zeroAddress, type Address, type Hex, type Log } from 'viem';
import { ownRulesAbi } from '@/lib/robinhood';
import { RH_STOCK_VESTING, RH_STOCK_VESTING_FROM_BLOCK } from '@/lib/robinhood-stocks';
import { rhPublic, verifyRhDeployment } from '@/lib/robinhood-server';
export const runtime = 'nodejs';

// Full onchain history for one owner across OwnRules and the stock escrow.
// Each contract's logs are fetched once per chunk and decoded/filtered here, so the
// whole deployment range is covered (the status API only ever saw ~1500 blocks,
// i.e. a few minutes on a ~7 blocks/s chain).
const CHUNK = 50_000n;
const stockAbi = parseAbi([
  'event GrantCreated(uint256 indexed id, address indexed token, address indexed to, address from, uint256 total, uint64 start, uint64 cliff, uint64 duration, bool revocable, bytes32 memo)',
  'event Released(uint256 indexed id, address indexed to, uint256 rawAmount)',
  'event Revoked(uint256 indexed id, address indexed from, uint256 refundedRaw)',
  'event MemoTransfer(address indexed token, address indexed from, address indexed to, uint256 rawAmount, bytes32 memo)',
]);
type Item = { kind: string; block: string; tx: Hex; logIndex: number; timestamp?: number; actor?: 'agent' | 'owner' | 'other'; data: Record<string, unknown> };
const cache = new Map<string, { at: number; items: Item[] }>();

async function logsInRange(address: Address, from: bigint, to: bigint) {
  const out: Log[] = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = start + CHUNK - 1n < to ? start + CHUNK - 1n : to;
    out.push(...await rhPublic.getLogs({ address, fromBlock: start, toBlock: end }));
  }
  return out;
}
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
const plain = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v]));

export async function GET(request: Request) {
  try {
    const owner = new URL(request.url).searchParams.get('owner');
    if (!owner || !isAddress(owner)) return Response.json({ error: 'owner query parameter required' }, { status: 400 });
    const hit = cache.get(owner.toLowerCase());
    if (hit && Date.now() - hit.at < 15_000) return Response.json({ items: hit.items, cached: true });

    const config = await verifyRhDeployment();
    const agent = process.env.ROBINHOOD_AGENT_ADDRESS || '';
    const latest = await rhPublic.getBlockNumber();
    const [routerLogs, stockLogs] = await Promise.all([
      logsInRange(config.router, config.startBlock, latest),
      logsInRange(RH_STOCK_VESTING, RH_STOCK_VESTING_FROM_BLOCK, latest),
    ]);

    const items: Item[] = [];
    const push = (l: Log, kind: string, data: Record<string, unknown>) => items.push({ kind, block: String(l.blockNumber), tx: l.transactionHash!, logIndex: l.logIndex ?? 0, data: plain(data) });
    for (const l of routerLogs) {
      let d; try { d = decodeEventLog({ abi: ownRulesAbi, data: l.data, topics: l.topics }); } catch { continue; }
      const a = d.args as Record<string, unknown>;
      if (d.eventName === 'PaymentReceipt') {
        if (same(a.owner, owner)) push(l, a.payer === zeroAddress ? 'income_split' : 'payment_received', a);
        else if (same(a.payer, owner)) push(l, 'payment_sent', a);
      } else if ('owner' in a && same(a.owner, owner)) {
        push(l, ({ Withdrawal: 'withdrawal', RuleSaved: 'rule_saved', AgentChanged: 'agent_changed', PolicySaved: 'policy_saved', SenderStatusChanged: 'sender_status', AccountCreated: 'account_created' } as Record<string, string>)[d.eventName] || d.eventName, a);
      }
    }
    for (const l of stockLogs) {
      let d; try { d = decodeEventLog({ abi: stockAbi, data: l.data, topics: l.topics }); } catch { continue; }
      const a = d.args as Record<string, unknown>;
      if (d.eventName === 'GrantCreated') { if (same(a.to, owner)) push(l, 'stock_grant_received', a); else if (same(a.from, owner)) push(l, 'stock_grant_sent', a); }
      else if (d.eventName === 'Released' && same(a.to, owner)) push(l, 'stock_claimed', a);
      else if (d.eventName === 'Revoked' && same(a.from, owner)) push(l, 'stock_revoked', a);
      else if (d.eventName === 'MemoTransfer') { if (same(a.to, owner)) push(l, 'stock_tip_received', a); else if (same(a.from, owner)) push(l, 'stock_tip_sent', a); }
    }

    items.sort((x, y) => Number(BigInt(y.block) - BigInt(x.block)) || y.logIndex - x.logIndex);
    const recent = items.slice(0, 200);
    // Timestamps and "who did it" for the shown items only (bounded RPC work).
    const blocks = [...new Set(recent.map((i) => i.block))];
    const times = new Map(await Promise.all(blocks.map(async (b) => [b, Number((await rhPublic.getBlock({ blockNumber: BigInt(b) })).timestamp)] as const)));
    await Promise.all(recent.filter((i) => i.kind === 'income_split').map(async (i) => {
      const tx = await rhPublic.getTransaction({ hash: i.tx });
      i.actor = agent && same(tx.from, agent) ? 'agent' : same(tx.from, owner) ? 'owner' : 'other';
    }));
    for (const i of recent) i.timestamp = times.get(i.block);
    cache.set(owner.toLowerCase(), { at: Date.now(), items: recent });
    return Response.json({ items: recent, total: items.length, agent: agent || null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'History unavailable' }, { status: 503 });
  }
}
