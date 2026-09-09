# OwnPay — VPS deployment (Docker + Caddy)

Runs the OwnPay web app on a VPS behind Caddy, which handles automatic HTTPS once
your domain is pointed. The app holds **no secrets** — the only config is the public
contract/token addresses. Your deployer private key is never on the VPS.

Files:
- `web/Dockerfile` — multi-stage build → Next.js standalone runner
- `deploy/docker-compose.yml` — `web` + `caddy` services
- `deploy/Caddyfile` — reverse proxy + auto-HTTPS
- `deploy/.env.example` — public config template

## Shared VPS mode (recommended beside Apex)

The default `docker-compose.yml` below is for a fresh VPS: its Caddy service
binds ports 80 and 443. **Do not use that file on a VPS where Apex already owns
the reverse proxy.**

For the shared server, use the isolated web-only stack instead:

```bash
cd /opt/ownpay/deploy
cp .env.example .env
# Set NEXT_PUBLIC_STOCK_VESTING_ADDRESS after the contract is deployed.
# Keep OWNPAY_PORT=3102 unless a read-only port check shows it is occupied.
bash ./deploy-shared.sh
```

This uses a separate Compose project (`ownpay`), starts only OwnPay's web
container, and binds it to `127.0.0.1:3102` by default. It does not stop, restart,
or reconfigure Apex. The existing VPS reverse proxy must route the OwnPay
hostname to that loopback port. For a host-installed Caddy, the route is:

```caddy
ownpay.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3102
}
```

Validate the proxy configuration using its existing service's normal test/reload
procedure before reloading it. If Apex's proxy runs inside Docker, use the
existing proxy network or its host-gateway mechanism instead of assuming that
`127.0.0.1` inside the proxy container reaches the host.

---

## 0. Prerequisites (on the VPS)

- Ubuntu 22.04+ (or any Docker-capable Linux), a non-root sudo user.
- Ports **80** and **443** open to the internet.
- Docker Engine + Compose plugin. If not installed:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out/in so the group applies
```

Open the firewall (if using ufw):

```bash
sudo ufw allow 80,443/tcp && sudo ufw reload
```

## 1. Get the code

```bash
git clone <your-repo-url> ownpay && cd ownpay/deploy
cp .env.example .env
```

## 2. Configure `deploy/.env`

- `NEXT_PUBLIC_STOCK_VESTING_ADDRESS` — the deployed StockVesting address (see
  `docs/DEPLOY.md`). Leave blank to stand up the site now; the app will honestly
  show "Not configured yet" until you set it and rebuild.
- `OWNPAY_DOMAIN` — leave as `:80` for now (HTTP on the IP). Set it to your hostname
  once DNS is pointed (step 5) for automatic HTTPS.

Token addresses are already baked into the app; you don't need to set them.

## 3. Build and start

```bash
docker compose up -d --build
```

First build pulls Node/Caddy images and runs `next build` (needs internet). When it
finishes:

```bash
docker compose ps
docker compose logs -f web    # Ctrl-C to stop tailing
```

## 4. Verify

Visit `http://<your-vps-ip>/`. You should see OwnPay. `/pay`, `/gift`, `/tip`, and
`/claim/0` should all load.

## 5. Add your domain (automatic HTTPS)

1. Point an **A** record (and AAAA if you have IPv6) for your hostname at the VPS IP.
2. Wait for DNS to propagate (`dig +short your.domain` returns the VPS IP).
3. Set it in `deploy/.env`:

   ```bash
   OWNPAY_DOMAIN=ownpay.yourdomain.com
   ```

4. Recreate Caddy (no rebuild needed for a domain change):

   ```bash
   docker compose up -d
   ```

Caddy obtains and auto-renews a Let's Encrypt certificate. Visit
`https://ownpay.yourdomain.com/`.

## 6. Set the contract address later (requires a rebuild)

`NEXT_PUBLIC_*` values are baked into the app at build time, so after you deploy the
contract and put its address in `deploy/.env`:

```bash
docker compose up -d --build
```

## Updating the app

```bash
git pull
docker compose up -d --build
```

## Operations

- Logs: `docker compose logs -f`
- Restart: `docker compose restart`
- Stop: `docker compose down` (keeps TLS certs in the `caddy_data` volume)
- Resource use is small; a 1 vCPU / 1 GB VPS is enough to serve the app.

## Notes / security

- No private keys or secrets live on the VPS. `deploy/.env` holds only public
  `NEXT_PUBLIC_*` values and the Caddy hostname; it is gitignored regardless.
- The `web` container publishes no host port — all traffic goes through Caddy.
- Wallets prefer a secure (HTTPS) context, so finish step 5 before sharing the link.
