# Install the Medusa backend on a Proxmox LXC (Ubuntu 26.04)

This guide shows how to run the **Ali Store Medusa backend** inside its own
**Proxmox LXC container** with **Ubuntu 26.04 LTS**. It is the sibling of
[`postgres-proxmox-lxc-setup.md`](./postgres-proxmox-lxc-setup.md) (which builds
the database box) and covers only the **backend application** box.

The goal at the end: the backend boots in **production mode**, connects to the
Postgres + Redis box over the LAN, serves the store API and the admin panel
(`/app`) on `localhost:9000`, stays alive across reboots under PM2, and is reachable
publicly over a stable **Tailscale Funnel** URL.

> **Where this fits:** the DB box (`alistore-db`, `172.16.18.10`) comes first —
> build it from `postgres-proxmox-lxc-setup.md`. This guide builds the second box
> (`alistore-backend`, `172.16.18.20`). For the *whole* picture — how Vercel,
> Tailscale Funnel, and payments tie together — read
> [`uat-deploy.md`](./uat-deploy.md) (COD-only) and
> [`production-deploy.md`](./production-deploy.md) (KHPAY-enabled). This file is
> the per-box, beginner-friendly version of their backend phases.

---

## What you need before you start

- The **DB box already running** (`postgres-proxmox-lxc-setup.md` finished):
  Postgres + Redis reachable at `172.16.18.10`, and its `pg_hba.conf` already
  allow-lists the backend IP `172.16.18.20`.
- A working Proxmox VE server you can open the web panel for.
- An **Ubuntu 26.04 LXC template** downloaded in Proxmox (same one as the DB box).
- Your **git remote URL** for this repo.
- Your **R2** credentials (endpoint, bucket, access key/secret) and the public
  CDN base URL — the same values your dev backend already uses.
- A **Telegram** bot token + private chat id (from @BotFather) for order alerts.
- For payments: your real **KHPAY** API key (`ak_…`) from
  `https://khpay.site/dashboard/settings` *(configure Settings → Bakong there
  first, or skip payments for a Cash-on-Delivery–only round)*.
- About 30 minutes.

**Words used in this guide:**

- **LXC container** — a small, fast Linux machine inside Proxmox, lighter than a
  full VM.
- **Medusa** — the e-commerce backend framework. It needs **Node 20 LTS** and a
  Postgres 15+ database.
- **PM2** — a process manager that keeps the backend running and restarts it
  after a crash or reboot.
