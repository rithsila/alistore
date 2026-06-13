# Production deploy — Vercel storefront + Medusa on Proxmox + KHPAY KHQR

This is the deploy runbook for the **KHPAY-enabled** configuration:

- **Storefront** on **Vercel**
- **Medusa backend** on the **Proxmox VM in Cambodia** (`alistore-backend`, 172.16.18.20)
- **Postgres + Redis** on the **current Proxmox box** (`alistore-db`, 172.16.18.10)
- **Payments:** KHQR via **KHPAY** (the active rail) + Cash-on-Delivery
- **Backend exposure:** **Tailscale Funnel** (stable public HTTPS, no domain needed)
- **Admin access:** `/app` behind **MFA** on the Funnel URL; **Tailscale mesh** (MikroTik subnet router) for private SSH/DB/management

It is the production-leaning sibling of [`uat-deploy.md`](./uat-deploy.md). That doc
is COD-only and explains the topology, the per-machine commands, and the
reasoning (why only the backend gets a tunnel, how the storefront proxies
`/store/auth/*` and invoice). **Read `uat-deploy.md` Phases 0–6 for the full
detail** — this file is the same flow with the KHPAY + exposure deltas called out.

> Run commands on the machine indicated. **Never commit a real `.env`** — only
> placeholder templates (`*.env.template`) belong in git.

---

## Decisions baked into this runbook

| Decision | Choice | Consequence |
|----------|--------|-------------|
| Database | Current Proxmox Postgres (`172.16.18.10`) | No migration; reuse the dev DB + publishable key |
| Backend host | Proxmox LXC `172.16.18.20` | Same as `uat-deploy.md` Phase 1 |
| Payments | **KHPAY KHQR** enabled (+ COD) | Configure `KHPAY_*`; add a paid-flip smoke test |
| Public exposure | **Tailscale Funnel** (backend box) | Stable public `*.ts.net` HTTPS for Vercel — no domain, no URL churn |
| Admin access | `/app` behind **MFA** + **Tailscale mesh** (MikroTik subnet router) | Funnel publishes all of Medusa; MFA gates `/app`. Mesh = private SSH/DB/mgmt path |

