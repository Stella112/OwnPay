"use client";

import { parseAbiItem, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { BASESCAN_ADDRESS, BASESCAN_TX } from "@/lib/explorer";
import { STOCK_VESTING_ADDRESS, erc20Abi, stockVestingAbi } from "@/lib/contracts";
import { formatDate, formatUiAmount } from "@/lib/format";
import { getDecimals, rawToUi } from "@/lib/b20";
import { SUPPORTED_TOKENS, tokenByAddress } from "@/lib/tokens";
import { BASE_USDC_ADDRESS } from "@/lib/stablecoins";
import { EXPECTED_CHAIN_ID } from "@/lib/wagmi";
import { WalletAddressCopy } from "@/components/WalletAddressCopy";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const memoTransferEvent = parseAbiItem("event MemoTransfer(address indexed from, address indexed to, uint256 value, bytes32 memo)");
const vestingMemoEvent = parseAbiItem("event MemoTransfer(address indexed token, address indexed from, address indexed to, uint256 rawAmount, bytes32 memo)");
const grantCreatedEvent = parseAbiItem("event GrantCreated(uint256 indexed id, address indexed token, address indexed to, address from, uint256 total, uint64 start, uint64 cliff, uint64 duration, bool revocable, bytes32 memo)");
const releasedEvent = parseAbiItem("event Released(uint256 indexed id, address indexed to, uint256 rawAmount)");
const revokedEvent = parseAbiItem("event Revoked(uint256 indexed id, address indexed from, uint256 refundedRaw)");

type PortfolioLog = {
  address?: Address;
  args?: Record<string, unknown>;
  blockNumber?: bigint;
  transactionHash?: Hex;
};

type Holding = {
  symbol: string;
  name: string;
  decimals: number;
  ui: bigint;
};

type GrantPosition = {
  id: bigint;
  symbol: string;
  decimals: number;
  totalUi: bigint;
  vestedUi: bigint;
  claimableUi: bigint;
  start: number;
  cliff: number;
  end: number;
  incoming: boolean;
  revoked: boolean;
  txHash?: Hex;
};

type ActivityItem = {
  hash: Hex;
  blockNumber: bigint;
  label: string;
  detail: string;
};

type PortfolioSnapshot = {
  usdcBalance: bigint;
  usdcDecimals: number;
  usdcSent: bigint;
  usdcReceived: bigint;
  holdings: Holding[];
  grants: GrantPosition[];
  activities: ActivityItem[];
  tips: Array<{ symbol: string; decimals: number; ui: bigint }>;
  historyAvailable: boolean;
};

type ReadClient = NonNullable<ReturnType<typeof usePublicClient>>;

export function PortfolioSession() {
  const { address } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const enabled = !!address && !!client && chainId === EXPECTED_CHAIN_ID;
  const query = useQuery({
    queryKey: ["portfolio-session", address, chainId],
    queryFn: () => readPortfolio(client as ReadClient, address as Address),
    enabled,
    refetchInterval: 30_000,
  });

  if (!address) {
    return <PortfolioEmpty title="Sign in to see your portfolio." body="Your balances, grants, and activity will appear here after Privy sign-in." />;
  }
  if (chainId !== EXPECTED_CHAIN_ID) {
    return <PortfolioEmpty title="Switch to Base to view your portfolio." body="OwnPay reads your real positions from Base mainnet." />;
  }
  if (query.isLoading) {
    return <PortfolioEmpty title="Loading your portfolio…" body="Reading balances and verified activity from Base." />;
  }
  if (query.isError || !query.data) {
    return <PortfolioEmpty title="Portfolio temporarily unavailable." body="Base did not return a complete portfolio snapshot." action={query.refetch} />;
  }

  return <PortfolioView snapshot={query.data} address={address} />;
}

function PortfolioView({ snapshot, address }: { snapshot: PortfolioSnapshot; address: Address }) {
  const ownedSummary = summarizeShares(snapshot.holdings);
  const vestedSummary = summarizeShares(
    snapshot.grants.filter((grant) => grant.incoming).map((grant) => ({ symbol: grant.symbol, decimals: grant.decimals, ui: grant.vestedUi })),
  );
  const tipsSummary = summarizeShares(snapshot.tips);
  const sentStockSummary = summarizeShares(
    snapshot.grants.filter((grant) => !grant.incoming).map((grant) => ({ symbol: grant.symbol, decimals: grant.decimals, ui: grant.totalUi })),
  );

  return (
    <section id="portfolio" className="dashboard-section" aria-labelledby="portfolio-title">
      <div className="section-heading">
        <div><p className="eyebrow">Your portfolio</p><h2 id="portfolio-title">Everything you own and send.</h2></div>
        <div className="portfolio-heading-actions"><a className="section-count" href={BASESCAN_ADDRESS(address)} target="_blank" rel="noopener noreferrer">View wallet ↗</a><WalletAddressCopy address={address} compact /></div>
      </div>

      <div className="portfolio-metrics">
        <Metric label="Available USDC" value={`${formatUiAmount(snapshot.usdcBalance, snapshot.usdcDecimals)} USDC`} />
        <Metric label="Owned stocks" value={ownedSummary || "0 shares"} />
        <Metric label="Vested to you" value={vestedSummary || "0 shares"} />
        <Metric label="Total spent" value={`${formatUiAmount(snapshot.usdcSent, snapshot.usdcDecimals)} USDC`} detail="Outgoing USDC transfers" />
        <Metric label="Stock sent" value={sentStockSummary || "0 shares"} />
        <Metric label="Tips sent" value={tipsSummary || "0 shares"} />
      </div>

      <div className="portfolio-columns">
        <div className="panel">
          <div className="portfolio-panel-heading"><div><p className="eyebrow">Holdings</p><h3>Stocks you own</h3></div><span className="section-count">Live B20 reads</span></div>
          <div className="portfolio-list">
            {snapshot.holdings.map((holding) => (
              <div className="portfolio-row" key={holding.symbol}>
                <span className="portfolio-token-mark">{holding.symbol.slice(0, 1)}</span>
                <span><strong>{holding.symbol}</strong><small>{holding.name}</small></span>
                <span className="portfolio-row-value">{formatUiAmount(holding.ui, holding.decimals, { maxFractionDigits: 6, minFractionDigits: 4 })}<small>shares</small></span>
              </div>
            ))}
            {snapshot.holdings.length === 0 && <p className="portfolio-muted">No supported B20 stock balance found yet.</p>}
          </div>
          <p className="portfolio-note">Share amounts use each token&apos;s B20 scaled-balance conversion. No stock dollar value is invented.</p>
        </div>

        <div className="panel">
          <div className="portfolio-panel-heading"><div><p className="eyebrow">Vesting</p><h3>Your grants</h3></div><span className="section-count">From StockVesting</span></div>
          <div className="portfolio-list">
            {snapshot.grants.filter((grant) => grant.incoming).slice(0, 8).map((grant) => (
              <div className="portfolio-row portfolio-grant-row" key={grant.id.toString()}>
                <span className="portfolio-token-mark">{grant.symbol.slice(0, 1)}</span>
                <span><strong>{grant.symbol} · Grant #{grant.id.toString()}</strong><small>{grant.revoked ? "Revoked" : grant.claimableUi > 0n ? "Claimable now" : "Vesting"}</small></span>
                <span className="portfolio-row-value">{formatUiAmount(grant.vestedUi, grant.decimals, { maxFractionDigits: 6, minFractionDigits: 4 })}<small>of {formatUiAmount(grant.totalUi, grant.decimals, { maxFractionDigits: 6, minFractionDigits: 4 })}</small></span>
              </div>
            ))}
            {snapshot.grants.filter((grant) => grant.incoming).length === 0 && <p className="portfolio-muted">No grants received yet.</p>}
          </div>
        </div>
      </div>

      <div className="portfolio-columns">
        <div className="panel">
          <div className="portfolio-panel-heading"><div><p className="eyebrow">Ownership activity</p><h3>Grant timeline</h3></div><span className="section-count">{snapshot.grants.length} total</span></div>
          <div className="portfolio-list">
            {snapshot.grants.slice(0, 8).map((grant) => (
              <div className="portfolio-row" key={`timeline-${grant.id.toString()}`}>
                <span className={`portfolio-status ${grant.incoming ? "portfolio-status-in" : "portfolio-status-out"}`}>{grant.incoming ? "IN" : "OUT"}</span>
                <span><strong>{grant.incoming ? "Received" : "Sent"} {grant.symbol}</strong><small>{grant.incoming ? "Grant to your wallet" : "Grant created by you"}</small></span>
                <span className="portfolio-row-value">{formatUiAmount(grant.totalUi, grant.decimals, { maxFractionDigits: 6, minFractionDigits: 4 })}<small>{formatDate(grant.start)}</small></span>
              </div>
            ))}
            {snapshot.grants.length === 0 && <p className="portfolio-muted">No vesting activity yet.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="portfolio-panel-heading"><div><p className="eyebrow">Onchain history</p><h3>Transactions</h3></div><span className="section-count">Recent activity</span></div>
          {!snapshot.historyAvailable && <p className="portfolio-note portfolio-warning">Some history could not be loaded from the public Base RPC. Balances above remain live.</p>}
          <div className="portfolio-list">
            {snapshot.activities.slice(0, 10).map((activity) => (
              <a className="portfolio-row portfolio-activity-row" href={BASESCAN_TX(activity.hash)} target="_blank" rel="noopener noreferrer" key={`${activity.hash}-${activity.label}`}>
                <span className="portfolio-status portfolio-status-neutral">TX</span>
                <span><strong>{activity.label}</strong><small>{activity.detail}</small></span>
                <span className="portfolio-row-value">#{activity.blockNumber.toString()}<small>Base ↗</small></span>
              </a>
            ))}
            {snapshot.activities.length === 0 && <p className="portfolio-muted">No transactions found for this wallet in the recent history window.</p>}
          </div>
        </div>
      </div>

      <div className="portfolio-receiving panel-warm"><span><p className="eyebrow">Receive</p><strong>Your OwnPay Link is ready.</strong><small>Share it to receive USDC, stock grants, gifts, and tips.</small></span><a className="btn btn-primary" href="#own-link-title">Open receiving link</a></div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="portfolio-metric"><span>{label}</span><strong>{value}</strong><small>{detail ?? "Verified from Base"}</small></div>;
}

function PortfolioEmpty({ title, body, action }: { title: string; body: string; action?: () => void }) {
  return <div className="empty-state portfolio-empty"><span className="empty-state-icon">◎</span><h3>{title}</h3><p>{body}</p>{action && <button className="btn btn-ghost" onClick={action}>Try again</button>}</div>;
}

function summarizeShares(values: Array<{ symbol: string; decimals: number; ui: bigint }>): string {
  const bySymbol = new Map<string, { decimals: number; ui: bigint }>();
  for (const value of values) {
    const current = bySymbol.get(value.symbol);
    bySymbol.set(value.symbol, { decimals: value.decimals, ui: (current?.ui ?? 0n) + value.ui });
  }
  return [...bySymbol.entries()].filter(([, value]) => value.ui > 0n).map(([symbol, value]) => `${formatUiAmount(value.ui, value.decimals, { maxFractionDigits: 4, minFractionDigits: 2 })} ${symbol}`).join(" · ");
}

async function readPortfolio(client: ReadClient, address: Address): Promise<PortfolioSnapshot> {
  const latestBlock = await client.getBlockNumber();
  const fromBlock = latestBlock > 2_000_000n ? latestBlock - 2_000_000n : 0n;
  const historyResults = await Promise.all([
    safeLogs(client, { address: BASE_USDC_ADDRESS, event: transferEvent, args: { from: address }, fromBlock }),
    safeLogs(client, { address: BASE_USDC_ADDRESS, event: transferEvent, args: { to: address }, fromBlock }),
    STOCK_VESTING_ADDRESS ? safeLogs(client, { address: STOCK_VESTING_ADDRESS, event: grantCreatedEvent, fromBlock }) : Promise.resolve({ logs: [], ok: true }),
    STOCK_VESTING_ADDRESS ? safeLogs(client, { address: STOCK_VESTING_ADDRESS, event: releasedEvent, args: { to: address }, fromBlock }) : Promise.resolve({ logs: [], ok: true }),
    STOCK_VESTING_ADDRESS ? safeLogs(client, { address: STOCK_VESTING_ADDRESS, event: revokedEvent, args: { from: address }, fromBlock }) : Promise.resolve({ logs: [], ok: true }),
  ]);
  const [usdcSentLogs, usdcReceivedLogs, grantLogs, releasedLogs, revokedLogs] = historyResults;

  const usdcDecimals = Number(await client.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" }));
  const usdcBalance = (await client.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
  const usdcSent = sumLogs(usdcSentLogs.logs, "value");
  const usdcReceived = sumLogs(usdcReceivedLogs.logs, "value");

  const holdings = (await Promise.all(SUPPORTED_TOKENS.map(async (token) => {
    try {
      const [raw, decimals] = await Promise.all([
        client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
        getDecimals(client, token.address),
      ]);
      return { symbol: token.symbol, name: token.name, decimals, ui: await rawToUi(client, token.address, raw) };
    } catch {
      return null;
    }
  }))).filter((holding): holding is Holding => holding !== null);

  const allGrantLogs = grantLogs.logs.filter((log) => {
    const from = log.args?.from as Address | undefined;
    const to = log.args?.to as Address | undefined;
    return from?.toLowerCase() === address.toLowerCase() || to?.toLowerCase() === address.toLowerCase();
  });
  const grants = await Promise.all(allGrantLogs.slice(-30).map(async (log) => readGrant(client, address, log)));
  const validGrants = grants.filter((grant): grant is GrantPosition => grant !== null);

  const tipResults = await Promise.all(SUPPORTED_TOKENS.map((token) => safeLogs(client, { address: token.address, event: memoTransferEvent, args: { from: address }, fromBlock })));
  const vestingTips = STOCK_VESTING_ADDRESS ? await safeLogs(client, { address: STOCK_VESTING_ADDRESS, event: vestingMemoEvent, args: { from: address }, fromBlock }) : { logs: [], ok: true };
  const tips = (await Promise.all(SUPPORTED_TOKENS.map(async (token, index) => {
    const nativeRaw = sumLogs(tipResults[index].logs, "value");
    const fallbackRaw = vestingTips.logs.filter((log) => (log.args?.token as Address | undefined)?.toLowerCase() === token.address.toLowerCase()).reduce((total, log) => total + ((log.args?.rawAmount as bigint | undefined) ?? 0n), 0n);
    if (nativeRaw + fallbackRaw === 0n) return null;
    return { symbol: token.symbol, decimals: await getDecimals(client, token.address), ui: await rawToUi(client, token.address, nativeRaw + fallbackRaw) };
  }))).filter((tip): tip is { symbol: string; decimals: number; ui: bigint } => tip !== null);

  const activities = await buildActivities(client, address, usdcSentLogs.logs, usdcReceivedLogs.logs, grantLogs.logs, releasedLogs.logs, revokedLogs.logs, tipResults.flatMap((result) => result.logs));
  return {
    usdcBalance,
    usdcDecimals,
    usdcSent,
    usdcReceived,
    holdings,
    grants: validGrants.sort((a, b) => Number(b.start - a.start)),
    activities,
    tips,
    historyAvailable: historyResults.every((result) => result.ok) && tipResults.every((result) => result.ok) && vestingTips.ok,
  };
}

async function readGrant(client: ReadClient, address: Address, log: PortfolioLog): Promise<GrantPosition | null> {
  const id = log.args?.id as bigint | undefined;
  const token = log.args?.token as Address | undefined;
  const from = log.args?.from as Address | undefined;
  const to = log.args?.to as Address | undefined;
  if (id === undefined || !token || !from || !to || !STOCK_VESTING_ADDRESS) return null;
  try {
    const [current, vestedRaw, claimableRaw, decimals] = await Promise.all([
      client.readContract({ address: STOCK_VESTING_ADDRESS, abi: stockVestingAbi, functionName: "grants", args: [id] }) as Promise<readonly unknown[]>,
      client.readContract({ address: STOCK_VESTING_ADDRESS, abi: stockVestingAbi, functionName: "vestedRaw", args: [id] }) as Promise<bigint>,
      client.readContract({ address: STOCK_VESTING_ADDRESS, abi: stockVestingAbi, functionName: "releasableRaw", args: [id] }) as Promise<bigint>,
      getDecimals(client, token),
    ]);
    const totalRaw = current[3] as bigint;
    const revoked = current[9] as boolean;
    return {
      id,
      symbol: tokenByAddress(token)?.symbol ?? "B20",
      decimals,
      totalUi: await rawToUi(client, token, totalRaw),
      vestedUi: await rawToUi(client, token, vestedRaw),
      claimableUi: await rawToUi(client, token, claimableRaw),
      start: Number(current[5]),
      cliff: Number(current[6]),
      end: Number(current[5]) + Number(current[7]),
      incoming: to.toLowerCase() === address.toLowerCase(),
      revoked,
      txHash: log.transactionHash,
    };
  } catch {
    return null;
  }
}

async function buildActivities(
  client: ReadClient,
  address: Address,
  sent: PortfolioLog[],
  received: PortfolioLog[],
  grants: PortfolioLog[],
  released: PortfolioLog[],
  revoked: PortfolioLog[],
  tips: PortfolioLog[],
): Promise<ActivityItem[]> {
  const items: ActivityItem[] = [];
  const usdcDecimals = Number(await client.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "decimals" }));
  for (const log of sent) if (log.transactionHash && log.blockNumber !== undefined) items.push({ hash: log.transactionHash, blockNumber: log.blockNumber, label: "USDC sent", detail: `${formatUiAmount((log.args?.value as bigint) ?? 0n, usdcDecimals)} USDC` });
  for (const log of received) if (log.transactionHash && log.blockNumber !== undefined && (log.args?.from as Address)?.toLowerCase() !== address.toLowerCase()) items.push({ hash: log.transactionHash, blockNumber: log.blockNumber, label: "USDC received", detail: `+${formatUiAmount((log.args?.value as bigint) ?? 0n, usdcDecimals)} USDC` });
  for (const log of grants) if (log.transactionHash && log.blockNumber !== undefined) {
    const token = tokenByAddress(log.args?.token as string);
    const decimals = token ? await getDecimals(client, token.address) : 8;
    const amount = await rawToUi(client, log.args?.token as Address, (log.args?.total as bigint) ?? 0n).catch(() => 0n);
    items.push({ hash: log.transactionHash, blockNumber: log.blockNumber, label: (log.args?.from as Address)?.toLowerCase() === address.toLowerCase() ? "Grant sent" : "Grant received", detail: `${formatUiAmount(amount, decimals, { maxFractionDigits: 6, minFractionDigits: 4 })} ${token?.symbol ?? "B20"}` });
  }
  for (const log of released) if (log.transactionHash && log.blockNumber !== undefined) items.push({ hash: log.transactionHash, blockNumber: log.blockNumber, label: "Stock claimed", detail: `Grant #${String(log.args?.id ?? "")}` });
  for (const log of revoked) if (log.transactionHash && log.blockNumber !== undefined) items.push({ hash: log.transactionHash, blockNumber: log.blockNumber, label: "Grant revoked", detail: `Grant #${String(log.args?.id ?? "")}` });
  for (const log of tips) if (log.transactionHash && log.blockNumber !== undefined) {
    const token = tokenByAddress(log.address ?? "");
    items.push({ hash: log.transactionHash, blockNumber: log.blockNumber, label: "Stock tip sent", detail: token?.symbol ?? "B20 tip" });
  }
  const unique = new Map<string, ActivityItem>();
  for (const item of items) unique.set(`${item.hash}-${item.label}`, item);
  return [...unique.values()].sort((a, b) => Number(b.blockNumber - a.blockNumber));
}

async function safeLogs(client: ReadClient, args: Record<string, unknown>): Promise<{ logs: PortfolioLog[]; ok: boolean }> {
  try {
    const logs = await client.getLogs(args as never) as unknown as PortfolioLog[];
    return { logs, ok: true };
  } catch {
    return { logs: [], ok: false };
  }
}

function sumLogs(logs: PortfolioLog[], field: string): bigint {
  return logs.reduce((total, log) => total + ((log.args?.[field] as bigint | undefined) ?? 0n), 0n);
}
