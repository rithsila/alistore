# Ship the storefront on Vercel via the CLI — current-state runbook

This is the **step-by-step** guide for getting the **`storefront/`** live on Vercel
**from where the project actually is today**, driven by the **Vercel CLI**.

It is not the generic setup guide — the Vercel project already exists. For the
conceptual/dashboard version and the full env-var reference see
[`docs/vercel-deploy.md`](./vercel-deploy.md); for the backend half (Medusa on
Proxmox via Tailscale Funnel) see [`docs/uat-deploy.md`](./uat-deploy.md).

---

## 0 — Where things stand (the starting point)

A diagnosis of the live Vercel project on **2026-06-14**:

| Fact | Value |
|---|---|
| Vercel team | **Sila** (`sila-c15d6ca9`) |
| Project | **alistore** — already created and **connected to GitHub** (`rithsila/alistore`, auto-deploys on push to `main`) |
| Root Directory | **`storefront`** ✅ already correct (build detects Next.js 15.3.9, installs from the storefront lockfile) |
| Stable production alias | **`https://alistore-sila-c15d6ca9.vercel.app`** |
| Node version | **24.x** ← should be pinned to **20.x** (Step 4) |
| Deployment state | **every build is `ERROR`** until the env vars are set (fixed in Steps 3 & 5) |
| Deployment Protection | **Vercel Authentication ON** → the live URL returns **401** to the public until you turn it off (Step 6) |

**Why every build fails — the single root cause:**

```
Running "next build"
🚫 Error: Missing required environment variables
  NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
Error: Command "next build" exited with 1
```

`storefront/check-env-variables.js` runs *before* `next build` and hard-exits
because **no environment variables are set in the Vercel project**. The build
never compiles a line. This is a configuration gap, **not a code bug** — set the
env vars, pin Node, redeploy, and it goes green.

So this runbook is just: **log in → link → set env vars → pin Node → redeploy →
open backend CORS → verify.**

---

## 1 — Prerequisites (have these ready)

- [ ] **Vercel CLI installed** — `vercel --version` (this repo used `54.13.0`).
      Install with `npm i -g vercel` if missing.
- [ ] **The backend's public Funnel URL** — `https://alistore-backend.<tailnet>.ts.net`.
      Read it on the backend VM with `tailscale funnel status`. The backend must
      already be up (uat-deploy.md Phases 1–4).
- [ ] **The publishable key** — UAT reuses the SETUP-10 key
      `pk_a39b79c7bafef5ce3adcf5a6a35faa42f686ffaf55ef7fcce2322e12f3c6b989`
      (valid because UAT runs on the same seeded `alistore-db` database).
- [ ] **Edit access to the backend `.env`** — for the CORS step (Step 6).

Run everything below **from the repo root** (`G:\Projects\alistore`). The CLI
operates on the *linked project*, so the cwd does not affect `env` commands.

---

## 2 — Log in and link to the existing project

```bash
vercel login            # pick your method; approves in a browser
vercel whoami           # → should print your username

# Link THIS repo to the existing project (don't create a new one):
vercel link --yes --scope sila-c15d6ca9 --project alistore
```

`vercel link` writes `.vercel/project.json` (gitignored) with the project + org
IDs so subsequent commands know what to target.

> If `vercel link` offers to create a new project, cancel — pick **link to
> existing** → **alistore**. A duplicate project would not be the one wired to
> GitHub.

---

## 3 — Set the environment variables

Set each key for **Production** and **Preview**. The fastest non-interactive form
pipes the value in via stdin (one target per call):

