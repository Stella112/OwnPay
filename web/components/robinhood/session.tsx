'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getEmbeddedConnectedWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { createPublicClient, createWalletClient, custom, decodeAbiParameters, encodeFunctionData, http, keccak256, toHex, type Address, type Hex, type WalletClient } from 'viem';
import { intentDomain, intentTypes, ownRulesAbi, robinhoodTestnet } from '@/lib/robinhood';
import { createRobinhoodKernel } from '@/lib/robinhood-kernel';

export type Snapshot = {
  router: Address; account?: Address; demoAdapter: Address | null; demoAsset: Address | null;
  relayEnabled: boolean; agent: Address | null; balance?: string; savings?: string; reserve?: string; incoming?: string; assetBalance?: string;
  rule?: [number, number, string, string, Address, string, string, boolean];
  delegation?: [Address, string, string]; policy?: [boolean, boolean, string]; nonce?: string;
  vesting?: Address; vestingSeconds?: string; grantCount?: string;
  grants?: { id: string; asset: Address; total: string; released: string; start: string; end: string; claimable: string }[];
  agentService?: { state: 'online' | 'degraded' | 'stale' | 'not-reporting'; mode: 'observe' | 'execute' | null; updatedAt: string | null; lastActionAt: string | null; lastCycleOk: boolean | null; trackedAccounts: number; pendingAccounts: number };
};
export type HistoryItem = { kind: string; block: string; tx: Hex; timestamp?: number; actor?: 'agent' | 'owner' | 'other'; data: Record<string, string | boolean | null> };
type Call = { to: Address; data: Hex };
type Kernel = Awaited<ReturnType<typeof createRobinhoodKernel>>;

export const rhChain = createPublicClient({ chain: robinhoodTestnet, transport: http() });
export const rhExplorer = robinhoodTestnet.blockExplorers!.default.url;

async function readApiJson(response: Response): Promise<Record<string, unknown> & { error?: string }> {
  const text = await response.text();
  let data: (Record<string, unknown> & { error?: string }) | undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!response.ok) {
    if (data?.error) throw new Error(String(data.error));
    if (response.status >= 502 && response.status <= 504) throw new Error('OwnPay server is temporarily unavailable. Retry in a moment.');
    throw new Error(`Request failed (HTTP ${response.status}).`);
  }
  if (!data) throw new Error('Unexpected empty response from the OwnPay server.');
  return data;
}
async function getJson(url: string) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { cache: 'no-store' });
    if (attempt === 0 && response.status >= 502 && response.status <= 504) { await new Promise((r) => setTimeout(r, 1500)); continue; }
    return readApiJson(response);
  }
}

/** One clear sentence for contract reverts / bundler errors; never raw calldata. */
export function friendlyError(e: unknown): string {
  const err = e as { shortMessage?: string; details?: string; message?: string };
  const text = [err.details, err.shortMessage, err.message].filter(Boolean).join(' | ');
  const known: [RegExp, string][] = [
    [/policy: sender blocked/i, 'This recipient has blocked payments from your address.'],
    [/policy: sender not allowlisted/i, 'This recipient only accepts payments from senders they have approved.'],
    [/policy: sender unverifiable/i, "Allowlist-only mode can't verify who sent a direct deposit, so it was not processed. Recover it from your receive account or turn allowlist-only off."],
    [/policy: memo required/i, 'This recipient requires a payment note. Add a note and try again.'],
    [/policy: sender daily cap/i, "This would exceed the recipient's daily limit for your address."],
    [/payment policy denied/i, 'The recipient has no enabled OwnRule, or this amount is above their maximum payment.'],
    [/daily limit/i, "This payment would exceed the recipient's daily limit."],
    [/agent denied/i, 'The agent is not authorized for this account (expired, revoked, or the rule changed).'],
    [/did not match any gas sponsoring policies/i, 'This action is not covered by the gas sponsorship policy.'],
    [/AA21|didn.t pay prefund|insufficient funds/i, 'Not enough testnet ETH for gas, and this action was not sponsored.'],
    [/user rejected|denied transaction|rejected the request/i, 'You rejected the request.'],
    [/invalid sender status/i, 'Enter a valid address other than your own.'],
    [/allowance/i, 'Token approval is missing or too low.'],
    [/nothing to release/i, 'Nothing is claimable yet.'],
  ];
  for (const [re, msg] of known) if (re.test(text)) return msg;
  const reason = text.match(/reason: ([^|]+?)(?: Version:|\||$)/i)?.[1]?.trim();
  if (reason) return `Transaction rejected: ${reason}.`;
  const first = (err.shortMessage || err.message || 'Transaction failed.').split('\n')[0];
  return first.length > 200 ? first.slice(0, 200) + '…' : first;
}