**Why Tailscale Funnel:** Vercel's servers call the backend **server-side over the
public internet**, and with KHQR payments that hop **must be HTTPS with a valid
cert**. Vercel's Node `fetch` rejects self-signed certs, and you can't get a
trusted (Let's Encrypt) cert for a *bare IP* — you need a hostname. **Tailscale
Funnel** gives the backend box a stable, publicly-resolvable
`https://alistore-backend.<tailnet>.ts.net` name with a valid TLS cert, reachable
from anywhere (including Vercel) — and unlike a Cloudflare quick tunnel the URL
**never churns**. **KHPAY is polling-only (no inbound webhook)**, so nothing else
needs to reach your IP.

**Why a mesh too:** the **MikroTik runs Tailscale as a subnet router** (advertising
`172.16.18.0/24`), giving your own devices a **private** path to the DB box, SSH,
and the backend with no public exposure. Funnel publishes the whole Medusa server,
so `/app` is reachable publicly **behind MFA**; if you later want `/app` fully off
the public internet, front it with Caddy (see the admin-isolation note in Layer 2).
The mesh stays regardless.

---

## ⚠️ Security gates — not optional

| Gate | Why |
|------|-----|
| **`NODE_ENV=production`** in the backend `.env` | Disables every dev-only loopback escape (Bakong/FB/Google/KHPAY mock seams) and turns on the production SSRF boot-check. |
| **Admin MFA (TOTP) + ≥16-char password** | Funnel publishes the whole backend, so `/app` is reachable publicly — **MFA is the access control**. Non-negotiable before sharing any URL. |
| **Real secrets only in `.env` on the VM** | Never in git, never in the Vercel repo. |
| **Real `KHPAY_BASE_URL` only** (`https://khpay.site/api/v1`) | It's SSRF-allowlisted to `khpay.site` and validated at boot; a wrong host refuses to start. |
| **Never set `KHPAY_DEV_ALLOW_LOOPBACK` in prod** | `NODE_ENV=production` makes it inert anyway, but leave it unset. |
| **Leave `BAKONG_*` / `PAYWAY_*` / `FB_*` / `GOOGLE_*` unset** | Not used in this configuration. Setting `BAKONG_PROXY_URL` without `BAKONG_PROXY_ALLOWED_HOSTS` refuses to boot in prod by design. |

---

## Pre-flight (before touching the VMs)

1. **KHPAY account** — at `https://khpay.site/dashboard/settings`, **configure
   Settings → Bakong first** (account_id, merchant name, city), then copy your
   real API key (`ak_…`). Nothing works until the Bakong config is done on their side.
2. **R2 credentials** ready (endpoint, bucket, access key/secret) — same as dev.
3. **Telegram** bot token + private chat id (from @BotFather).
4. Your **git remote URL** and the **publishable key** (`pk_a39b79c7…`, valid
   because UAT/prod reuse the same DB).

---

## Layer 1 — Database box (`alistore-db`, 172.16.18.10)

Already provisioned in [`postgres-proxmox-lxc-setup.md`](./postgres-proxmox-lxc-setup.md)
(Postgres + Redis; `pg_hba.conf` already allow-lists `172.16.18.20`). If it's a
clean Proxmox, build it from that guide first.

**Back up before anything else** (and before every future migration):

```bash
sudo -u postgres pg_dump medusa > /root/medusa-backup-$(date +%F).sql
```

Confirm reachability from the backend box (`uat-deploy.md` Phase 1 has the checks):

```bash
psql "postgres://db-admin:<pwd>@172.16.18.10:5432/medusa" -c '\q'   # connects
redis-cli -u "redis://:<pwd>@172.16.18.10:6379" ping                # PONG
```

---

## Layer 2 — Backend box (`alistore-backend`, 172.16.18.20)

Follow `uat-deploy.md` Phases 1–4. Create the CT (Ubuntu, 20 GB / 2 cores /
2048 MB, static IP `172.16.18.20/24`), install Node 20 LTS + git, then:

```bash
mkdir -p /opt && cd /opt
git clone <your-repo-url> alistore
cd /opt/alistore/backend
npm ci
```

Create `/opt/alistore/backend/.env` (stays on the VM, never in git):

```dotenv
NODE_ENV=production            # makes all dev-loopback escapes inert

# --- Data (the alistore-db box) ---
DATABASE_URL=postgres://db-admin:<pwd>@172.16.18.10:5432/medusa
REDIS_URL=redis://:<pwd>@172.16.18.10:6379

# --- Secrets (generate fresh; backend fails closed without them) ---
JWT_SECRET=                    # openssl rand -base64 48
COOKIE_SECRET=                 # openssl rand -base64 48

# --- CORS / origins (fill the real Vercel host after the Vercel step, then restart) ---
STORE_CORS=https://<your>.vercel.app
ADMIN_CORS=https://alistore-backend.<tailnet>.ts.net          # admin over the tailnet
AUTH_CORS=https://alistore-backend.<tailnet>.ts.net,https://<your>.vercel.app
TRUSTED_PROXY_COUNT=1          # Tailscale Funnel = 1 proxy hop in front

# --- R2 product images (copy your working dev values) ---
S3_FILE_URL=https://pub-1dedea628ee74e9399932493df26e28e.r2.dev
S3_REGION=auto
S3_ENDPOINT=                   # https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=ali-store-products
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# --- Business config ---
USD_KHR_RATE=4100
DELIVERY_FEE=1
FREE_DELIVERY_THRESHOLD=5
LOW_STOCK_THRESHOLD=5

# --- Telegram order alerts ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# --- KHPAY (active KHQR rail) ---
KHPAY_BASE_URL=https://khpay.site/api/v1
KHPAY_API_KEY=ak_...           # the REAL key from khpay.site
# KHPAY_EXPIRES_MINUTES=20     # optional; defaults to 20 (== stock-reservation TTL)
# DO NOT set KHPAY_DEV_ALLOW_LOOPBACK in production

# --- Leave UNSET: BAKONG_* / PAYWAY_* / FB_* / GOOGLE_* ---
```

Build, migrate, and prepare the production artifact:

```bash
cd /opt/alistore/backend
npx medusa build                 # → .medusa/server (server + admin)
npx medusa db:migrate            # idempotent; schema already applied
cp .env .medusa/server/.env
cd .medusa/server && npm ci --omit=dev && cd ../..
```

Optional foreground smoke test (Ctrl-C after a clean boot — you want the **Redis**
modules loading, not "a fake redis instance will be used"):

```bash
cd /opt/alistore/backend/.medusa/server && npm run start
```

### Process manager + Tailscale exposure

Start the backend under PM2 (the ecosystem file runs **only** the Medusa server —
Tailscale handles exposure, not PM2):

```bash
npm install -g pm2
cd /opt/alistore/backend
pm2 start deploy/ecosystem.config.cjs
pm2 save                        # remember the process list
pm2 startup                     # run the printed line → survives VM reboot
```

Install Tailscale and expose the box:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --hostname=alistore-backend       # open the auth URL, approve in the admin console

# Public, stable HTTPS for Vercel (valid .ts.net cert, so Secure cookies work):
tailscale funnel --bg 9000
```

> **First enable it for your tailnet** in the admin console: DNS → **enable HTTPS
> certificates**; Access controls → add the **`funnel`** node attribute. Confirm
> with `tailscale funnel status`.

Your stable public backend URL is `https://alistore-backend.<tailnet>.ts.net`.

> **Admin-isolation note.** `tailscale funnel --bg 9000` publishes the *whole*
> Medusa server, so `/app` is reachable publicly **behind MFA** (the same control
> the old quick tunnel relied on — now with a stable URL and no third party).
> That's the posture this runbook uses. If you later want `/app` **off** the public
> internet entirely, front Medusa with a small **Caddy** reverse proxy that funnels
> only `/store/*` (deny `/app` + `/admin`) and reach the admin privately over the
> mesh — more moving parts, stronger posture. The **MikroTik subnet-router mesh**
> already gives you a private path to the box for SSH/DB either way.

### Admin user + MFA

```bash
cd /opt/alistore/backend
npx medusa user -e you@alistore.com -p '<strong 16+ char password>'
```

Open `https://alistore-backend.<tailnet>.ts.net/app`, log in, and **enable TOTP
MFA** in account settings (Medusa v2.15.3) **before you share anything** — the
Funnel makes `/app` reachable publicly, so MFA is the gate. (For private-only admin,
front Medusa with Caddy and reach it over the mesh — see Layer 2's admin-isolation
note.)

The `.ts.net` host is stable, so `ADMIN_CORS` / `AUTH_CORS` (already set to it in
the `.env` block above) never change. After any `.env` edit:

```bash
cp .env .medusa/server/.env
pm2 restart alistore-backend
```

---

## Layer 3 — Storefront on Vercel

`uat-deploy.md` Phase 5 / [`vercel-deploy.md`](./vercel-deploy.md). Import the repo,
**Root Directory = `storefront`**, region **Singapore (`sin1`)**. Env vars:

| Key | Value |
|-----|-------|
| `MEDUSA_BACKEND_URL` | `https://alistore-backend.<tailnet>.ts.net` (stable Funnel URL) |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | `pk_a39b79c7bafef5ce3adcf5a6a35faa42f686ffaf55ef7fcce2322e12f3c6b989` |
| `NEXT_PUBLIC_BASE_URL` | `https://<your>.vercel.app` *(set after first deploy, then redeploy)* |
| `NEXT_PUBLIC_DEFAULT_REGION` | `kh` |
| `NEXT_PUBLIC_USD_KHR_RATE` | `4100` |
| `REVALIDATE_SECRET` | a fresh random string |

Deploy → copy the assigned `*.vercel.app` host into `NEXT_PUBLIC_BASE_URL` and
**redeploy** (used for invoice/OG absolute links). Also put that host into the
backend `.env` `STORE_CORS` + `AUTH_CORS`, then `pm2 restart alistore-backend`.

No `next.config.js` change is needed — on Vercel the storefront *is* the host, so
Server-Action origins already match. Product images load from R2 (allow-listed in
`next.config.js`), fetched directly by Vercel.

---

## Layer 4 — Smoke test (phone, on cellular, against the Vercel URL)

- [ ] Home + category browse renders; product images load (R2).
- [ ] PDP: variant (size + color) selection works; "N left" stock note shows.
- [ ] Add to cart → totals correct (USD + KHR rounded to whole riel).
- [ ] **"Pay with KHQR"** → KHQR renders → pay from a Bakong app → status flips to
      paid → order places (stock reserved, then committed on paid). *(KHPAY live)*
- [ ] COD checkout: name + Cambodia phone (`0…`/`+855…`) + address → order places.
- [ ] **Telegram alert** arrives in your private chat with full order details
      (order #, items, total USD+KHR, payment method, name/phone/address).
- [ ] Order confirmation → invoice link opens (`/store/orders/:id/invoice?token=`),
      renders HTML, **no VAT line** (VAT off in v1).
- [ ] Admin (`…/app`, MFA): the order is visible; sales + stock reports load; a
      manual stock-in (+N) shows one ledger row and bumps the PDP "N left".

---

## Operating notes

- **Logs / exposure:** `pm2 logs alistore-backend` · `tailscale status` · `tailscale funnel status`
- **Restart after an `.env` change:** edit `.env` → `cp .env .medusa/server/.env`
  → `pm2 restart alistore-backend`
- **Update to new code:**
  ```bash
  cd /opt/alistore/backend && git pull && npm ci \
    && npx medusa build && npx medusa db:migrate \
    && cp .env .medusa/server/.env \
    && (cd .medusa/server && npm ci --omit=dev) \
    && pm2 restart alistore-backend
  ```
- **DB backup before any migration:** on the DB box,
  `sudo -u postgres pg_dump medusa > /root/medusa-backup-$(date +%F).sql`

### No more URL churn

The Funnel hostname `https://alistore-backend.<tailnet>.ts.net` is **stable across
reboots** — Tailscale persists the serve/funnel config in the `tailscaled` service.
Set `MEDUSA_BACKEND_URL` in Vercel and `ADMIN_CORS`/`AUTH_CORS` in the backend
`.env` **once**; they don't change. (This is the main win over the old Cloudflare
quick tunnel, whose URL rotated on every `cloudflared` restart.) Inspect exposure
any time with `tailscale status` and `tailscale funnel status`.

### When you get a domain (optional — your own hostname instead of `*.ts.net`)

Tailscale Funnel already gives you a stable HTTPS URL, so a domain is now optional.
If you want your own hostname on the public hop:

1. Point `api.<domain>` (A record) at your public IP.
2. Run **Caddy** on the backend box for automatic Let's Encrypt TLS →
   `localhost:9000`, replacing the Funnel as the public edge.
3. Set `MEDUSA_BACKEND_URL=https://api.<domain>` in Vercel **once**.
4. Switch R2 to `img.<domain>` (`S3_FILE_URL` + `next.config.js` host) once DNS exists.

The **MikroTik subnet-router mesh stays** either way — it's your private admin/SSH
path, independent of how the public `/store` hop is served.
