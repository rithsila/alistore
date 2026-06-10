# UAT deploy — Vercel storefront + Medusa on Proxmox, via Cloudflare Tunnel

This is the runbook for a **real UAT round**: the storefront on **Vercel**, the
Medusa backend on the **Proxmox VM in Cambodia**, made reachable through a
**Cloudflare Tunnel**. This mirrors the final production topology, runs the
production builds (not `dev` mode), and is on the actual Cambodia network — so it
finally exercises the items the plan deferred "to UAT with real credentials"
(Telegram alerts, KHQR, admin MFA).

This round is scoped to **guest + Cash-on-Delivery** checkout. No Facebook/Google
login, so there is **no OAuth / redirect-URI / provider-console work** here.

> Run the commands on the machines indicated. Lines you must change are marked
> `# ← change`. **Never commit a real `.env`** — only placeholder templates
> belong in git.

---

## 0 — How the pieces talk (read this first)

```
                    ┌─────────────────────────────────────────────┐
  Tester's phone ──►│  Vercel  (storefront, Next.js)              │  https://alistore.vercel.app
                    │  - browser ONLY ever talks to Vercel        │
                    └───────────────┬─────────────────────────────┘
                                    │  server-side only (SSR, server actions,
                                    │  middleware proxy for /store/auth + invoice)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  Cloudflare Tunnel  (cloudflared)           │  https://<random>.trycloudflare.com
                    └───────────────┬─────────────────────────────┘
                                    │  http://localhost:9000
                                    ▼
        alistore-backend LXC  ┌───────────────────────────┐
        172.16.18.20          │  Medusa  :9000  + Admin/app │
                              └──────────────┬─────────────┘
                                             │  Postgres 5432 + Redis 6379
                                             ▼
        alistore-db LXC       ┌───────────────────────────┐
        172.16.18.10          │  PostgreSQL  +  Redis      │  (already set up — see
                              └───────────────────────────┘   docs/postgres-proxmox-lxc-setup.md)
```

**Why only the backend gets a tunnel:** the storefront was traced end-to-end —
every cart / payment / customer call runs **server-side** (`"use server"`,
Server Components), and the only browser→backend hops (`/store/auth/*`, invoice)
are **same-origin-proxied** by `storefront/src/middleware.ts`. The browser never
calls `:9000` directly. So Vercel gives the storefront a free public URL, and the
tunnel exists purely so Vercel's *servers* (and you, for the admin panel) can
reach the backend.

**The DB/Redis box (`172.16.18.10`) is already done** in
`docs/postgres-proxmox-lxc-setup.md`. This runbook adds a **second** container,
`alistore-backend` at `172.16.18.20`, for Medusa. (You can co-locate Medusa on the
DB box instead, but a separate container keeps the DB isolated — and the existing
`pg_hba.conf` already allow-lists `172.16.18.20`.)

---

## ⚠️ Security gates — do these, they are not optional

| Gate | Why | Where |
|------|-----|-------|
| **Enable admin MFA** before the tunnel goes up | The tunnel exposes `/app` (admin) to the internet. `security.md` requires MFA on admin; SETUP-01C deferred it. An unprotected admin on the public internet is the single biggest risk here. | Phase 4 |
| **Strong admin password** (≥16 chars, mixed) | Same reason. | Phase 4 |
| **`NODE_ENV=production`** in the backend `.env` | Disables the dev-only loopback escapes (Bakong/FB/Google mock seams) and turns on the production SSRF boot-check. | Phase 2 |
| **Real secrets only in `.env` on the VM** | Never in git, never in the Vercel repo. | Phases 2 & 5 |
| **Leave `BAKONG_*` unset** for this COD round | In production, setting `BAKONG_PROXY_URL` **without** `BAKONG_PROXY_ALLOWED_HOSTS` makes the backend refuse to boot (by design). COD needs neither. | Phase 2 |