type Session = {
  owner?: Address; signerOwner?: Address; smartAccount: boolean; kernelStatus: 'off' | 'starting' | 'on' | 'error';
  setSmartAccount: (on: boolean) => void; auth: React.ReactNode;
  snapshot: Snapshot | null; loading: boolean; refresh: () => Promise<void>; /** ms timestamp of the last status read (render-safe "now"). */ checkedAt: number;
  history: HistoryItem[]; historyLoading: boolean; historyError?: string;
  busy: boolean; error: string; hash?: Hex; clearNotice: () => void;
  run: (action: () => Promise<void>) => Promise<void>;
  signed: (action: number, data: Hex) => Promise<void>;
  sendCalls: (calls: Call[]) => Promise<void>;
  commitment: (note: string) => Promise<Hex>;
};
const Ctx = createContext<Session | null>(null);
export function useRh() { const s = useContext(Ctx); if (!s) throw new Error('useRh outside RobinhoodSessionProvider'); return s; }

export function RobinhoodSessionProvider({ children }: { children: React.ReactNode }) {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID ? <EmailSession>{children}</EmailSession> : <ExternalSession>{children}</ExternalSession>;
}
function EmailSession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embedded = getEmbeddedConnectedWallet(wallets);
  const owner = ready && authenticated ? embedded?.address as Address | undefined : undefined; // never an injected fallback
  const getSigner = useCallback(async () => {
    if (!owner || !embedded) throw new Error('Your embedded wallet is still loading.');
    await embedded.switchChain(46630);
    return createWalletClient({ account: owner, chain: robinhoodTestnet, transport: custom(await embedded.getEthereumProvider()) });
  }, [owner, embedded]);
  return <SessionCore signerOwner={owner} getSigner={getSigner} auth={<button className="btn btn-primary" disabled={!ready} onClick={() => authenticated ? void logout() : login()}>{authenticated ? 'Sign out' : 'Sign in / Sign up'}</button>}>{children}</SessionCore>;
}
function ExternalSession({ children }: { children: React.ReactNode }) {
  const { address } = useAccount(); const { data: wallet } = useWalletClient();
  const { connectors, connect } = useConnect(); const { disconnect } = useDisconnect();
  const getSigner = useCallback(async () => {
    if (!wallet || !address) throw new Error('Connect a wallet first.');
    await wallet.switchChain({ id: 46630 }).catch(async () => { await wallet.addChain({ chain: robinhoodTestnet }); await wallet.switchChain({ id: 46630 }); });
    return createWalletClient({ account: address, chain: robinhoodTestnet, transport: custom(wallet.transport) });
  }, [wallet, address]);
  return <SessionCore signerOwner={address} getSigner={getSigner} auth={address ? <button className="btn" onClick={() => disconnect()}>Disconnect</button> : <button className="btn btn-primary" onClick={() => connectors[0] && connect({ connector: connectors[0] })}>Connect wallet</button>}>{children}</SessionCore>;
}

