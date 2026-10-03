// Read-only HTTP smoke checks. No wallet login, signature or transaction.
const origin = process.env.OWNPAY_SMOKE_ORIGIN || 'http://127.0.0.1:3104';
const checks = [];
for (const route of ['/robinhood', '/', '/app', '/pay', '/portfolio', '/automation']) {
  const response = await fetch(new URL(route, origin));
  if (response.status !== 200) throw new Error(`${route}: HTTP ${response.status}`);
  const html = await response.text();
  if (!html.includes('_next/static/')) throw new Error(`${route}: static asset references missing`);
  if (route === '/robinhood' && !html.includes('Robinhood Chain Testnet')) throw new Error('Testnet label missing');
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(match => match[1]))];
  for (const asset of assets) {
    const r = await fetch(new URL(asset.replaceAll('&amp;', '&'), origin));
    if (!r.ok) throw new Error(`${route}: static asset HTTP ${r.status}`);
    if (r.headers.get('content-type')?.includes('text/html')) throw new Error(`${route}: asset returned HTML instead of a static file`);
    await r.body?.cancel();
  }
  checks.push({ route, status: response.status, assetsChecked: assets.length });
}
const status = await fetch(new URL('/api/robinhood/status', origin));
const body = await status.json();
if (status.status === 503) {
  if (!body.error?.includes('not deployed/configured')) throw new Error(`Unexpected deployment failure: ${body.error}`);
  checks.push({ route: '/api/robinhood/status', status: 503, configuration: 'Undeployed state explicitly reported; not financial success' });
} else if (status.ok && body.chainId === 46630) checks.push({ route: '/api/robinhood/status', status: status.status, chainId: body.chainId });
else throw new Error('Unexpected testnet status response');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), origin, checks, scope: 'Unauthenticated HTTP and static assets only; not wallet/end-to-end verification' }, null, 2));
