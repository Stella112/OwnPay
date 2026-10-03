'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getEmbeddedConnectedWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import { createPublicClient, createWalletClient, custom, decodeAbiParameters, encodeAbiParameters, encodeFunctionData, erc20Abi, formatUnits, http, isAddress, keccak256, parseUnits, toHex, zeroAddress, type Address, type Hex, type WalletClient } from 'viem';
import { intentDomain, intentTypes, ownRulesAbi, robinhoodTestnet, TEST_USDG } from '@/lib/robinhood';
import { rhVestingAbi } from '@/lib/robinhood-vesting';
import { createRobinhoodKernel } from '@/lib/robinhood-kernel';
import { OwnPayIcon } from '@/components/OwnPayIcon';
import { RobinhoodStocks } from '@/components/RobinhoodStocks';
import styles from './RobinhoodWorkbench.module.css';

type Snapshot = {
  router: Address; account?: Address; demoAdapter: Address | null; demoAsset: Address | null;
  relayEnabled: boolean; agent: Address | null; balance?: string; savings?: string; reserve?: string; incoming?: string; assetBalance?: string;
  rule?: [number, number, string, string, Address, string, string, boolean];
  delegation?: [Address, string, string]; compliance?: [string, boolean]; nonce?: string;
  receipts?: { hash: Hex; id: string; amount: string; spendable: string; saved: string; ownership: string; assetOut: string; metadataCommitment: Hex }[];
  historyWarning?: string | null;
  vesting?: Address; vestingSeconds?: string; grantCount?: string;
  grants?: { id: string; asset: Address; total: string; released: string; start: string; end: string; claimable: string }[];
  agentService?: { state: 'online' | 'degraded' | 'stale' | 'not-reporting'; mode: 'observe' | 'execute' | null; updatedAt: string | null; lastActionAt: string | null; lastCycleOk: boolean | null; trackedAccounts: number; pendingAccounts: number };
};
const chain = createPublicClient({ chain: robinhoodTestnet, transport: http() });
const units = (v?: string, decimals = 6) => v === undefined ? '—' : formatUnits(BigInt(v), decimals);
const explorer = robinhoodTestnet.blockExplorers!.default.url;

/**
 * Parse an API response without crashing on an empty/HTML body. A reverse-proxy 502
 * (e.g. while the app restarts) has no JSON body; surface a clear, retryable message
 * instead of "Unexpected end of JSON input".
 */
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

/** Read-only GET with a single retry for transient gateway errors. Never used for writes. */
async function getStatusJson(url: string) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { cache: 'no-store' });
    if (attempt === 0 && response.status >= 502 && response.status <= 504) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      continue;
    }
    return readApiJson(response);
  }
}

export function RobinhoodWorkbench() {
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID ? <EmailWorkbench /> : <ExternalWorkbench />;
}
function EmailWorkbench() {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embedded = getEmbeddedConnectedWallet(wallets);
  // Email session never falls back to an injected wallet.
  const owner = ready && authenticated ? embedded?.address as Address | undefined : undefined;
  const getSigner = async () => {
    if (!owner || !embedded) throw new Error('Your embedded wallet is still loading.');
    await embedded.switchChain(46630);
    return createWalletClient({ account: owner, chain: robinhoodTestnet, transport: custom(await embedded.getEthereumProvider()) });
  };
  return <Workbench owner={owner} getSigner={getSigner} auth={<button className="btn btn-primary" disabled={!ready} onClick={() => authenticated ? void logout() : login()}>{authenticated ? 'Sign out' : 'Sign in / Sign up'}</button>} />;
}
function ExternalWorkbench() {
  const { address } = useAccount(); const { data: wallet } = useWalletClient();
  const { connectors, connect } = useConnect(); const { disconnect } = useDisconnect();
  const getSigner = async () => {
    if (!wallet || !address) throw new Error('Connect a wallet first.');
    await wallet.switchChain({ id: 46630 }).catch(async () => {
      await wallet.addChain({ chain: robinhoodTestnet }); await wallet.switchChain({ id: 46630 });
    });
    return createWalletClient({ account: address, chain: robinhoodTestnet, transport: custom(wallet.transport) });
  };
  return <Workbench owner={address} getSigner={getSigner} auth={address ? <button className="btn" onClick={() => disconnect()}>Disconnect</button> : <button className="btn btn-primary" onClick={() => connectors[0] && connect({ connector: connectors[0] })}>Connect wallet</button>} />;
}