```bash
# ── Required ──────────────────────────────────────────────────────────────────
printf '%s' 'pk_a39b79c7bafef5ce3adcf5a6a35faa42f686ffaf55ef7fcce2322e12f3c6b989' \
  | vercel env add NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY production
printf '%s' 'pk_a39b79c7bafef5ce3adcf5a6a35faa42f686ffaf55ef7fcce2322e12f3c6b989' \
  | vercel env add NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY preview

# Server-only backend URL — REPLACE <tailnet> with your real Funnel host:
printf '%s' 'https://alistore-backend.<tailnet>.ts.net' \
  | vercel env add MEDUSA_BACKEND_URL production
printf '%s' 'https://alistore-backend.<tailnet>.ts.net' \
  | vercel env add MEDUSA_BACKEND_URL preview

# ── Recommended ───────────────────────────────────────────────────────────────
printf '%s' 'https://alistore-sila-c15d6ca9.vercel.app' \
  | vercel env add NEXT_PUBLIC_BASE_URL production
printf '%s' 'kh' | vercel env add NEXT_PUBLIC_DEFAULT_REGION production
printf '%s' 'kh' | vercel env add NEXT_PUBLIC_DEFAULT_REGION preview

# ── Currency display (keep in sync with the backend's USD_KHR_RATE) ───────────
printf '%s' '4100' | vercel env add NEXT_PUBLIC_USD_KHR_RATE production
printf '%s' '4100' | vercel env add NEXT_PUBLIC_USD_KHR_RATE preview
printf '%s' '4100' | vercel env add USD_KHR_RATE production
printf '%s' '4100' | vercel env add USD_KHR_RATE preview
```

> **Prefer clicking through it?** Run `vercel env add NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`
> with no target and the CLI prompts you for the value and lets you tick
> Production / Preview / Development with the spacebar. Same result.

Verify the set:

```bash
vercel env ls
```

You should see (at least) `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` and
`MEDUSA_BACKEND_URL` listed for Production.

**The exact var set (traced to source):**

| Key | Value | Scope | Why |
|---|---|---|---|
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | `pk_a39b79c7…b989` | required | build fails without it |
| `MEDUSA_BACKEND_URL` | `https://alistore-backend.<tailnet>.ts.net` | server-only | defaults to `localhost:9000` otherwise → empty pages |
| `NEXT_PUBLIC_BASE_URL` | `https://alistore-sila-c15d6ca9.vercel.app` | recommended | absolute invoice/OG links |
| `NEXT_PUBLIC_DEFAULT_REGION` | `kh` | recommended | Cambodia catalog region |
| `NEXT_PUBLIC_USD_KHR_RATE` + `USD_KHR_RATE` | `4100` | optional | USD→KHR toggle |

Skip `REVALIDATE_SECRET`, `NEXT_PUBLIC_STRIPE_KEY`, and the `MEDUSA_CLOUD_S3_*`
pair — not read by any current code path in v1.

---

## 4 — Pin Node to 20.x

The project is on **24.x**; pin **20.x** for parity with the backend and Next
15.3.9's validated runtime. The CLI can't set this — use the dashboard:

**Vercel → Project `alistore` → Settings → General → Node.js Version → `20.x` → Save.**

(It takes effect on the next build, i.e. the redeploy in Step 5.)

---

## 5 — Redeploy and watch it go green

A redeploy rebuilds the same Git commit **with the env vars now present**.

```bash
# Rebuild the latest (failed) production deployment with the new settings:
vercel redeploy alistore-6sqeh9ycj-sila-c15d6ca9.vercel.app
```

Or simply trigger the Git pipeline (auto-build on push):

```bash
git commit --allow-empty -m "chore: redeploy storefront with Vercel env vars set"
git push
```

Watch the build:

```bash
vercel inspect --logs alistore-sila-c15d6ca9.vercel.app
```

A healthy build now passes `check-env-variables.js` and ends with
`✓ Compiled` / `Generating static pages` instead of the `🚫 Missing required
environment variables` exit.

> Changing any `NEXT_PUBLIC_*` value later only takes effect on the **next build**
> — they are inlined at build time. Always redeploy after editing one.

---

## 6 — Make the storefront public (disable Deployment Protection)

By default this project has **Vercel Authentication** (Deployment Protection)
turned on, so the live URL returns **HTTP 401** with a `_vercel_sso_nonce`
cookie to anyone not logged into the Vercel team — a customer's phone can't load
it. A public storefront must have this off for Production. There is **no CLI
command** for it; use the dashboard:

**Vercel → Project `alistore` → Settings → Deployment Protection → Vercel
Authentication → Off** (or **"Only Preview Deployments"** to keep previews
private but Production public). Save — it applies immediately, no redeploy needed.

