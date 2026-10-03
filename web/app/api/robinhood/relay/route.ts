import { createWalletClient, http, isAddress, isHex, keccak256, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { intentDomain, intentTypes, ownRulesAbi, robinhoodTestnet } from '@/lib/robinhood';
import { rhPublic, verifyRhDeployment } from '@/lib/robinhood-server';
export const runtime = 'nodejs';
let busy = false;
export async function POST(request: Request) {
  if (busy) return Response.json({ error: 'Sponsor busy; retry shortly.' }, { status: 429 });
  busy = true;
  try {
    // No generic target/calldata relay. Owner signatures are independently verified
    // and simulated against the only configured router on chain 46630.
    const key = process.env.ROBINHOOD_RELAY_PRIVATE_KEY;
    if (!key || !isHex(key)) return Response.json({ error: 'Testnet sponsor not configured; use wallet-paid execution.' }, { status: 503 });
    if (Number(request.headers.get('content-length') || 0) > 8192) return Response.json({ error: 'Request too large' }, { status: 413 });
    const raw = await request.text(); if (raw.length > 8192) return Response.json({ error: 'Request too large' }, { status: 413 });
    const b = JSON.parse(raw);
    if (!isAddress(b.owner) || !Number.isInteger(b.action) || b.action < 0 || b.action > 4 || !isHex(b.data) || b.data.length > 2048 || !isHex(b.signature) || b.signature.length !== 132 || !/^\d{1,12}$/.test(String(b.deadline))) return Response.json({ error: 'Invalid intent' }, { status: 400 });
    const allowed = (process.env.ROBINHOOD_SPONSORED_OWNERS || '').toLowerCase().split(',');
    if (!allowed.includes(b.owner.toLowerCase())) return Response.json({ error: 'This test account is not eligible for sponsorship.' }, { status: 403 });
    const config = await verifyRhDeployment();
    const nonce = await rhPublic.readContract({ address: config.router, abi: ownRulesAbi, functionName: 'nonces', args: [b.owner] });
    if (nonce >= 10n) return Response.json({ error: 'The first-ten-intents sponsorship limit has been reached.' }, { status: 403 });
    const deadline = BigInt(b.deadline); const now = BigInt(Math.floor(Date.now() / 1000));
    if (deadline <= now || deadline > now + 3600n) return Response.json({ error: 'Expired intent' }, { status: 400 });
    if (!await verifyTypedData({ address: b.owner, domain: intentDomain(config.router), types: intentTypes, primaryType: 'Intent', message: { owner: b.owner, action: b.action, dataHash: keccak256(b.data), nonce, deadline }, signature: b.signature })) return Response.json({ error: 'Wrong signature' }, { status: 401 });
    const sponsor = privateKeyToAccount(key);
    const simulation = await rhPublic.simulateContract({ account: sponsor, address: config.router, abi: ownRulesAbi, functionName: 'executeSigned', args: [b.owner, b.action, b.data, deadline, b.signature] });
    const wallet = createWalletClient({ account: sponsor, chain: robinhoodTestnet, transport: http(process.env.ROBINHOOD_TESTNET_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0]) });
    const hash = await wallet.writeContract({ ...simulation.request, gas: 1500000n });
    const receipt = await rhPublic.waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (receipt.status !== 'success') throw new Error('Sponsored transaction reverted.');
    return Response.json({ hash, status: 'confirmed', chainId: 46630 });
  } catch { return Response.json({ error: 'Intent rejected or sponsor unavailable. No success is reported without a confirmed receipt.' }, { status: 422 }); }
  finally { busy = false; }
}