function Workbench({ owner: signerOwner, getSigner, auth }: { owner?: Address; getSigner: () => Promise<WalletClient>; auth: React.ReactNode }) {
  const [view, setView] = useState<'overview' | 'automation' | 'pay' | 'stocks' | 'activity'>('overview');
  const [kernel, setKernel] = useState<Awaited<ReturnType<typeof createRobinhoodKernel>> | null>(null);
  const [kernelSigner, setKernelSigner] = useState<Address>();
  const activeKernel = signerOwner && kernelSigner === signerOwner ? kernel : null;
  const owner = activeKernel?.account.address || signerOwner;
  const [loaded, setLoaded] = useState<{ owner?: Address; snapshot: Snapshot } | null>(null);
  const snapshot = loaded?.owner === owner ? loaded?.snapshot || null : null;
  const requestId = useRef(0);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [hash, setHash] = useState<Hex>();
  const [saved, setSaved] = useState('10'); const [owned, setOwned] = useState('20'); const [max, setMax] = useState('100'); const [daily, setDaily] = useState('500');
  const [demo, setDemo] = useState(false); const [recipient, setRecipient] = useState(''); const [amount, setAmount] = useState('100'); const [memo, setMemo] = useState('');
  const [link, setLink] = useState('');
  const [vestingDays, setVestingDays] = useState('0');
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setError('');
    try {
      const data = await getStatusJson(`/api/robinhood/status${owner ? `?owner=${owner}` : ''}`);
      if (id === requestId.current) setLoaded({ owner, snapshot: data as unknown as Snapshot });
    } catch (e) { if (id === requestId.current) { setLoaded(null); setError(e instanceof Error ? e.message : 'Unable to load testnet.'); } }
  }, [owner]);
  useEffect(() => { setLoaded(null); setHash(undefined); void refresh(); }, [refresh]);
  useEffect(() => { const q = new URLSearchParams(window.location.search); setRecipient(q.get('to') || ''); setAmount(q.get('amount') || '100'); }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setHash(undefined); try { await action(); await refresh(); } catch(e) { setError(e instanceof Error ? e.message : 'Transaction failed.'); } finally { setBusy(false); } }
  async function signed(action: number, data: Hex) {
    if (!owner || !snapshot) throw new Error('Sign in and wait for the deployed contracts.');
    if (activeKernel) {
      let call: Hex;
      if (action === 0) call = encodeFunctionData({ abi: ownRulesAbi, functionName: 'createAccount' });
      else if (action === 1) call = encodeFunctionData({ abi: ownRulesAbi, functionName: 'saveRule', args: decodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'uint128' }, { type: 'bool' }], data) });
      else if (action === 2) call = encodeFunctionData({ abi: ownRulesAbi, functionName: 'delegate', args: decodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], data) });
      else if (action === 3) call = encodeFunctionData({ abi: ownRulesAbi, functionName: 'withdraw', args: decodeAbiParameters([{ type: 'bool' }, { type: 'uint256' }], data) });
      else if (action === 4) call = encodeFunctionData({ abi: ownRulesAbi, functionName: 'setVestingSeconds', args: decodeAbiParameters([{ type: 'uint64' }], data) });
      else throw new Error('Unknown action');
      await sendKernel([{ to: snapshot.router, data: call }]); return;
    }
    const signer = await getSigner(); const nonce = await chain.readContract({ address: snapshot.router, abi: ownRulesAbi, functionName: 'nonces', args: [owner] });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await signer.signTypedData({ account: owner, domain: intentDomain(snapshot.router), types: intentTypes, primaryType: 'Intent', message: { owner, action, dataHash: keccak256(data), nonce, deadline } });
    if (snapshot.relayEnabled && nonce < 10n) {
      const response = await fetch('/api/robinhood/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner, action, data, deadline: String(deadline), signature }) });
      const result = await readApiJson(response); setHash(result.hash as Hex);
    } else {
      const simulation = await chain.simulateContract({ account: owner, address: snapshot.router, abi: ownRulesAbi, functionName: 'executeSigned', args: [owner, action, data, deadline, signature] });
      await confirmed(await signer.writeContract({ ...simulation.request, account: owner, chain: robinhoodTestnet }));
    }
  }
  async function confirmed(tx: Hex) { setHash(tx); const receipt = await chain.waitForTransactionReceipt({ hash: tx }); if (receipt.status !== 'success') throw new Error('Transaction reverted.'); }
  async function sendKernel(calls: { to: Address; data: Hex }[]) {
    if (!activeKernel) throw new Error('No active smart account.');
    const operation = await activeKernel.sendUserOperation({ callData: await activeKernel.account.encodeCalls(calls) });
    const receipt = await activeKernel.waitForUserOperationReceipt({ hash: operation, timeout: 120000 });
    // EntryPoint transaction success does NOT imply user-operation success.
    if (!receipt.success) throw new Error('Sponsored user operation failed.');
    await confirmed(receipt.receipt.transactionHash);
  }
  /** Smart account: one batched (sponsorable) user operation. Wallet: sequential, each confirmed. */
  async function sendCalls(calls: { to: Address; data: Hex }[]) {
    if (!owner) throw new Error('Sign in first.');
    if (activeKernel) { await sendKernel(calls); return; }
    const signer = await getSigner();
    for (const c of calls) {
      await chain.call({ account: owner, to: c.to, data: c.data }); // surface reverts before signing
      await confirmed(await signer.sendTransaction({ account: owner, chain: robinhoodTestnet, to: c.to, data: c.data }));
    }
  }
  function ruleData() {
    const savingsBps = Number(saved) * 100, ownershipBps = Number(owned) * 100;
    if (!Number.isInteger(savingsBps) || !Number.isInteger(ownershipBps) || savingsBps < 0 || ownershipBps < 0 || savingsBps + ownershipBps > 10000) throw new Error('Savings and ownership must total no more than 100%.');
    if (demo && !snapshot?.demoAdapter) throw new Error('Demo adapter is not deployed.');
    return encodeAbiParameters([{ type: 'uint16' }, { type: 'uint16' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'uint128' }, { type: 'bool' }], [savingsBps, ownershipBps, parseUnits(max, 6), parseUnits(daily, 6), demo ? snapshot!.demoAdapter! : zeroAddress, demo ? 10n ** 18n : 0n, true]);
  }
  async function commitment(): Promise<Hex> {
    // Plaintext is never submitted to RPC or our server. Encrypt in browser;
    // ciphertext and its key stay local. Public hash cannot conceal amounts/addresses.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(memo)));
    const digest = keccak256(toHex(sealed));
    const exported = await crypto.subtle.exportKey('jwk', key);
    localStorage.setItem(`ownpay.rh.metadata.${owner}.${digest}`, JSON.stringify({ iv: Array.from(iv), ciphertext: Array.from(sealed), key: exported }));
    return digest;
  }
  async function pay() {
    if (!snapshot || !owner || !isAddress(recipient)) throw new Error('Enter the recipient owner wallet address.');
    const raw = parseUnits(amount, 6); if (raw <= 0n) throw new Error('Amount must be positive.');
    const signer = await getSigner();
    const allowance = await chain.readContract({ address: TEST_USDG, abi: erc20Abi, functionName: 'allowance', args: [owner, snapshot.router] });
    const metadata = await commitment();
    if (activeKernel) {
      const calls = [];
      if (allowance < raw) calls.push({ to: TEST_USDG, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [snapshot.router, raw] }) });
      calls.push({ to: snapshot.router, data: encodeFunctionData({ abi: ownRulesAbi, functionName: 'pay', args: [recipient, raw, metadata] }) });
      await sendKernel(calls); return;
    }
    if (allowance < raw) await confirmed(await signer.writeContract({ account: owner, chain: robinhoodTestnet, address: TEST_USDG, abi: erc20Abi, functionName: 'approve', args: [snapshot.router, raw] }));
    const simulation = await chain.simulateContract({ account: owner, address: snapshot.router, abi: ownRulesAbi, functionName: 'pay', args: [recipient, raw, metadata] });
    await confirmed(await signer.writeContract({ ...simulation.request, account: owner, chain: robinhoodTestnet }));
  }
  async function incoming() {
    if (!snapshot || !owner) throw new Error('Sign in first.');
    const metadata = await commitment();
    if (activeKernel) { await sendKernel([{ to: snapshot.router, data: encodeFunctionData({ abi: ownRulesAbi, functionName: 'processIncoming', args: [owner, BigInt(snapshot.incoming || '0'), metadata] }) }]); return; }
    const signer = await getSigner(); const simulation = await chain.simulateContract({ account: owner, address: snapshot.router, abi: ownRulesAbi, functionName: 'processIncoming', args: [owner, BigInt(snapshot.incoming || '0'), metadata] });
    await confirmed(await signer.writeContract({ ...simulation.request, account: owner, chain: robinhoodTestnet }));
  }
  async function claim(id: bigint) {
    if (!snapshot?.vesting || !owner) throw new Error('No active vesting account.');
    const data = encodeFunctionData({ abi: rhVestingAbi, functionName: 'claim', args: [id] });
    if (activeKernel) { await sendKernel([{ to: snapshot.vesting, data }]); return; }
    const signer = await getSigner();
    await confirmed(await signer.writeContract({ account: owner, chain: robinhoodTestnet, address: snapshot.vesting, abi: rhVestingAbi, functionName: 'claim', args: [id] }));
  }
  const eligible = !!snapshot?.compliance && !snapshot.compliance[1] && Number(snapshot.compliance[0]) >= Date.now() / 1000;
  const input = (label: string, value: string, change: (v: string) => void, hint?: string) => <label className={styles.field}>{label}<input className="input" value={value} onChange={e => change(e.target.value)} />{hint && <span className={styles.fieldHint}>{hint}</span>}</label>;
  const disabled = busy || !owner || !snapshot;
  const accountExists = !!snapshot?.account && snapshot.account !== zeroAddress;
  const sections = [
    { id: 'overview', label: 'Overview' }, { id: 'automation', label: 'Automation' },
    { id: 'pay', label: 'Pay' }, { id: 'stocks', label: 'Stocks' }, { id: 'activity', label: 'Activity' },
  ] as const;
  const service = snapshot?.agentService;
  const serviceLabel = service?.state === 'online' ? 'Worker online' : service?.state === 'degraded' ? 'Worker needs attention' : service?.state === 'stale' ? 'Worker heartbeat is stale' : 'Worker not reporting';
  const serviceTone = service?.state === 'online' ? styles.service_online : service?.state === 'degraded' ? styles.service_degraded : service?.state === 'stale' ? styles.service_stale : styles.service_not_reporting;
  const metricCards = [
    ['Spendable USDG', units(snapshot?.balance), 'Wallet balance'],
    ['Savings escrow', units(snapshot?.savings), 'Redeemable by you'],
    ['Ownership reserve', units(snapshot?.reserve), 'USDG allocation'],
    ['DEMO-OWN', snapshot?.assetBalance == null ? '—' : units(snapshot.assetBalance, 18), 'Test asset · no value'],
  ];

  return <div className={styles.workbench}>
    <div className="dashboard-welcome-row">
      <div><p className="eyebrow">Robinhood Chain · Testnet</p><h1>Programmable ownership<span className="welcome-mark">.</span></h1><p className="dashboard-subtitle">Set the rules for incoming USDG, then see every payment and grant in one place.</p></div>
      <div className="dashboard-identity"><span className="identity-avatar"><OwnPayIcon name="wallet" size={21} /></span><span><strong>{owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : 'Not signed in'}</strong><small>{activeKernel ? 'Embedded smart account · testnet' : owner ? 'Signed in · testnet' : 'Sign in to use OwnRules'}</small></span>{auth}</div>
    </div>

    <div className={styles.topActions}><span className={styles.testnetPill}><span className={styles.liveDot} /> Testnet only · no monetary value</span><button className="btn" disabled={busy} onClick={() => void refresh()}><OwnPayIcon name="activity" size={16} /> Refresh</button></div>
    <p className={styles.disclaimer}>This is a Robinhood Chain testnet demo. USDG here is test currency; DEMO-OWN is not a stock, equity, or investment. Testnet addresses and activity are public.</p>
    {error && <div className={styles.alert} role="alert">{error}</div>}
    {hash && <div className={styles.success}><span>Transaction confirmed or submitted.</span><a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View receipt <OwnPayIcon name="arrow" size={15} /></a></div>}

    <div className={styles.metrics} aria-label="Account balances">{metricCards.map(([title, value, caption]) => <article className={styles.metric} key={title}><span>{title}</span><strong>{value}</strong><small>{caption}</small></article>)}</div>

    <div className={styles.tabList} role="tablist" aria-label="Robinhood testnet workspace">{sections.map(section => <button key={section.id} id={`rh-tab-${section.id}`} className={`${styles.tab}${view === section.id ? ` ${styles.tabActive}` : ''}`} role="tab" aria-selected={view === section.id} aria-controls="rh-panel" onClick={() => setView(section.id)}>{section.label}</button>)}</div>

    <section id="rh-panel" className={styles.tabPanel} role="tabpanel" aria-labelledby={`rh-tab-${view}`}>
      {view === 'overview' && <div className={styles.panelGrid}>
        <article className={`${styles.panel} ${styles.receivePanel}`}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Receive</p><h2>Your USDG account</h2></div><span className="pill pill-muted">{accountExists ? 'Ready' : 'Not created'}</span></div>
          <p className={styles.softText}>Incoming USDG lands in this purpose-limited account. The saved rule determines its split. Your existing funds in other wallets are never moved.</p>
          <div className={styles.addressBox}><span>{accountExists ? snapshot!.account : 'Create an account to receive test USDG'}</span>{accountExists && <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(snapshot!.account!)}>Copy</button>}</div>
          <div className={styles.pendingLine}><span>Pending income</span><strong>{units(snapshot?.incoming)} USDG</strong></div>
          <div className={styles.buttonRow}><button className="btn btn-primary" disabled={disabled || accountExists} onClick={() => void run(() => signed(0, '0x'))}>Create receive account</button><button className="btn" disabled={disabled || !eligible || !snapshot?.rule?.[7] || !Number(snapshot?.incoming)} onClick={() => void run(incoming)}>Process pending income</button></div>
          <p className={styles.fieldHint}>Processing is a wallet-signed transaction and currently requires testnet ETH for gas.</p>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Agent service</p><h2>Income automation</h2></div><span className={`${styles.serviceBadge} ${serviceTone}`}><span />{serviceLabel}</span></div>
          <p className={styles.softText}>The separate VPS worker watches receive accounts. It cannot move funds unless you saved an enabled rule, passed the local test policy, and explicitly delegated to its address.</p>
          <dl className={styles.serviceDetails}><div><dt>Worker mode</dt><dd>{service?.mode || '—'}</dd></div><div><dt>Last heartbeat</dt><dd>{service?.updatedAt ? new Date(service.updatedAt).toLocaleString() : 'No heartbeat'}</dd></div><div><dt>Tracked accounts</dt><dd>{service?.trackedAccounts ?? '—'}</dd></div><div><dt>Pending accounts</dt><dd>{service?.pendingAccounts ?? '—'}</dd></div></dl>
          <p className={styles.fieldHint}>{service?.mode === 'observe' ? 'Observe mode only: the worker detects eligible income but does not sign transactions.' : service?.mode === 'execute' ? 'Execute mode is configured on the testnet worker. Your delegation and saved limits still apply.' : 'The dashboard cannot see a worker heartbeat yet; automation is not confirmed running.'}</p>
          {service?.lastCycleOk === false && <p className={styles.inlineWarning}>The last worker cycle reported an error. Check the VPS service logs before relying on automation.</p>}
          <div className={styles.workerSetup}><p className={styles.fieldHint}>Current account mode: {activeKernel ? 'ZeroDev Kernel testnet smart account' : 'Signer wallet'}. Using a smart account changes the receiving address; funds do not move automatically.</p><div className={styles.buttonRow}><button className="btn" disabled={busy || !signerOwner || !process.env.NEXT_PUBLIC_ROBINHOOD_ZERODEV_RPC} onClick={() => void run(async () => { const signer = await getSigner(); setKernel(await createRobinhoodKernel(signer)); setKernelSigner(signerOwner); })}>Use smart account</button>{activeKernel && <button className="btn btn-ghost" onClick={() => { setKernel(null); setKernelSigner(undefined); }}>Use signer wallet</button>}</div></div>
        </article>
      </div>}

      {view === 'automation' && <div className={styles.panelGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Your rule</p><h2>Choose the split</h2></div><span className="pill pill-muted">Version {snapshot?.rule?.[6] || '—'}</span></div>
          <p className={styles.softText}>Every eligible incoming payment is split according to these percentages. The saved maximum and daily cap apply to the whole payment.</p>
          <div className={styles.fieldGrid}>{input('Savings %', saved, setSaved)}{input('Ownership %', owned, setOwned)}{input('Maximum payment · USDG', max, setMax)}{input('Daily cap · USDG', daily, setDaily)}</div>
          <div className={styles.splitBar}><span>Spendable <strong>{100 - Number(saved) - Number(owned)}%</strong></span><span>Savings <strong>{saved}%</strong></span><span>Ownership <strong>{owned}%</strong></span></div>
          <label className={styles.checkboxRow}><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} /> <span><strong>Use DEMO-OWN adapter</strong><small>No-value demonstration token only. Leave off to keep the ownership allocation as withdrawable USDG reserve.</small></span></label>
          <p className={styles.fieldHint}>Saving a new rule revokes the previous agent delegation; authorize it again if you still want automation.</p>
          <button className="btn btn-primary" disabled={disabled} onClick={() => void run(() => signed(1, ruleData()))}>Review and save rule</button>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Permissions</p><h2>Agent access</h2></div><span className="pill pill-muted">Owner controlled</span></div>
          <p className={styles.softText}>The agent may only split pending USDG under your saved rule, approved adapter, and spending caps. It cannot choose a recipient or run arbitrary transactions.</p>
          <div className={styles.permissionBox}><span>Local test policy</span><strong>{eligible ? 'Allowed' : 'Not authorized or expired'}</strong><small>This is not verified KYC or a sanctions screening service. A test-policy administrator must approve payer and recipient.</small></div>
          <div className={styles.permissionBox}><span>Delegated agent</span><strong className={styles.mono}>{snapshot?.delegation?.[0] || 'None'}</strong><small>{snapshot?.delegation ? `Expires ${new Date(Number(snapshot.delegation[1]) * 1000).toLocaleString()}` : 'Not currently authorized'}</small></div>
          <div className={styles.buttonRow}><button className="btn btn-primary" disabled={disabled || !snapshot?.agent || !snapshot?.rule?.[7]} onClick={() => void run(() => signed(2, encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], [snapshot!.agent!, BigInt(Math.floor(Date.now() / 1000) + 86400)])))}>Authorize for 24 hours</button><button className="btn" disabled={disabled} onClick={() => void run(() => signed(2, encodeAbiParameters([{ type: 'address' }, { type: 'uint64' }], [zeroAddress, 0n])))}>Revoke</button></div>
          <hr className="divide" />
          <div className={styles.vestingBlock}><h3>Ownership vesting</h3><p className={styles.fieldHint}>Vesting applies to demo assets, not to the USDG reserve. Current schedule: {Number(snapshot?.vestingSeconds || 0) / 86400} days.</p><div className={styles.buttonRow}>{input('Vesting days · 0–365', vestingDays, setVestingDays)}<button className="btn" disabled={disabled || !snapshot?.rule?.[6]} onClick={() => void run(() => signed(4, encodeAbiParameters([{ type: 'uint64' }], [BigInt(Math.round(Number(vestingDays) * 86400))])))}>Save schedule</button></div></div>
        </article>
      </div>}

      {view === 'pay' && <div className={styles.panelGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Send test funds</p><h2>Pay with USDG</h2></div><span className="pill pill-muted">Robinhood testnet</span></div>
          <div className={styles.formStack}>{input('Recipient owner wallet', recipient, setRecipient, 'Paste the recipient’s Robinhood testnet owner address.')}{input('Amount · test USDG', amount, setAmount)}{input('Note', memo, setMemo, 'Encrypted in this browser before submission; its commitment is public.')}</div>
          <div className={styles.notice}>The first payment may require an exact USDG approval. Payment and approval currently require testnet ETH; rule sponsorship does not cover token approvals.</div>
          <button className="btn btn-primary" disabled={disabled} onClick={() => void run(pay)}>Review in wallet and pay</button>
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Receive</p><h2>Share your payment link</h2></div><OwnPayIcon name="send" size={22} /></div>
          <p className={styles.softText}>Create a link that opens this testnet workspace with your owner address and an optional amount prefilled. Recipients still review and sign in their own wallet.</p>
          <button className="btn" disabled={!owner} onClick={() => { setLink(`${window.location.origin}/robinhood?to=${owner}&amount=${encodeURIComponent(amount)}`); }}>Create receive link</button>
          {link && <div className={styles.shareLink}><a href={link}>{link}</a><button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(link)}>Copy link</button></div>}
          <hr className="divide" />
          <h3>Withdraw your reserves</h3><p className={styles.fieldHint}>No lockup or yield is represented here. Withdrawals need your wallet signature and testnet gas.</p>
          <div className={styles.buttonRow}><button className="btn" disabled={disabled || !Number(snapshot?.savings)} onClick={() => void run(() => signed(3, encodeAbiParameters([{ type: 'bool' }, { type: 'uint256' }], [false, BigInt(snapshot!.savings!)])))}>Withdraw savings</button><button className="btn" disabled={disabled || !Number(snapshot?.reserve)} onClick={() => void run(() => signed(3, encodeAbiParameters([{ type: 'bool' }, { type: 'uint256' }], [true, BigInt(snapshot!.reserve!)])))}>Withdraw ownership reserve</button></div>
        </article>
      </div>}

      {view === 'stocks' && <RobinhoodStocks owner={owner} disabled={disabled} run={run} sendCalls={sendCalls} />}
      {view === 'activity' && <div className={styles.panelGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Onchain history</p><h2>Payment receipts</h2></div><span className="pill pill-muted">{snapshot?.receipts?.length ?? 0} loaded</span></div>
          {snapshot?.historyWarning && <p className={styles.inlineWarning}>{snapshot.historyWarning}</p>}
          {!snapshot?.receipts?.length ? <div className={styles.emptyState}>No payment receipts in the loaded history window.</div> : <div className={styles.activityList}>{snapshot.receipts.map(r => <article className={styles.activityItem} key={r.hash + r.id}><div className={styles.activityTitle}><a href={`${explorer}/tx/${r.hash}`} target="_blank" rel="noreferrer">Receipt #{r.id} <OwnPayIcon name="arrow" size={14} /></a><span>{units(r.amount)} USDG</span></div><p>{units(r.spendable)} spendable · {units(r.saved)} savings · {units(r.ownership)} ownership</p><small className={styles.mono}>Note commitment: {r.metadataCommitment}</small></article>)}</div>}
        </article>
        <article className={styles.panel}>
          <div className={styles.panelHeading}><div><p className="eyebrow">Ownership</p><h2>Incoming vested grants</h2></div><span className="pill pill-muted">{snapshot?.grantCount || '0'} total</span></div>
          <p className={styles.softText}>Grants load automatically for the signed-in owner. There is no separate claim link. Only DEMO-OWN test grants are supported here.</p>
          {!snapshot?.grants?.length ? <div className={styles.emptyState}>No vested grants received yet.</div> : <div className={styles.activityList}>{snapshot.grants.map(g => <article className={styles.activityItem} key={g.id}><div className={styles.activityTitle}><strong>Grant #{g.id} · {g.asset === snapshot.demoAsset ? 'DEMO-OWN' : g.asset}</strong><span>{units(g.claimable, 18)} claimable</span></div><p>{units(g.total, 18)} total · {units(g.released, 18)} claimed</p><small>Starts {new Date(Number(g.start) * 1000).toLocaleString()} · finishes {new Date(Number(g.end) * 1000).toLocaleString()}</small><button className="btn" disabled={disabled || !Number(g.claimable)} onClick={() => void run(() => claim(BigInt(g.id)))}>Claim vested units</button></article>)}</div>}
        </article>
      </div>}
    </section>
    <footer className={styles.pageFooter}><Link href="/app">Back to Base dashboard</Link><a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">Official Robinhood testnet faucet <OwnPayIcon name="arrow" size={14} /></a></footer>
  </div>;
}
