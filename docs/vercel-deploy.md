# Deploy the storefront to Vercel

This is the focused runbook for putting **`storefront/`** (Next.js 15, App Router)
on **Vercel**. It is derived from reading the actual storefront config, not a
generic template — every env var, setting, and gotcha below was traced to a real
line of code (paths cited inline).

For the **backend** side (Medusa on the Proxmox VM, made public via a Cloudflare
Tunnel) and the end-to-end UAT topology, see [`docs/uat-deploy.md`](./uat-deploy.md).
This guide covers only the Vercel half and references that runbook where the two
meet (the backend URL and CORS).

---

## 0 — The one thing to understand first

The browser **never talks to the Medusa backend directly.** Every cart, product,
region, customer and payment call runs **server-side** (Server Components +
`"use server"` actions). The only two browser→backend hops — Facebook/Google
**OAuth** (`/store/auth/*`) and the printable **invoice**
(`/store/orders/:id/invoice`) — are **same-origin-proxied** by
`storefront/src/middleware.ts`, which rewrites them to `MEDUSA_BACKEND_URL` and
injects the publishable key.

```
  Customer phone ──► https://<your-app>.vercel.app   (Vercel: SSR + middleware proxy)
                              │  server-side only
                              ▼
                     https://api.<domain>   (public HTTPS backend — Cloudflare Tunnel)
                              │
                     Medusa :9000  →  Postgres / Redis / R2 / Bakong / Telegram
```

Two consequences that drive everything below:

1. **The backend must be reachable from Vercel's servers over public HTTPS.**
   A LAN address (`172.16.x.x`) or `localhost` will not work. Stand the backend
   up first per [`docs/uat-deploy.md`](./uat-deploy.md) Phases 1–4 and copy its
   public URL.
2. **`MEDUSA_BACKEND_URL` is server-only** (no `NEXT_PUBLIC_` prefix), so it is
   never exposed to the browser. Because the backend's own `/store` routes are
   called from Vercel's servers, the backend's **CORS allow-list must include the
   Vercel origin** (Step 5).

---

## 1 — Prerequisites

- [ ] **A public HTTPS backend URL** — e.g. `https://<random>.trycloudflare.com`
      (quick tunnel) or `https://api.alistore.com` (named tunnel). From
      [`docs/uat-deploy.md`](./uat-deploy.md) Phase 3.
- [ ] **A store publishable key** — `pk_…`, from the backend's Sales Channel
      (Medusa admin → Settings → API Key Management → Publishable keys, or the
      `SETUP-10` seeded key if UAT reuses the same DB).
- [ ] **The backend's CORS env vars are editable** — you will add the Vercel host
      to `STORE_CORS` / `AUTH_CORS` in Step 5.
- [ ] A Vercel account with access to import this Git repo.

---

## 2 — Import the repo and set the Root Directory (the #1 gotcha)

This is a **monorepo**: the repo root has no `package.json`; `storefront/` and
`backend/` are independent npm projects, each with its own lockfile. Vercel must
be pointed at the subdirectory.

1. Vercel → **Add New… → Project** → import this Git repository.
2. **Root Directory:** click **Edit** and set it to **`storefront`**.
   *(If you skip this, Vercel finds no `package.json` at the root and the build
   fails immediately.)*
3. **Framework Preset:** Next.js (auto-detected once the root is `storefront`).

---

## 3 — Build & runtime settings

Leave the defaults unless noted — they are correct for this project.

| Setting | Value | Why |
|---|---|---|
| **Build Command** | `next build` (default) | from `storefront/package.json` |
| **Install Command** | `npm ci` (auto) | `package-lock.json` + `.npmrc` (`save-exact=true`) are committed |
| **Output** | `.next` (default) | standard Next.js; no `output: 'standalone'` set |
| **Node.js Version** | 20.x (recommended) | Next 15.3.9 supports 18.18+/20/22; no `.nvmrc`/`engines` is committed, so Vercel uses its current default — pin **20.x** in *Settings → General* for parity with the backend |
| **Region** | Singapore `sin1` (recommended) | closest to the Cambodia backend → faster SSR round-trips |

> **No `vercel.json` is needed** and none is committed. Next.js defaults apply.
>
> **Heads-up:** `storefront/next.config.js` sets both `eslint.ignoreDuringBuilds:
> true` and `typescript.ignoreBuildErrors: true`. Type/lint errors will **not**
> fail the Vercel build — keep type-checking in CI, don't rely on the deploy to
> catch them.