function SessionCore({ signerOwner, getSigner, auth, children }: { signerOwner?: Address; getSigner: () => Promise<WalletClient>; auth: React.ReactNode; children: React.ReactNode }) {
  const zerodev = !!process.env.NEXT_PUBLIC_ROBINHOOD_ZERODEV_RPC;
  const [kernel, setKernel] = useState<{ signer: Address; client: Kernel } | null>(null);
  const [kernelStatus, setKernelStatus] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [wantSmart, setWantSmart] = useState(true); // smart account by default when sponsorship is configured
  const activeKernel = signerOwner && kernel?.signer === signerOwner ? kernel.client : null;
  const owner = activeKernel?.account.address || signerOwner;
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [hash, setHash] = useState<Hex>();

  // Deriving the smart account needs no signature, so enable it automatically.
  const starting = useRef<Address | null>(null);
  useEffect(() => {
    if (!zerodev || !wantSmart || !signerOwner || kernel?.signer === signerOwner || starting.current === signerOwner) return;
    starting.current = signerOwner;
    queueMicrotask(() => setKernelStatus('starting'));
    getSigner().then((s) => createRobinhoodKernel(s)).then((client) => { setKernel({ signer: signerOwner, client }); setKernelStatus('on'); })
      .catch((e) => { setKernelStatus('error'); setError(friendlyError(e)); })
      .finally(() => { starting.current = null; });
  }, [zerodev, wantSmart, signerOwner, kernel, getSigner]);
  const setSmartAccount = useCallback((on: boolean) => { setWantSmart(on); if (!on) { setKernel(null); setKernelStatus('off'); } }, []);

  const status = useQuery({
    queryKey: ['rh-status', owner],
    queryFn: async () => (await getJson(`/api/robinhood/status${owner ? `?owner=${owner}` : ''}`)) as unknown as Snapshot,
    refetchInterval: 15_000,
  });
  const historyQ = useQuery({
    queryKey: ['rh-history', owner],
    enabled: !!owner,
    queryFn: async () => ((await getJson(`/api/robinhood/history?owner=${owner}`)).items as HistoryItem[]),
    refetchInterval: 20_000,
  });
  const snapshot = status.data ?? null;
  const refresh = useCallback(async () => { await Promise.all([status.refetch(), historyQ.refetch()]); }, [status, historyQ]);

  const confirmed = useCallback(async (tx: Hex) => {
    setHash(tx);
    const receipt = await rhChain.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== 'success') throw new Error('Transaction reverted.');
  }, []);
  const sendKernel = useCallback(async (calls: Call[]) => {
    if (!activeKernel) throw new Error('No active smart account.');
    const op = await activeKernel.sendUserOperation({ callData: await activeKernel.account.encodeCalls(calls) });
    const receipt = await activeKernel.waitForUserOperationReceipt({ hash: op, timeout: 120000 });
    if (!receipt.success) throw new Error('Sponsored user operation failed.'); // EntryPoint success != op success
    await confirmed(receipt.receipt.transactionHash);
  }, [activeKernel, confirmed]);
  const sendCalls = useCallback(async (calls: Call[]) => {
    if (!owner) throw new Error('Sign in first.');
    if (activeKernel) { await sendKernel(calls); return; }
    const signer = await getSigner();
    for (const c of calls) {
      await rhChain.call({ account: owner, to: c.to, data: c.data }); // surface reverts before signing
      await confirmed(await signer.sendTransaction({ account: owner, chain: robinhoodTestnet, to: c.to, data: c.data }));
    }
  }, [owner, activeKernel, sendKernel, getSigner, confirmed]);
  const signed = useCallback(async (action: number, data: Hex) => {
    if (!owner || !snapshot) throw new Error('Sign in and wait for the deployed contracts.');
    if (activeKernel) {
      const dec = <T extends readonly { type: string }[]>(types: T) => decodeAbiParameters(types, data);
      const calls: Record<number, () => Hex> = {
        0: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'createAccount' }),
        1: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'saveRule', args: dec([{ type: 'uint16' }, { type: 'uint16' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'uint128' }, { type: 'bool' }] as const) }),
        2: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'delegate', args: dec([{ type: 'address' }, { type: 'uint64' }] as const) }),
        3: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'withdraw', args: dec([{ type: 'bool' }, { type: 'uint256' }] as const) }),
        4: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'setVestingSeconds', args: dec([{ type: 'uint64' }] as const) }),
        5: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'setPolicy', args: dec([{ type: 'bool' }, { type: 'bool' }, { type: 'uint128' }] as const) }),
        6: () => encodeFunctionData({ abi: ownRulesAbi, functionName: 'setSender', args: dec([{ type: 'address' }, { type: 'uint8' }] as const) }),
      };
      if (!calls[action]) throw new Error('Unknown action');
      await sendKernel([{ to: snapshot.router, data: calls[action]() }]); return;
    }
    const signer = await getSigner();
    const nonce = await rhChain.readContract({ address: snapshot.router, abi: ownRulesAbi, functionName: 'nonces', args: [owner] });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await signer.signTypedData({ account: owner, domain: intentDomain(snapshot.router), types: intentTypes, primaryType: 'Intent', message: { owner, action, dataHash: keccak256(data), nonce, deadline } });
    if (snapshot.relayEnabled && nonce < 10n) {
      const result = await readApiJson(await fetch('/api/robinhood/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, action, data, deadline: String(deadline), signature }) }));
      setHash(result.hash as Hex);
    } else {
      const sim = await rhChain.simulateContract({ account: owner, address: snapshot.router, abi: ownRulesAbi, functionName: 'executeSigned', args: [owner, action, data, deadline, signature] });
      await confirmed(await signer.writeContract({ ...sim.request, account: owner, chain: robinhoodTestnet }));
    }
  }, [owner, snapshot, activeKernel, sendKernel, getSigner, confirmed]);
  const commitment = useCallback(async (note: string): Promise<Hex> => {
    // Plaintext never leaves the browser; only a commitment to the ciphertext goes onchain.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(note)));
    const digest = keccak256(toHex(sealed));
    localStorage.setItem(`ownpay.rh.metadata.${owner}.${digest}`, JSON.stringify({ iv: Array.from(iv), ciphertext: Array.from(sealed), key: await crypto.subtle.exportKey('jwk', key) }));
    return digest;
  }, [owner]);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setHash(undefined);
    try { await action(); await refresh(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  }, [refresh]);

  const value = useMemo<Session>(() => ({
    owner, signerOwner, smartAccount: !!activeKernel, kernelStatus, setSmartAccount, auth,
    snapshot, loading: status.isLoading, refresh, checkedAt: status.dataUpdatedAt,
    history: historyQ.data ?? [], historyLoading: historyQ.isLoading, historyError: historyQ.error ? friendlyError(historyQ.error) : undefined,
    busy, error: error || (status.error ? friendlyError(status.error) : ''), hash, clearNotice: () => { setError(''); setHash(undefined); },
    run, signed, sendCalls, commitment,
  }), [owner, signerOwner, activeKernel, kernelStatus, setSmartAccount, auth, snapshot, status.isLoading, status.dataUpdatedAt, status.error, refresh, historyQ.data, historyQ.isLoading, historyQ.error, busy, error, hash, run, signed, sendCalls, commitment]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