> **Stronger option for admin:** if you create a Cloudflare **named** tunnel
> (Phase 3, alternative), put a **Cloudflare Access** policy on the hostname so
> `/app`, `/admin`, and `/auth/user` require your login before anything reaches
> Medusa. With the quick tunnel you cannot path-restrict, so MFA is your control.

---

## Phase 1 — Create the backend container (`alistore-backend`, 172.16.18.20)

In the Proxmox web panel, **Create CT** (same flow as the DB guide, Step 2):

- **Hostname:** `alistore-backend`
- **Template:** `ubuntu-26.04-standard`
- **Disk:** 20 GB · **CPU:** 2 cores · **Memory:** 2048 MB / 512 MB swap
- **Network → IPv4:** Static `172.16.18.20/24`, Gateway `172.16.18.1`  *(this IP is
  already allow-listed in the DB box's `pg_hba.conf`)*

Start it, open **Console**, log in as `root`, then:

```bash
apt update && apt upgrade -y
# Node 20 LTS (Medusa requires >=20)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
node -v   # ← expect v20.x
```

Confirm the backend box can reach the DB box:

```bash
apt install -y postgresql-client redis-tools
psql "postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa" -c '\q'   # ← change pwd; should connect
redis-cli -u "redis://:DbNew!2025@172.16.18.10:6379" ping                 # ← change pwd; expect PONG
```

If either fails, fix `pg_hba.conf` / Redis `bind` on the DB box per
`docs/postgres-proxmox-lxc-setup.md` (Steps 7 & 10) — the backend IP must be
`172.16.18.20`.

---

## Phase 2 — Get the code + build the backend

```bash
mkdir -p /opt && cd /opt
git clone <your-repo-url> alistore        # ← change to your git remote
cd /opt/alistore/backend
npm ci                                     # exact installs from the committed lockfile
```

Create `/opt/alistore/backend/.env` (this file stays on the VM, never in git).
Fill every `← change` line:

```dotenv
NODE_ENV=production

# --- Data (the alistore-db box) ---
DATABASE_URL=postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa   # ← change pwd
REDIS_URL=redis://:DbNew!2025@172.16.18.10:6379                         # ← change pwd

# --- Secrets (generate fresh; backend fails closed without them) ---
JWT_SECRET=        # ← `openssl rand -base64 48`
COOKIE_SECRET=     # ← `openssl rand -base64 48`

# --- CORS / origins ---
# Fill the tunnel + Vercel hosts AFTER Phases 3 and 5 (revisit this file then).
# Browser never hits the backend directly, but the admin panel does (same-origin
# on the tunnel host) and Medusa validates these.
STORE_CORS=https://alistore.vercel.app                                  # ← change (Phase 5)
ADMIN_CORS=https://REPLACE.trycloudflare.com                            # ← change (Phase 3)
AUTH_CORS=https://REPLACE.trycloudflare.com,https://alistore.vercel.app # ← change (Phases 3+5)

# Cloudflare Tunnel = 1 proxy hop in front → trust it for the real client IP
TRUSTED_PROXY_COUNT=1

# --- R2 product images (copy your working dev values) ---
S3_FILE_URL=https://pub-1dedea628ee74e9399932493df26e28e.r2.dev         # ← or img.<domain> once DNS exists
S3_REGION=auto
S3_ENDPOINT=        # ← https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=          # ← ali-store-products
S3_ACCESS_KEY_ID=        # ← change
S3_SECRET_ACCESS_KEY=    # ← change

# --- Business config ---
USD_KHR_RATE=4100        # ← set your rate
DELIVERY_FEE=            # ← set
FREE_DELIVERY_THRESHOLD= # ← set
LOW_STOCK_THRESHOLD=5

# --- Telegram order alerts (UAT exercises BACKEND-09 live) ---
TELEGRAM_BOT_TOKEN=      # ← from @BotFather
TELEGRAM_CHAT_ID=        # ← your private chat id

# --- Leave UNSET this round (COD only) ---
# BAKONG_TOKEN / BAKONG_PROXY_URL / BAKONG_PROXY_ALLOWED_HOSTS / BAKONG_ACCOUNT
# FB_APP_ID / FB_APP_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
# (setting BAKONG_PROXY_URL without the allow-list will refuse to boot in prod)
```

Build, migrate, and prepare the production server artifact:

```bash
cd /opt/alistore/backend
npx medusa build                 # → outputs .medusa/server (server + admin)
npx medusa db:migrate            # idempotent; schema already applied in SETUP-08

# The build output is the deploy artifact — install its prod deps + give it the env
cp .env .medusa/server/.env
cd .medusa/server
npm ci --omit=dev
```

Quick foreground smoke test (Ctrl-C after it boots clean):

```bash
npm run start                    # medusa start → http://localhost:9000 , admin at /app
```

You want a clean boot with the **Redis** modules loading (not "a fake redis
instance will be used"). Ctrl-C — Phase 4 runs it for real under a process manager.

---

## Phase 3 — Cloudflare Tunnel (public URL for the backend)

Install `cloudflared` on the backend box:

```bash
curl -L -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

**Quick tunnel (no domain needed — use this now):**

```bash
cloudflared tunnel --url http://localhost:9000
# prints:  https://<random-words>.trycloudflare.com   ← copy this URL
```

That URL is your **public backend URL**. It stays valid **as long as the
process runs** (Phase 4 keeps it alive). Put it into the backend `.env`
(`ADMIN_CORS`, `AUTH_CORS`) and the Vercel env (`MEDUSA_BACKEND_URL`, Phase 5).

> **Stability tax (important):** a quick tunnel gets a **new random URL every
> time `cloudflared` restarts**. A restart means you must update the backend
> `.env` CORS + the Vercel `MEDUSA_BACKEND_URL` and redeploy. For anything beyond
> a short UAT, register a **named** tunnel against a domain on Cloudflare so the
> backend gets a stable host like `https://api.alistore.com` (and you can add a
> Cloudflare Access policy to protect `/app`). Named tunnels need a domain — the
> one item still pending (CLARIFY-08-REOPEN).

**Named tunnel (later, once you own a Cloudflare domain):**

```bash
cloudflared tunnel login
cloudflared tunnel create alistore-backend
cloudflared tunnel route dns alistore-backend api.alistore.com   # ← your domain
# ingress config → ~/.cloudflared/config.yml :
#   tunnel: <tunnel-id>
#   credentials-file: /root/.cloudflared/<tunnel-id>.json
#   ingress:
#     - hostname: api.alistore.com
#       service: http://localhost:9000
#     - service: http_status:404
cloudflared tunnel run alistore-backend
```

---

## Phase 4 — Keep it alive (PM2) + enable admin MFA

Install PM2 and start both the backend and the tunnel from the committed
ecosystem file (`backend/deploy/ecosystem.config.cjs`):

```bash
npm install -g pm2
cd /opt/alistore/backend
pm2 start deploy/ecosystem.config.cjs
pm2 logs alistore-tunnel        # ← read the trycloudflare URL from here if you used a quick tunnel
pm2 save                        # remember the process list
pm2 startup                     # run the line it prints → survives VM reboot
```

**Create the admin user and turn on MFA (do this before sharing any URL):**

```bash
cd /opt/alistore/backend
npx medusa user -e you@alistore.com -p '<a strong 16+ char password>'   # ← change
```

Then open the admin at the tunnel URL `…/app`, log in, and **enable two-factor
authentication** in your account settings (Medusa v2.15.3 has TOTP MFA — scan
with an authenticator app). Do not skip this: the admin is now internet-facing.

> Revisit `/opt/alistore/backend/.env` and `.medusa/server/.env` now that you
> have the real tunnel URL — set `ADMIN_CORS` / `AUTH_CORS`, then
> `pm2 restart alistore-backend`.

---

## Phase 5 — Storefront on Vercel

The Vercel project points at the **`storefront/`** subdirectory of the repo.

1. **Import the repo** at vercel.com → New Project.
2. **Root Directory:** `storefront`
3. **(Recommended) Region:** Singapore (`sin1`) — closest to the Cambodia
   backend, so SSR round-trips are faster.
4. **Environment Variables:**

   | Key | Value |
   |-----|-------|
   | `MEDUSA_BACKEND_URL` | `https://<random>.trycloudflare.com` *(the Phase 3 URL)* |
   | `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | `pk_a39b79c7bafef5ce3adcf5a6a35faa42f686ffaf55ef7fcce2322e12f3c6b989` *(the SETUP-10 key — valid because UAT uses the same DB)* |
   | `NEXT_PUBLIC_BASE_URL` | `https://alistore.vercel.app` *(set after first deploy reveals the URL, then redeploy)* |
   | `NEXT_PUBLIC_DEFAULT_REGION` | `kh` |
   | `REVALIDATE_SECRET` | a fresh random string |

5. **Deploy.** After the first build, copy the assigned `*.vercel.app` URL into
   `NEXT_PUBLIC_BASE_URL` and **redeploy** (it's used for invoice/OG absolute
   links). Also put that `*.vercel.app` host into the backend `.env`
   `STORE_CORS` + `AUTH_CORS`, then `pm2 restart alistore-backend`.

No `next.config.js` change is needed — the Server-Actions `allowedOrigins` issue
only applies behind a rewriting proxy (the ngrok-on-laptop idea); on Vercel the
storefront *is* the host, so the origin already matches. Product images already
load from R2 (allow-listed in `next.config.js`), which Vercel can fetch directly.

---

## Phase 6 — UAT smoke test (run through these as a "tester")

On a phone, on cellular (not your LAN), against the Vercel URL:

- [ ] Home + category browse renders; product images load (R2).
- [ ] PDP: variant (size + color) selection works; "N left" stock note shows.
- [ ] Add to cart → cart totals correct (USD + KHR rounded to whole riel).
- [ ] COD checkout: name + Cambodia phone (`0…`/`+855…`) + address → order places.
- [ ] **Telegram alert arrives** in your private chat with full order details
      (order #, items, total USD+KHR, COD, name/phone/address). *(BACKEND-09 live)*
- [ ] Order confirmation → invoice link opens (`/store/orders/:id/invoice?token=`),
      renders HTML, **no VAT line** (VAT off in v1).
- [ ] Admin (`…/app`, MFA): the COD order is visible; sales + stock reports load;
      a manual stock-in (+N) shows one ledger row and bumps the PDP "N left".

**Deferred to a later round (not in this COD UAT):** real KHQR paid-flip (needs
the in-Cambodia Bakong proxy + `BAKONG_PROXY_ALLOWED_HOSTS`), Facebook/Google
login (needs real apps + redirect URIs on the Vercel origin), and the
domain-dependent pieces (named tunnel `api.<domain>`, `img.<domain>`, SETUP-11).

---

## Operating notes

- **Logs:** `pm2 logs alistore-backend` · `pm2 logs alistore-tunnel`
- **Restart backend after an `.env` change:** `pm2 restart alistore-backend`
- **Update to new code:** `cd /opt/alistore/backend && git pull && npm ci &&
  npx medusa build && npx medusa db:migrate && cp .env .medusa/server/.env &&
  (cd .medusa/server && npm ci --omit=dev) && pm2 restart alistore-backend`
- **Quick-tunnel URL changed?** Update `MEDUSA_BACKEND_URL` in Vercel (redeploy)
  **and** `ADMIN_CORS`/`AUTH_CORS` in the backend `.env` (`pm2 restart`).
- **DB backup before any migration:** on the DB box,
  `sudo -u postgres pg_dump medusa > /root/medusa-backup-$(date +%F).sql`