---

## 4 — Environment variables

Add these in **Settings → Environment Variables** (apply to *Production* and
*Preview* as needed). Every key below was traced to source.

### Required — the build or the app breaks without these

| Key | Scope | Example | Read at |
|---|---|---|---|
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | client + **build** | `pk_a39b79c7…` | `check-env-variables.js` **fails the build if missing**; `src/lib/config.ts:14`, `src/middleware.ts:45` |
| `MEDUSA_BACKEND_URL` | **server-only** | `https://api.alistore.com` | `src/lib/config.ts:7-8`, `src/middleware.ts:43` — **defaults to `http://localhost:9000`**, so it MUST be set |

### Strongly recommended

| Key | Scope | Example | Read at |
|---|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | client | `https://<your-app>.vercel.app` | `src/lib/util/env.ts:2` (`getBaseURL()`, absolute links) — defaults to `https://localhost:8000`. Set **after** the first deploy reveals the URL, then redeploy (Step 5) |
| `NEXT_PUBLIC_DEFAULT_REGION` | client | `kh` | `src/lib/cart.ts:121`, `src/lib/medusa.ts:174` — falls back to the first `/store/regions` entry if unset. **Set `kh`** (the `.env.template` ships an invalid `asain/phnom_penh` placeholder) |

### Optional — feature-dependent

| Key | Scope | Notes |
|---|---|---|
| `NEXT_PUBLIC_USD_KHR_RATE` | client | Exchange rate for USD→KHR display. `src/lib/price.ts:57`. Pair with `USD_KHR_RATE` for the server path; keep both in sync with the backend's rate |
| `USD_KHR_RATE` | server | Server-side fallback for the same rate. `src/lib/price.ts:57` |
| `NEXT_PUBLIC_KHQR_MERCHANT_NAME` | client | Bakong merchant name shown on the KHQR checkout card. `src/app/checkout/khqr/page.tsx:70` |
| `MEDUSA_CLOUD_S3_HOSTNAME` + `MEDUSA_CLOUD_S3_PATHNAME` | server | Only for Medusa **Cloud** S3 images. **Not needed** here — product images come from R2, already allow-listed in `next.config.js` |

### Present in `.env.template` but **not read by any current code** — skip them

`REVALIDATE_SECRET`, `NEXT_PUBLIC_STRIPE_KEY`,
`NEXT_PUBLIC_MEDUSA_PAYMENTS_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_MEDUSA_PAYMENTS_ACCOUNT_ID` — leftovers from the upstream Medusa
starter. Payments in v1 are Bakong KHQR + COD, not Stripe. Leave unset.

> **`NEXT_PUBLIC_*` values are baked into the client bundle at build time.**
> Changing any of them (or the publishable key) requires a **redeploy** to take
> effect — editing the value in the dashboard alone does nothing until the next
> build.

---

## 5 — Deploy, then the two-pass wiring

1. **Deploy.** With the required vars set, click **Deploy**. The build runs
   `check-env-variables.js` → `next build`.
2. **Capture the URL.** Vercel assigns `https://<your-app>.vercel.app`.
3. **Set `NEXT_PUBLIC_BASE_URL`** to that URL and **redeploy** (it feeds absolute
   invoice/OG links via `getBaseURL()`).
4. **Open the backend's CORS to the Vercel origin.** On the backend VM, add the
   `*.vercel.app` host (and later your custom domain) to `.env`:

   ```dotenv
   STORE_CORS=https://<your-app>.vercel.app
   AUTH_CORS=https://api.alistore.com,https://<your-app>.vercel.app
   ```

   then `pm2 restart alistore-backend` (see [`docs/uat-deploy.md`](./uat-deploy.md)
   Phase 5). Without this, server-side `/store` calls are rejected and the app
   renders empty/500.

---

## 6 — Custom domain (optional)

To serve at e.g. `shop.alistore.com`:

1. Vercel → **Settings → Domains** → add the domain; create the DNS record it
   shows (CNAME → `cname.vercel-dns.com`, or via Cloudflare).
2. Update **`NEXT_PUBLIC_BASE_URL`** to the custom domain and **redeploy**.
3. Add the custom domain to the backend `STORE_CORS` / `AUTH_CORS` and restart.

