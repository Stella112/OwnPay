// Public smoke test: page rendering, static CSS/JS and authentication boundary.
const origin = process.argv[2] || "https://ownpay.online";
for (const path of ["/", "/app", "/portfolio", "/automation"]) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20000) });
  console.log(`${path}: ${response.status}`);
  if (!response.ok) throw new Error(`PAGE_FAILED:${path}`);
  const html = await response.text();
  const assets = [...html.matchAll(/(?:href|src)="(\/_next\/static\/[^"?]+\.(?:css|js))(?:\?[^\"]*)?"/g)].map((match) => match[1]);
  if (!assets.some((asset) => asset.endsWith(".css"))) throw new Error(`CSS_MISSING:${path}`);
  for (const asset of new Set(assets)) {
    const loaded = await fetch(new URL(asset, origin), { method: "HEAD", signal: AbortSignal.timeout(10000) });
    if (!loaded.ok) throw new Error(`ASSET_FAILED:${loaded.status}:${asset}`);
  }
  console.log(`  ${new Set(assets).size} static assets OK`);
}
const auth = await fetch(new URL("/api/automation?wallet=0x0000000000000000000000000000000000000001", origin));
console.log(`unauthenticated automation request: ${auth.status}`);
if (auth.status !== 401) throw new Error("AUTH_BOUNDARY_FAILED");
