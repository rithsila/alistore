# Production deploy — Vercel storefront + Medusa on Proxmox + KHPAY KHQR

This is the deploy runbook for the **KHPAY-enabled** configuration:

- **Storefront** on **Vercel**
- **Medusa backend** on the **Proxmox VM in Cambodia** (`alistore-backend`, 172.16.18.20)
- **Postgres + Redis** on the **current Proxmox box** (`alistore-db`, 172.16.18.10)
- **Payments:** KHQR via **KHPAY** (the active rail) + Cash-on-Delivery
- **Backend exposure:** Cloudflare **quick tunnel** (no domain yet)

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
| Public exposure | **Cloudflare quick tunnel** | No domain → no trusted TLS for a bare public IP; the tunnel provides HTTPS |

**Why the quick tunnel even though you have a public IP:** Vercel's servers call
the backend **server-side over the public internet**, and with KHQR payments that
hop **must be HTTPS with a valid cert**. Vercel's Node `fetch` rejects self-signed
certs, and you can't get a trusted (Let's Encrypt) cert for a *bare IP* — you need
a hostname. Until a domain exists, the Cloudflare quick tunnel is the HTTPS edge.
**KHPAY is polling-only (no inbound webhook)**, so nothing external needs to reach
your IP — the tunnel is sufficient. When a domain lands, switch to the public IP +
Caddy (see the last section).

---

## ⚠️ Security gates — not optional

| Gate | Why |
|------|-----|
| **`NODE_ENV=production`** in the backend `.env` | Disables every dev-only loopback escape (Bakong/FB/Google/KHPAY mock seams) and turns on the production SSRF boot-check. |
| **Admin MFA (TOTP) + ≥16-char password** before the tunnel goes public | The tunnel exposes `/app` (admin) to the internet. With a quick tunnel you cannot path-restrict, so MFA is your only control. |
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

# --- CORS / origins (fill the real hosts after Phases 3 + 5, then pm2 restart) ---
STORE_CORS=https://<your>.vercel.app
ADMIN_CORS=https://<random>.trycloudflare.com
AUTH_CORS=https://<random>.trycloudflare.com,https://<your>.vercel.app
TRUSTED_PROXY_COUNT=1          # Cloudflare tunnel = 1 proxy hop

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

### Tunnel + process manager

Install `cloudflared` (`uat-deploy.md` Phase 3), then start everything from the
committed PM2 ecosystem file (it runs **both** the backend and the quick tunnel):

```bash
npm install -g pm2
cd /opt/alistore/backend
pm2 start deploy/ecosystem.config.cjs
pm2 logs alistore-tunnel        # read the https://<random>.trycloudflare.com URL
pm2 save                        # remember the process list
pm2 startup                     # run the printed line → survives VM reboot
```

### Admin user + MFA (before sharing any URL)

```bash
cd /opt/alistore/backend
npx medusa user -e you@alistore.com -p '<strong 16+ char password>'
```

Open `…/app` at the tunnel URL, log in, and **enable TOTP MFA** in account
settings (Medusa v2.15.3). The admin is now internet-facing — do not skip this.

Then backfill the real tunnel URL into `ADMIN_CORS` / `AUTH_CORS`:

```bash
# edit /opt/alistore/backend/.env, then:
cp .env .medusa/server/.env
pm2 restart alistore-backend
```

---

## Layer 3 — Storefront on Vercel

`uat-deploy.md` Phase 5 / [`vercel-deploy.md`](./vercel-deploy.md). Import the repo,
**Root Directory = `storefront`**, region **Singapore (`sin1`)**. Env vars:

| Key | Value |
|-----|-------|
| `MEDUSA_BACKEND_URL` | the `https://<random>.trycloudflare.com` URL (Phase 3) |
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

- **Logs:** `pm2 logs alistore-backend` · `pm2 logs alistore-tunnel`
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

### The quick-tunnel tax

Every time `cloudflared` restarts it mints a **new** URL. PM2 auto-restarts the
tunnel, so this *will* happen. On each change you must:

1. Update `MEDUSA_BACKEND_URL` in Vercel → redeploy.
2. Update `ADMIN_CORS` / `AUTH_CORS` in the backend `.env` → `cp .env
   .medusa/server/.env` → `pm2 restart alistore-backend`.

### When you get a domain (the real fix — uses your public IP)

This removes the URL churn entirely and finally uses your public IP:

1. Point `api.<domain>` (A record) at your public IP.
2. Run **Caddy** on the backend box for automatic Let's Encrypt TLS →
   `localhost:9000` (or use a Cloudflare **named** tunnel / proxied A record with a
   Cloudflare Access policy on `/app` for the strongest posture).
3. Delete the `alistore-tunnel` PM2 app from `deploy/ecosystem.config.cjs`.
4. Set `MEDUSA_BACKEND_URL=https://api.<domain>` in Vercel **once** (stable forever).
5. Switch R2 to `img.<domain>` (`S3_FILE_URL` + `next.config.js` host) once DNS exists.
