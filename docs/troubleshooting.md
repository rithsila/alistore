# Server Troubleshooting — Frontend & Backend

A field runbook for **"the site/API is down or misbehaving."** It assumes the
system is already deployed (see [`production-deploy.md`](./production-deploy.md),
[`backend-proxmox-lxc-setup.md`](./backend-proxmox-lxc-setup.md), and
[`vercel-deploy.md`](./vercel-deploy.md)) and focuses on **diagnosis and
recovery**.

Most symptoms trace to one of five things, in order of how often they bite:

1. Backend process crash-looping on a **boot-time config guard** (a payment URL
   that isn't `https://`, or a missing secret).
2. The running server is reading a **stale `.env`** (the built server reads
   `.medusa/server/.env`, *not* the repo-root `.env`).
3. **CORS** — the Vercel origin isn't on the backend allow-list, so SSR calls 500.
4. **Exposure** — Tailscale Funnel isn't serving `:9000`, so Vercel can't reach
   the backend.
5. **Resource** — the 2 GB LXC OOMs during `medusa build`.

---

## 0 — The request path (know where to look)

```
 Phone ─► https://<app>.vercel.app        Vercel: Next.js SSR + middleware proxy
                 │  server-side only (browser never hits the backend directly)
                 ▼
        https://alistore-backend.<tailnet>.ts.net   public HTTPS via Tailscale Funnel
                 │
          Medusa :9000  (PM2 process "alistore-backend" on LXC 172.16.18.20)
                 ├── Postgres  172.16.18.10:5432
                 ├── Redis     172.16.18.10:6379
                 ├── Cloudflare R2  (img.<domain>)
                 └── KHPAY / Telegram / FB+Google OAuth  (outbound HTTPS)
```

**Triage by layer:** browser/CDN → Vercel build/runtime logs → Tailscale Funnel →
Medusa `:9000` health → DB/Redis → outbound integrations. Start at the layer the
symptom points to; don't guess across layers.

| Key fact | Value |
|---|---|
| Backend box | LXC `alistore-backend`, `172.16.18.20`, 2 GB RAM / 2 cores |
| DB/Redis box | `172.16.18.10` (Postgres `5432`, Redis `6379`) |
| App dir | `/opt/alistore_backend` |
| Built server dir | `/opt/alistore_backend/.medusa/server` (reads its own `.env` here) |
| Local listen | `http://localhost:9000` (API + admin `/app`) |
| Public URL | `https://alistore-backend.<tailnet>.ts.net` (Tailscale Funnel, stable) |
| Process manager | PM2 process `alistore-backend`; boot-persisted via systemd `pm2-root` |

> **Access note:** SSH to the box as `root@172.16.18.20`. Keep the password in
> your own secret store — it is deliberately **not** in this repo.

---

## 1 — 60-second health check

**Backend (on the box):**

```bash
pm2 status                              # alistore-backend should be "online", uptime climbing
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/health   # expect 200
ss -ltnp | grep :9000                   # expect a LISTEN line
pm2 logs alistore-backend --lines 30 --nostream | tail -30
```

**Public reachability (from anywhere):**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://alistore-backend.<tailnet>.ts.net/health
tailscale status                        # on the box: Funnel/serve should be active
```

**Frontend (Vercel):** Dashboard → Deployment → **Build Logs** (did it compile?)
and **Runtime Logs** (SSR errors / backend connection failures surface here).

Read the result like this:

| `pm2 status` | `:9000` | `/health` | Where the problem is |
|---|---|---|---|
| online, uptime climbing | LISTEN | 200 | Backend is healthy → look at Funnel / Vercel / CORS |
| online, **↺ climbing fast**, uptime ~0–2s | not listening | fail | **Crash-loop → §2** |
| stopped / errored | not listening | fail | Process not running → `pm2 restart` then §2 if it re-crashes |
| online | LISTEN | 200, but Vercel 500s | **CORS or Funnel → §5 / §6** |

---

## 2 — Backend crash-loops on boot (most common)

**Symptom:** `pm2 status` shows `alistore-backend` flipping `online`→errored, the
restart counter (`↺`) climbs every ~2 s, `:9000` never binds.

**Diagnose — read the actual error:**

```bash
pm2 logs alistore-backend --lines 40 --nostream | grep -iE 'error|fatal|Unsafe|must use https|redis|JWT|COOKIE'
```

### 2a — Payment URL boot guards (SSRF, fail-closed by design)

`medusa-config.ts` validates payment URLs at startup so a bad config fails fast
instead of mid-checkout. Each is `if (url) { assertSafe…(url) }` — **set but not
`https://` ⇒ throws and the server refuses to boot.**

| Log message | Env var | Module |
|---|---|---|
| `BAKONG_PROXY_URL must use https` | `BAKONG_PROXY_URL` | `bakong-payment` (dormant) |
| `PAYWAY_BASE_URL must use https` | `PAYWAY_BASE_URL` | `aba-payway` (dormant) |
| `KHPAY_BASE_URL must use https` | `KHPAY_BASE_URL` | `khpay-payment` (**active rail**) |

**v1 reality:** **KHPAY is the active KHQR provider; Bakong and ABA PayWay are
dormant.** So for the two dormant rails, the correct fix is to **unset / comment
them** (skips the guard; the modules still register harmlessly). `KHPAY_BASE_URL`
must stay a valid `https://khpay.site/...` — **never disable the active rail.**

```bash
cd /opt/alistore_backend
cp .env .env.bak-$(date +%s)                       # always back up first
sed -i -E '/^BAKONG_PROXY_URL=/ s/^/#/' .env       # comment the dormant rail
sed -i -E '/^PAYWAY_BASE_URL=/  s/^/#/' .env        # comment the dormant rail
cp .env .medusa/server/.env                         # ⚠ propagate to the built server (see §3)
pm2 restart alistore-backend
```

> If a rail **should** be live, do **not** comment it — set the real
> `https://<host>` value and its allow-list host (`BAKONG_PROXY_ALLOWED_HOSTS` /
> the hard-coded PayWay/KHPAY host). Treat any payment-config change as
> security-sensitive (`.claude/rules/security.md`).

### 2b — Missing core secrets

| Log clue | Cause | Fix |
|---|---|---|
| Exits immediately, `JWT_SECRET`/`COOKIE_SECRET` empty | secrets unset | Set both in `.env`, re-copy (§3), restart |
| `redisUrl not found. A fake redis instance will be used.` | `REDIS_URL` wrong/unset | Fix the `172.16.18.10:6379` URL + password |
| `BAKONG_PROXY_URL set without BAKONG_PROXY_ALLOWED_HOSTS` | allow-list missing | Set the allow-list, or unset the proxy (2a) |
| DB connection refused / auth failed | `DATABASE_URL` or `pg_hba.conf` | Confirm the box IP is `172.16.18.20` (allow-listed) and DB box is up |

After any fix, confirm a **clean** boot — the decisive line is:

```bash
pm2 logs alistore-backend --lines 40 --nostream | grep -i 'Server is ready on port: 9000'
```

> Note: the `↺` counter is **cumulative** and does **not** reset on a good boot.
> "Fixed" = uptime climbing past a minute + that `Server is ready` line + `:9000`
> listening + `/health` 200 — not a zero restart count.

---

## 3 — The `.env` propagation gotcha (silent staleness)

The production server runs from the **build artifact** `.medusa/server/`, and
Medusa loads its env from **`.medusa/server/.env`** — **not** the repo-root
`/opt/alistore_backend/.env`. Editing the root `.env` alone changes nothing until
you copy it and restart:

```bash
cd /opt/alistore_backend
cp .env .medusa/server/.env && pm2 restart alistore-backend
```

**Symptom of forgetting this:** you "fixed" an env var but the same error
persists, or a new secret/CORS origin has no effect. Always re-copy after editing
`.env`. (PM2's `--update-env` is irrelevant here — Medusa reads the *file*, not
PM2's environment.)

---

## 4 — `medusa build` runs out of memory (OOM)

**Symptom:** `npx medusa build` prints `Backend build completed` then dies during
`Compiling frontend source…` with
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.

**Cause:** the box is 2 GB RAM; with `NODE_OPTIONS` unset, V8 auto-sizes its
old-space heap to ~1 GB, and the **admin/frontend compile** needs more.

**Fix:** raise the heap to **1536 MB** (build peaks ~1.7 GB RSS, fits in 2 GB):

```bash
NODE_OPTIONS=--max-old-space-size=1536 npx medusa build
```

Persisted two ways already:
- Box: `export NODE_OPTIONS=--max-old-space-size=1536` in `/root/.bashrc` (covers
  interactive `npx medusa build`).
- Repo: `backend/package.json` `build` script embeds the flag (covers
  `npm run build`).

If a build still OOMs (future admin growth), bump the LXC RAM on the **Proxmox
host**: `pct set <CTID> -memory 4096` (then keep `1536`, no need to raise it).

> **After any rebuild**, the build wipes `.medusa/server/` — re-do the production
> deps + env copy before starting:
> ```bash
> cd /opt/alistore_backend/.medusa/server && npm ci          # reinstall prod deps
> cd /opt/alistore_backend && cp .env .medusa/server/.env     # re-propagate env
> pm2 restart alistore-backend
> ```

---

## 5 — Frontend (Vercel) issues

The browser never calls the backend directly — every `/store` call is **server-
side** from Vercel, so most "frontend" outages are really **backend-reachability**
or **CORS** problems. The full, source-traced table lives in
[`vercel-deploy.md` §Troubleshooting](./vercel-deploy.md#troubleshooting); the
high-frequency ones:

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails: `🚫 Missing required environment variables` | `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` unset | Set it, **redeploy** |
| Build fails: no `package.json` found | Vercel Root Directory not `storefront` | Set Root Directory → `storefront` |
| Pages render but **no products/regions**, SSR 500s | `MEDUSA_BACKEND_URL` wrong/unreachable or backend down | Open the public backend URL; check §1 + Vercel runtime logs |
| Every `/store` call 401/blocked | Vercel origin not in backend `STORE_CORS`/`AUTH_CORS` | Add the `*.vercel.app` (and custom) origin, re-copy `.env` (§3), restart |
| Invoice/OAuth → `Publishable API key required` (400) | publishable key missing, or middleware can't reach `MEDUSA_BACKEND_URL` | Confirm both env vars + backend public URL |
| `next/image` host error / images broken | image host not in `remotePatterns` | Add host to `storefront/next.config.js`, commit + redeploy |
| Changed a `NEXT_PUBLIC_*` value, no effect | client env is **build-time** | **Redeploy** after editing |
| Links point to `localhost:8000` | `NEXT_PUBLIC_BASE_URL` unset | Set to the deployed URL, redeploy |

**Where to look on Vercel:** Build Logs for compile/env failures; **Runtime Logs**
(Deployment → Logs) for SSR exceptions and backend connection errors.

> **CORS reminder:** the backend allow-list is set in the backend `.env`
> (`STORE_CORS` / `AUTH_CORS`) — so a CORS fix is a **backend** change: edit
> `.env`, **re-copy to `.medusa/server/.env`**, `pm2 restart`.

---

## 6 — Public exposure (Tailscale Funnel)

Vercel reaches the backend over the public `*.ts.net` URL. If `:9000` is healthy
locally but Vercel/`curl` from outside fails:

```bash
tailscale status                 # is the node up and connected?
tailscale serve status           # admin (/app) over the tailnet
tailscale funnel status          # /store/* public for Vercel
```

Re-publish if needed (config persists across reboots, so this is rare):

```bash
tailscale funnel --bg 9000
```

The `*.ts.net` host is **stable across reboots** — if `MEDUSA_BACKEND_URL` on
Vercel ever needs changing, it's a deliberate move (e.g. to a custom `api.<domain>`),
and you must update both Vercel **and** the backend CORS, then redeploy both.

---

## 7 — Common operations cheat-sheet

```bash
# Status & logs
pm2 status
pm2 logs alistore-backend                       # live tail
pm2 logs alistore-backend --lines 50 --nostream # last 50 lines, no follow
pm2 describe alistore-backend                   # status, uptime, restarts, script path

# Lifecycle
pm2 restart alistore-backend                    # after an .env or build change
pm2 stop alistore-backend                       # stop a crash-loop while you investigate
pm2 start deploy/ecosystem.config.cjs           # (re)start from the ecosystem file
pm2 save                                        # persist the process list

# Apply an .env change (ALWAYS both steps)
cd /opt/alistore_backend && cp .env .medusa/server/.env && pm2 restart alistore-backend

# Full rebuild + restart (after pulling code)
cd /opt/alistore_backend
NODE_OPTIONS=--max-old-space-size=1536 npx medusa build
cd .medusa/server && npm ci
cd /opt/alistore_backend && cp .env .medusa/server/.env
pm2 restart alistore-backend

# Connectivity probes
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:9000/health
nc -vz 172.16.18.10 5432                         # Postgres reachable?
nc -vz 172.16.18.10 6379                         # Redis reachable?
```

---

## 8 — Boot persistence (survives a VM reboot)

After a reboot, PM2 should resurrect `alistore-backend` automatically via the
systemd unit. Verify:

```bash
systemctl is-enabled pm2-root      # expect: enabled
pm2 status                         # alistore-backend online after boot
```

If it does **not** come back: `pm2 start deploy/ecosystem.config.cjs && pm2 save`,
then `pm2 startup systemd -u root --hp /root` and run the line it prints.

---

## Escalation checklist

Before declaring an incident, confirm in order:

- [ ] `pm2 status` → online, uptime climbing (not crash-looping → §2)
- [ ] `pm2 logs … | grep -i 'Server is ready on port: 9000'` present
- [ ] `curl localhost:9000/health` → 200; `:9000` listening
- [ ] `.medusa/server/.env` matches the root `.env` (re-copy if unsure → §3)
- [ ] Postgres `172.16.18.10:5432` + Redis `:6379` reachable
- [ ] `tailscale funnel status` active; public `/health` returns 200
- [ ] Vercel: latest deploy green; runtime logs show no backend/CORS errors
- [ ] Backend CORS allow-lists the current Vercel/custom origin

If all green and the site is still broken, capture `pm2 logs` + the Vercel runtime
log for the failing request and work the request path (§0) layer by layer.