---

## 7 — Verify

In Vercel:

- **Build logs** end with `✓ Compiled` / `Generating static pages`. A failure
  reading `🚫 Missing required environment variables` means the publishable key
  is unset (Step 4).
- **Functions/Runtime logs** (Deployment → Logs) show SSR requests; backend
  connection errors surface here.

On a phone, on cellular (not your LAN), against the deployed URL:

- [ ] Home + category browse render; **product images load** (from R2).
- [ ] PDP: size + color variant selection works; stock note shows.
- [ ] Add to cart → totals correct (USD + KHR rounded to whole riel).
- [ ] COD checkout with a Cambodia phone (`0…` / `+855…`) places an order.
- [ ] Order confirmation → **invoice link** opens
      (`/store/orders/:id/invoice?token=`) — this exercises the middleware proxy.
- [ ] (If OAuth is configured) Facebook/Google login round-trips back to
      `/checkout` with a session — also via the middleware proxy.

---

## Image hosts

`storefront/next.config.js` already allow-lists the production R2 CDN
(`img.alistore.com`), the R2 dev public host, and the Medusa sample S3 buckets,
so Vercel's Image Optimization can fetch them. The committed `http://localhost`
pattern is harmless in production (it simply never matches). **If product images
ever move to a new host, add it to `images.remotePatterns` in `next.config.js`** —
that is a code change requiring a commit + redeploy, not a dashboard setting.

---

## Known caveats & cleanup (non-blocking)

These do not block a deploy but are worth knowing / fixing:

- **`src/lib/data/onboarding.ts:8`** hard-codes `redirect("http://localhost:7001/
  a/orders/:id")`. This is an upstream **Medusa-starter dev artifact** — it only
  fires when the `_medusa_onboarding` cookie is set (the admin's first-run
  onboarding), never on the customer path, so it is harmless in production.
  Clean it up (env-drive or delete the onboarding flow) when convenient.
- **`next-sitemap.js`** references `NEXT_PUBLIC_VERCEL_URL`, but there is **no
  `postbuild` script** and `next-sitemap` is not a dependency — so **no sitemap
  is generated** on Vercel today. If you want one, add the package + a
  `postbuild` script and point `siteUrl` at `NEXT_PUBLIC_BASE_URL` (a full URL
  with protocol; `NEXT_PUBLIC_VERCEL_URL` is a bare host).
- **`.env.template`** ships `NEXT_PUBLIC_DEFAULT_REGION=asain/phnom_penh`, which
  is not a valid ISO-2 region code — use `kh` in Vercel.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails: `🚫 Missing required environment variables` | `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` unset | Set it (Step 4), redeploy |
| Build fails: no `package.json` found | Root Directory not set to `storefront` | Step 2 |
| Pages render but no products/regions; SSR 500s | `MEDUSA_BACKEND_URL` wrong/unreachable, or backend down | Verify the public URL opens; check Vercel runtime logs |
| Products load but every `/store` call 401/blocked (CORS) | Vercel origin not in backend `STORE_CORS`/`AUTH_CORS` | Step 5, restart backend |
| Invoice link or OAuth returns `Publishable API key required` (400) | Publishable key missing, or middleware can't reach `MEDUSA_BACKEND_URL` | Confirm both env vars; confirm backend public URL |
| Images broken / `next/image` host error | Image host not in `remotePatterns` | Add host to `next.config.js`, redeploy |
| Changed a `NEXT_PUBLIC_*` value, no effect | Client env is build-time | **Redeploy** after editing |
| Absolute links point to `localhost:8000` | `NEXT_PUBLIC_BASE_URL` unset | Set to the deployed URL, redeploy |

---

## Update / redeploy workflow

- **Code change:** push to the connected branch → Vercel auto-builds and deploys.
- **Env change:** edit in Vercel → **trigger a redeploy** (client vars are
  build-time; server vars are injected per deployment).
- **Backend URL changed** (e.g. a quick tunnel restarted with a new
  `*.trycloudflare.com`): update `MEDUSA_BACKEND_URL` in Vercel **and** the
  backend's `STORE_CORS`/`AUTH_CORS`, then redeploy both. For stability, use a
  **named** Cloudflare tunnel (`api.<domain>`) so the URL never changes — see
  [`docs/uat-deploy.md`](./uat-deploy.md) Phase 3.