Confirm:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://alistore-sila-c15d6ca9.vercel.app
# 401 → still protected;  200 → public and reachable
```

---

## 7 — Open the backend CORS to the Vercel origin (required)

The browser never calls the backend directly, but **Vercel's servers do** (SSR +
the middleware proxy for `/store/auth/*` and the invoice). The backend rejects
those unless the Vercel origin is allow-listed. On the **backend VM**, edit
`/opt/alistore/backend/.env`:

```dotenv
STORE_CORS=https://alistore-sila-c15d6ca9.vercel.app
AUTH_CORS=https://alistore-backend.<tailnet>.ts.net,https://alistore-sila-c15d6ca9.vercel.app
```

Use the **stable alias** (`alistore-sila-c15d6ca9.vercel.app`), not the per-deploy
hash URL, so it never churns. Then propagate to the running artifact and restart:

```bash
cd /opt/alistore/backend
cp .env .medusa/server/.env
pm2 restart alistore-backend
```

Without this, pages build fine but render empty / 500 on live data.

---

## 8 — Verify (on a phone, on cellular — not your LAN)

Against `https://alistore-sila-c15d6ca9.vercel.app`:

- [ ] Home + category browse render; **product images load** (from R2).
- [ ] PDP: size + color variant selection works; "N left" stock note shows.
- [ ] Add to cart → totals correct (USD + KHR rounded to whole riel).
- [ ] COD checkout with a Cambodia phone (`0…` / `+855…`) places an order.
- [ ] **Telegram alert** arrives in your private chat with full order details.
- [ ] Order confirmation → **invoice link** opens
      (`/store/orders/:id/invoice?token=`) — exercises the middleware proxy.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Live URL returns **401** + `_vercel_sso_nonce` cookie | Deployment Protection (Vercel Authentication) is on | Step 6 — turn it off for Production |
| Build: `🚫 Missing required environment variables` | publishable key not set | Step 3, redeploy |
| Build: no `package.json` found | Root Directory not `storefront` | already correct here; if a *new* project, set it in Settings → General |
| Pages render but no products; SSR 500s | `MEDUSA_BACKEND_URL` wrong/unreachable, or backend down | open the Funnel URL in a browser; check `vercel inspect --logs` |
| Every `/store` call blocked / empty live data | Vercel origin not in backend `STORE_CORS`/`AUTH_CORS` | Step 6, `pm2 restart` |
| Changed a `NEXT_PUBLIC_*`, no effect | client env is build-time | **redeploy** |
| Absolute links point to `localhost:8000` | `NEXT_PUBLIC_BASE_URL` unset | Step 3, redeploy |
| `vercel link` wants to make a new project | linked to the wrong place | re-run, choose **link existing → alistore** |

---

## Quick reference — the whole thing

```bash
# from repo root, backend already up at https://alistore-backend.<tailnet>.ts.net
vercel login
vercel link --yes --scope sila-c15d6ca9 --project alistore

PK='pk_a39b79c7bafef5ce3adcf5a6a35faa42f686ffaf55ef7fcce2322e12f3c6b989'
BACKEND='https://alistore-backend.<tailnet>.ts.net'      # ← change <tailnet>
BASE='https://alistore-sila-c15d6ca9.vercel.app'

for env in production preview; do
  printf '%s' "$PK"      | vercel env add NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY $env
  printf '%s' "$BACKEND" | vercel env add MEDUSA_BACKEND_URL $env
  printf '%s' 'kh'       | vercel env add NEXT_PUBLIC_DEFAULT_REGION $env
  printf '%s' '4100'     | vercel env add NEXT_PUBLIC_USD_KHR_RATE $env
  printf '%s' '4100'     | vercel env add USD_KHR_RATE $env
done
printf '%s' "$BASE" | vercel env add NEXT_PUBLIC_BASE_URL production

# Settings → General → Node.js Version → 20.x  (dashboard, one-time)

vercel redeploy alistore-6sqeh9ycj-sila-c15d6ca9.vercel.app
# Settings → Deployment Protection → Vercel Authentication → Off   (dashboard, makes it public)
# then on the backend VM: add the Vercel alias to STORE_CORS/AUTH_CORS, pm2 restart
```