- **Tailscale Funnel** — gives the box a stable, public `https://<host>.<tailnet>.ts.net`
  URL with a valid TLS cert, reachable from anywhere (including Vercel's servers).
  It replaces the old Cloudflare quick tunnel and, unlike it, the URL never rotates.
- **Build artifact** — `npx medusa build` produces a `.medusa/server/` folder.
  That folder is what actually runs in production, not the source tree.

---

## Step 1 — Create the LXC container

In the Proxmox web panel, click **Create CT** (top right). This is the same flow
as the DB guide (Step 2), with a different hostname and IP.

1. **General** tab:
   - **Hostname:** `alistore-backend`
   - **Password:** a strong root password (write it down safely).
   - Leave **Unprivileged container** checked (safer).
2. **Template** tab: choose `ubuntu-26.04-standard`.
3. **Disks** tab: **20 GB**.
4. **CPU** tab: **2 cores**.
5. **Memory** tab: **2048 MB** RAM, **512 MB** swap.
6. **Network** tab:
   - **IPv4:** **Static**.
   - **Address:** `172.16.18.20/24` *(this exact IP is already allow-listed in
     the DB box's `pg_hba.conf` — using a different IP means editing that file)*.
   - **Gateway:** your router, e.g. `172.16.18.1`.
7. **DNS** tab: leave the default.
8. Click **Finish**. Proxmox builds the container.

> **Tip:** A static IP matters. The database only accepts connections from
> `172.16.18.20`, and the backend connects out to the DB by IP — neither side
> should change.

---

## Step 2 — Start, open, and update the container

1. Select `alistore-backend` in the left list, click **Start**, then **Console**.
2. Log in as `root` with the password from Step 1.
3. Get the latest security fixes:

   ```bash
   apt update && apt upgrade -y
   ```

---

## Step 3 — Install Node 20 LTS and git

Medusa requires **Node 20 LTS** (the repo pins `"node": ">=20"`).

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git
node -v        # expect v20.x
npm -v
```

Also install the database client tools so you can test the LAN connection:

```bash
apt install -y postgresql-client redis-tools
```

---

## Step 4 — Confirm the backend can reach the DB box

Before pulling any code, prove the network path to `alistore-db`. Replace the
password with the real Postgres/Redis password you set in the DB guide.

```bash
psql 'postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa' -c '\q'   # should connect, no error
redis-cli -u 'redis://:DbNew!2025@172.16.18.10:6379' ping                # expect PONG
```

> **Use single quotes**, not double. In bash a `!` (and a `$`) is still expanded
> inside double quotes — a password like `DbNew!2025` triggers
> `-bash: !2025: event not found`. Single quotes pass the string through literally.

- **Postgres fails?** On the DB box, check `pg_hba.conf` has the line for
  `172.16.18.20/32` and that `listen_addresses = '*'`
  (`postgres-proxmox-lxc-setup.md` Step 7).
- **Redis fails?** On the DB box, check `bind`, `protected-mode`, `requirepass`,
  and the firewall (`postgres-proxmox-lxc-setup.md` Step 10).

Do not continue until both succeed — every later step depends on this.

---

## Step 5 — Get the code

```bash
mkdir -p /opt && cd /opt
git clone <your-repo-url> alistore          # ← your git remote
cd /opt/alistore/backend
npm ci                                       # exact installs from the committed lockfile
```

> Use `npm ci`, **never** `npm install`, on a deploy box — `ci` installs the
> exact versions from `package-lock.json` (Medusa is pinned to `2.15.3`).

---

## Step 6 — Create the backend `.env`

Create `/opt/alistore/backend/.env`. **This file stays on the VM and is never
committed to git** — only the empty `.env.template` belongs in the repo.

Generate the two secrets first (each must be unique to this environment):

```bash
openssl rand -base64 48     # run twice → one value for JWT_SECRET, one for COOKIE_SECRET
```

Then write the file (`nano /opt/alistore/backend/.env`). Fill every `← change`:

```dotenv
NODE_ENV=production            # turns OFF all dev-only mock seams + turns ON the SSRF boot-check

# --- Data (the alistore-db box) ---
DATABASE_URL=postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa   # ← change pwd
REDIS_URL=redis://:DbNew!2025@172.16.18.10:6379                         # ← change pwd

# --- Secrets (backend fails to boot if these are empty) ---
JWT_SECRET=        # ← paste an `openssl rand -base64 48` value
COOKIE_SECRET=     # ← paste a DIFFERENT `openssl rand -base64 48` value

# --- CORS / origins ---
# The Funnel host is STABLE and known once you run Step 9 (it's derived from the
# box hostname + your tailnet), so you can set ADMIN_CORS/AUTH_CORS to it directly.
# The Vercel host isn't known until the storefront's first deploy (Step 10) — fill
# a placeholder now, then come back. The admin panel is served on the Funnel host,
# so Medusa must list it here.
STORE_CORS=https://REPLACE.vercel.app                                              # ← change (Step 10)
ADMIN_CORS=https://alistore-backend.<tailnet>.ts.net                               # ← your Funnel host (Step 9)
AUTH_CORS=https://alistore-backend.<tailnet>.ts.net,https://REPLACE.vercel.app     # ← Funnel host (Step 9) + Vercel (Step 10)
TRUSTED_PROXY_COUNT=1          # Tailscale Funnel = exactly 1 proxy hop in front

# --- R2 product images (copy your working dev values) ---
S3_FILE_URL=https://pub-xxxxxxxx.r2.dev     # ← your R2 public base (or img.<domain> once DNS exists)
S3_REGION=auto
S3_ENDPOINT=                                # ← https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=ali-store-products
S3_ACCESS_KEY_ID=                           # ← change
S3_SECRET_ACCESS_KEY=                       # ← change

# --- Business config ---
USD_KHR_RATE=4100              # ← your USD→KHR rate (KHR rounds to whole riel)
DELIVERY_FEE=1
FREE_DELIVERY_THRESHOLD=5
LOW_STOCK_THRESHOLD=5

# --- Telegram order alerts ---
TELEGRAM_BOT_TOKEN=            # ← from @BotFather
TELEGRAM_CHAT_ID=              # ← your private chat id

# --- KHQR payments via KHPAY (the active rail). Omit this whole block for a
#     Cash-on-Delivery-only round — COD needs no payment config. ---
KHPAY_BASE_URL=https://khpay.site/api/v1    # SSRF-allowlisted to khpay.site; a wrong host refuses to boot
KHPAY_API_KEY=ak_...                        # ← the REAL key from khpay.site
# KHPAY_EXPIRES_MINUTES=20                   # optional; defaults to 20 (= stock-reservation TTL)
```

### What you must leave UNSET (security-critical)

`NODE_ENV=production` makes the dev-only loopback mock seams inert, and turns on a
boot-time SSRF check. Because of that:

- **Never** set `KHPAY_DEV_ALLOW_LOOPBACK` (or any `*_DEV_ALLOW_LOOPBACK` /
  `*_DEV_BASE_URL`). They are ignored in production — leave them blank anyway.
- **Leave `BAKONG_*`, `PAYWAY_*`, `FB_*`, `GOOGLE_*` empty.** They are not used in
  this configuration. In particular, setting `BAKONG_PROXY_URL` **without**
  `BAKONG_PROXY_ALLOWED_HOSTS` makes the backend **refuse to boot** in production
  — that is by design.

> **Why `NODE_ENV=production` is a hard gate:** in dev the code allows plain-HTTP
> loopback mock servers (for the E2E tests). On a public box those seams must be
> off, and the backend must validate that payment hosts are on the allowlist
> before it accepts traffic. Setting `NODE_ENV=production` does both.

---

## Step 7 — Build, migrate, and prepare the production artifact

```bash
cd /opt/alistore/backend
npx medusa build                 # → outputs .medusa/server (the server + admin build)
npx medusa db:migrate            # idempotent; safe to run even if the schema already exists

# The build output is the deploy artifact — give it the env + install its prod deps
cp .env .medusa/server/.env
cd .medusa/server && npm ci --omit=dev && cd ../..
```

> **Migrations:** the agent/operator may run `db:migrate` against this Proxmox
> dev/UAT database freely. **Never** run `db:migrate` / `db:reset` /
> `db:rollback` against a production Supabase DB from here — and always take a
> backup on the DB box first:
> `sudo -u postgres pg_dump medusa > /root/medusa-backup-$(date +%F).sql`.

### Optional foreground smoke test

```bash
cd /opt/alistore/backend/.medusa/server && npm run start
```

Watch the boot log. You want to see the **Redis** modules loading — **not** the
message `redisUrl not found. A fake redis instance will be used.` (that would mean
`REDIS_URL` is wrong). Once it boots clean, press **Ctrl-C** — Step 8 runs it for
real under PM2.

---

## Step 8 — Keep it alive with PM2

The repo ships a ready-made PM2 file at
[`backend/deploy/ecosystem.config.cjs`](../backend/deploy/ecosystem.config.cjs).
It defines **one** process: `alistore-backend` (the built Medusa server from
`.medusa/server`). Public exposure is handled by **Tailscale** (Step 9), not PM2 —
Tailscale persists its own config in the `tailscaled` service across reboots, so
there is no tunnel process to babysit here.

```bash
npm install -g pm2
cd /opt/alistore/backend
pm2 start deploy/ecosystem.config.cjs
pm2 save                         # remember the process list
pm2 startup                      # run the line it prints → survives a VM reboot
```

Useful commands:

```bash
pm2 status                       # see the backend process
pm2 logs alistore-backend        # backend logs
pm2 restart alistore-backend     # restart after an .env change
```

---

## Step 9 — Expose the backend (Tailscale Funnel)

The browser never calls the backend directly, but **Vercel's servers** (SSR,
server actions) and **you** (the admin panel) do — over HTTPS. Vercel calls the
backend **server-side over the public internet**, so it needs a publicly-resolvable
hostname with a browser-trusted TLS cert. **Tailscale Funnel** provides exactly
that — a stable `https://<host>.<tailnet>.ts.net` name with a valid Let's Encrypt
cert — without owning a domain, and (unlike a Cloudflare quick tunnel) the URL
**never rotates** on restart.

Install Tailscale and bring the box up:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

> **Proxmox LXC: enable userspace networking first.** An unprivileged LXC has no
> `/dev/net/tun`, so `tailscaled` starts but its engine never initialises —
> `tailscale up` then fails with **`503 Service Unavailable: no backend`** and
> `ls /dev/net/tun` reports *No such file or directory*. Run Tailscale in
> userspace-networking mode (no TUN device required; Funnel/serve still work
> fully):
>
> ```bash
> # one-time: tell tailscaled not to require a TUN device
> grep -q '^FLAGS=' /etc/default/tailscaled \
>   && sed -i 's|^FLAGS=.*|FLAGS="--tun=userspace-networking"|' /etc/default/tailscaled \
>   || echo 'FLAGS="--tun=userspace-networking"' >> /etc/default/tailscaled
> systemctl restart tailscaled
> tailscale status        # should say "Logged out" (engine up), NOT "503 no backend"
> ```
>
> The flag lives in `/etc/default/tailscaled`, so it survives reboots — more
> robust than passing the host's TUN device into the container. (If you'd rather
> use kernel networking, instead add TUN to the container on the **Proxmox host**:
> `lxc.cgroup2.devices.allow: c 10:200 rwm` and `lxc.mount.entry: /dev/net/tun
> dev/net/tun none bind,create=file`, then restart the container.)

```bash
tailscale up --hostname=alistore-backend       # open the auth URL, approve in the admin console
```

Then publish port 9000 over Funnel:

```bash
# Public, stable HTTPS for Vercel (valid .ts.net cert, so Secure cookies work):
tailscale funnel --bg 9000
tailscale funnel status                          # confirm it's serving :9000
```

> **First time only:** in the Tailscale admin console, enable **HTTPS
> certificates** (DNS page) and add the **`funnel`** node attribute to the ACL
> grants, or `tailscale funnel` will refuse to start.

Your stable public backend URL is `https://alistore-backend.<tailnet>.ts.net`.
Put it into the backend `.env` (`ADMIN_CORS`, `AUTH_CORS` — you may already have
done this in Step 6 since the host is known up front) and into Vercel
(`MEDUSA_BACKEND_URL`, Step 10).

> **Admin-isolation note.** `tailscale funnel --bg 9000` publishes the *whole*
> Medusa server, including `/app`. That's fine — **MFA is the access control**
> (Step 10). If you'd rather keep `/app` off the public internet entirely, expose
> only the API publicly and reach the admin over the private tailnet instead
> (`tailscale serve`) — see the admin-isolation section of
> [`production-deploy.md`](./production-deploy.md).

The `.ts.net` host is stable across reboots (Tailscale persists serve/funnel
config in the `tailscaled` service), so unlike the old quick tunnel you set CORS
**once** and never touch it again. If you still need to backfill it:

```bash
nano /opt/alistore/backend/.env     # set ADMIN_CORS + AUTH_CORS to the Funnel URL
cp .env .medusa/server/.env
pm2 restart alistore-backend
```

---

## Step 10 — Create the admin user and turn on MFA

⚠️ **Do this before sharing any URL.** Funnel publishes the admin panel (`/app`)
to the public internet, so **MFA is your only access control** (unless you took
the `tailscale serve` private-admin route in Step 9).

```bash
cd /opt/alistore/backend
npx medusa user -e you@alistore.com -p '<a strong 16+ char password>'   # ← change
```

Open `…/app` at the Funnel URL, log in, and **enable TOTP two-factor
authentication** in your account settings (Medusa v2.15.3 supports it — scan with
an authenticator app). Do not skip this.

> ⚠️ **Log in over the HTTPS Funnel URL — never `http://<ip>:9000/app`.** In
> production mode Medusa sets the session cookie with the `Secure` flag, which
> browsers refuse to store over plain HTTP. So `http://172.16.18.20:9000/app`
> *appears* to log in (`POST /auth/user/emailpass` → 200, `POST /auth/session`
> → 200) but the cookie is dropped, every `GET /admin/users/me` returns **401**,
> and you can never stay signed in. Always use
> `https://alistore-backend.<tailnet>.ts.net/app`.

> **Resetting a forgotten admin password.** `npx medusa user` only *creates* — if
> the account already exists it errors `User with email … already exists` and does
> **not** change the password. Reset it with a one-off script via `npx medusa exec`
> (run from the project root; password passed by env var so it isn't hardcoded):
>
> ```bash
> cat > src/scripts/reset-admin-password.ts <<'EOF'
> import { Modules } from "@medusajs/framework/utils"
> import { ExecArgs } from "@medusajs/framework/types"
> export default async function ({ container }: ExecArgs) {
>   const auth = container.resolve(Modules.AUTH)
>   const email = "you@alistore.com"                  // ← change
>   const password = process.env.NEW_ADMIN_PASSWORD
>   if (!password) throw new Error("Set NEW_ADMIN_PASSWORD")
>   const [id] = await auth.listProviderIdentities({ provider: "emailpass", entity_id: email })
>   if (!id) throw new Error("No emailpass credential for that email")
>   await auth.updateProvider("emailpass", { entity_id: email, password })
>   console.log(`Password reset for ${email}`)
> }
> EOF
> NEW_ADMIN_PASSWORD='<new strong 16+ char password>' npx medusa exec ./src/scripts/reset-admin-password.ts
> rm src/scripts/reset-admin-password.ts            # one-off; don't commit it
> ```

> The storefront on Vercel is a separate job. Point its `MEDUSA_BACKEND_URL` at
> the Funnel URL and add the rest of its env vars per
> [`uat-deploy.md`](./uat-deploy.md) Phase 5 / [`vercel-deploy.md`](./vercel-deploy.md).
> After the first Vercel deploy, copy the `*.vercel.app` host into the backend
> `.env` `STORE_CORS` + `AUTH_CORS` and `pm2 restart alistore-backend`.

---

## Quick reference

| Item                | Value (example)                                            |
| ------------------- | ---------------------------------------------------------- |
| Container name      | `alistore-backend`                                         |
| Backend IP          | `172.16.18.20`                                             |
| DB box IP           | `172.16.18.10` (Postgres `5432` + Redis `6379`)            |
| Node version        | 20 LTS                                                      |
| Code path           | `/opt/alistore/backend`                                    |
| Build artifact      | `/opt/alistore/backend/.medusa/server`                     |
| Local listen        | `http://localhost:9000` (API + admin `/app`)               |
| Public URL          | `https://alistore-backend.<tailnet>.ts.net` (Tailscale Funnel, stable) |
| Process manager     | PM2 (`alistore-backend`); exposure via Tailscale Funnel    |
| Active payment rail | KHPAY (`KHPAY_BASE_URL=https://khpay.site/api/v1`) + COD   |

---

## Operating notes

- **Logs / exposure:** `pm2 logs alistore-backend` · `tailscale status` ·
  `tailscale funnel status`
- **Restart after any `.env` change:** edit `/opt/alistore/backend/.env` →
  `cp .env .medusa/server/.env` → `pm2 restart alistore-backend`. *(The running
  server reads `.medusa/server/.env`, so the copy step is required.)*
- **Deploy new code:**

  ```bash
  cd /opt/alistore/backend && git pull && npm ci \
    && npx medusa build && npx medusa db:migrate \
    && cp .env .medusa/server/.env \
    && (cd .medusa/server && npm ci --omit=dev) \
    && pm2 restart alistore-backend
  ```

- **DB backup before any migration** (run on the DB box):
  `sudo -u postgres pg_dump medusa > /root/medusa-backup-$(date +%F).sql`
- **Public URL is stable.** The Funnel `*.ts.net` host persists across reboots, so
  `MEDUSA_BACKEND_URL` (Vercel) and `ADMIN_CORS`/`AUTH_CORS` (backend) are set once
  and don't churn. If Funnel ever stops serving, re-check `tailscale funnel status`.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| Boot log says *"a fake redis instance will be used"* | `REDIS_URL` is unset or wrong — re-check the password and the `172.16.18.10:6379` host. |
| Backend exits immediately on boot | Empty `JWT_SECRET`/`COOKIE_SECRET`, or `BAKONG_PROXY_URL` set without `BAKONG_PROXY_ALLOWED_HOSTS` (fails closed by design). Check `pm2 logs alistore-backend`. |
| Can't connect to Postgres | DB box `pg_hba.conf` must allow `172.16.18.20/32`; `listen_addresses = '*'` (see `postgres-proxmox-lxc-setup.md` Step 7). |
| Admin page blocked / CORS error | `ADMIN_CORS`/`AUTH_CORS` must include the exact Funnel `*.ts.net` URL; restart after editing. |
| `tailscale up` → **`503 Service Unavailable: no backend`**; `ls /dev/net/tun` says *No such file or directory* | Unprivileged LXC has no TUN device. Set `FLAGS="--tun=userspace-networking"` in `/etc/default/tailscaled` and `systemctl restart tailscaled` (Step 9). |
| Admin login looks OK but `/admin/users/me` keeps returning **401** (can't stay signed in) | You're on `http://<ip>:9000/app`. The `Secure` session cookie is dropped over plain HTTP — log in via the HTTPS Funnel URL (Step 10), not the IP. |
| `npx medusa user` → *"User with email … already exists"* | It only creates, never updates. Reset the password with the `npx medusa exec` script in Step 10. |
| KHQR / KHPAY refuses to boot | `KHPAY_BASE_URL` must be exactly `https://khpay.site/api/v1` (SSRF allowlist). |
| Vercel/storefront can't reach backend | Check `tailscale funnel status` is serving `:9000`; confirm Funnel is enabled in the Tailscale admin console (HTTPS certs + `funnel` node attribute). The URL itself is stable, so it won't have changed on reboot. |
