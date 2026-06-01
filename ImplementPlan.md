# ImplementPlan.md — Ali Store (Medusa v2 + Next.js 15)

Derived from `PRD.md` (rev 2) and `nike-DESIGN.md`. Tasks are small (≤30 min each, ~1 file/feature), grouped by phase in dependency order. Backend task IDs match the API IDs already assigned in `PRD.md §7`.

**Repos:** `backend/` (Medusa v2, Proxmox VM in Cambodia) · `storefront/` (Next.js 15, Vercel).
**Locked design tokens (from nike-DESIGN.md, with your coral substitution):** `ink #111111`, `canvas #ffffff`, `soft-cloud #f5f5f5`, `hairline #cacacb`, `hairline-soft #e5e5e5`, `mute #707072`, `success #007d48`. **Accent/sale = coral (replaces Nike sale-red `#d30005`)**. Fonts: Inter (UI 400/500) + Bebas Neue (96px uppercase campaign tier). 8px spacing grid; pill radius `999px`; product image ratio `1:1` on `soft-cloud`.

---

## ⚠️ CLARIFY (answer before the dependent tasks run)

### Resolved decisions (locked)

- **CLARIFY-01 ✅** — Accent token = coral `#C0461F`, fully replaces Nike's sale-red (sale price, "Sale" link, KHQR action). → FRONTEND-01.
- **CLARIFY-02 ✅** — **English-first for v1.** UI chrome + categories in English; font stack is Latin-only (Inter + Bebas Neue). Khmer UI + Khmer font deferred to **v2**. → FRONTEND-02, SETUP-09, FRONTEND-07.
- **CLARIFY-03 ✅ (mechanism)** — Exchange rate via env var `USD_KHR_RATE` for v1 (admin-editable deferred to v2). Rate _value_ to be provided later; build proceeds with a placeholder. → BACKEND-01.
- **CLARIFY-05 ✅** — Individual KHQR confirmed (type). Real `bank_account`, dev/prod `BAKONG_TOKEN`, and `BAKONG_PROXY_URL` are deploy-time secrets kept only in `.env` (never committed); proxy host added to the SSRF allowlist at deploy. BACKEND-03 builds against the sandbox until provided. → BACKEND-03.
- **CLARIFY-07 ✅** — **Dev (current) = Postgres on the Proxmox VM** (co-located with backend; agent-migratable). **Production (after go-live) = Supabase.** One `DATABASE_URL` per environment, swapped per environment. → SETUP-02.
- **CLARIFY-10 ✅** — VAT = 10% (Cambodia standard), wired but **off** in v1. TIN provided when enabling. → BACKEND-06.
- **CLARIFY-04 ✅** — Delivery fee = **$1.50** (env `DELIVERY_FEE`); free delivery when subtotal **≥ $50** (env `FREE_DELIVERY_THRESHOLD`). USD base; KHR derived via `USD_KHR_RATE`. → BACKEND-01, FRONTEND-14, FRONTEND-15.
- **CLARIFY-06 ✅** — Telegram alert = **full order details**: order #, items (variant + qty), total (USD + KHR), payment method (KHQR/COD), customer name, phone, delivery address, note. `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` are deploy-time `.env` secrets (never committed); **private chat only**. BACKEND-09 builds against placeholders until provided. → BACKEND-09.
- **CLARIFY-08 ✅** — Domain = `alistore.com`. Storefront `shop.alistore.com` → Vercel; images `img.alistore.com` → R2/CDN. (All `<domain>` placeholders in this plan resolve to `alistore.com`.) → SETUP-05, SETUP-11.
- **CLARIFY-09 ✅ (source — superseded)** — Original intent: source = Google Sheet / Excel mapped to BACKEND-02's CSV template. **Superseded by CLARIFY-09 (columns) below: no source sheet exists.** → BACKEND-02.
- **CLARIFY-09 (columns) ✅** — **No source data sheet exists.** Instead of mapping a Google Sheet, BACKEND-02 adopts **Medusa's official product-import CSV format directly** (the columns Medusa Admin's built-in importer expects) and seeds a **simple ready-made sample clothing catalog** against that format for v1 dev. This closes the column-mapping question entirely; a real export can be re-mapped later if one is ever produced. → BACKEND-02.
- **CLARIFY-11 ✅ (mechanism: dev-first)** — No production backend hostname chosen yet (no domain purchased). **Dev runs against the local backend (`localhost:9000`)**; the production Medusa API hostname — which sets storefront `MEDUSA_BACKEND_URL`, the CSP `connect-src` host, and the CORS allowlist — is deferred until a domain is selected/bought. SETUP-10 already builds against localhost; SETUP-11 (DNS) awaits the domain. The hostname _value_ is tracked under "Still pending" below. → SETUP-10, SETUP-11.

### Still pending (provide later — non-blocking; tasks build against env placeholders / sandbox)

- **CLARIFY-11 (hostname value)** — The _value_ of the production Medusa API hostname is still unknown because no domain has been bought yet (mechanism resolved above: dev-first on `localhost:9000`). When the domain is chosen, set `MEDUSA_BACKEND_URL`, the CSP `connect-src` host, and the CORS allowlist, and unblock SETUP-11 (DNS). Non-blocking for dev. → SETUP-11.
- **CLARIFY-08-REOPEN ⚠️** — **Conflict flag:** CLARIFY-08 previously locked `Domain = alistore.com` (storefront `shop.alistore.com`, images `img.alistore.com`). The CLARIFY-11 answer ("not sure yet, will find and buy domain later") indicates the domain is **not actually owned/confirmed**. All `<domain>` placeholders (SETUP-05 prod URL, SETUP-11 subdomains, CSP `img-src`/`connect-src`) therefore remain provisional until the real domain is purchased. Resolve with a dedicated `/clarify CLARIFY-08` once the domain is bought. → SETUP-05, SETUP-11.

---

## Phase 1 — SETUP

### ✅ SETUP-01: Initialize Medusa v2 backend (pinned stable)

- **Completed 2026-05-31**: Backend scaffolded; all `@medusajs/*` pinned exact `2.15.3`; `medusa develop` boots (port 9000); DB (`172.16.18.10:5432/medusa`, PG 18.4) + Redis (`172.16.18.10:6379`) connect; `/app` reachable; admin user created and authenticates. ⚠️ Criterion 4 (MFA enrollment screen) DEFERRED — the OSS `@medusajs/dashboard@2.15.3` bundle ships no TOTP/2FA enrollment UI, contradicting the "MFA-capable patch" premise. Tracked as follow-up `SETUP-01C` (verify whether admin MFA needs a plugin / custom module / Medusa Cloud).
- **Objective**: Create the Medusa backend project skeleton on a pinned stable version.
- **Requirements**: Run `npx create-medusa-app@latest backend` to scaffold, then **pin every `@medusajs/*` dependency to exact `2.15.3`** (no `^`/`~`) — this is the MFA-capable patch and is still outside the post-v2.13.6 migration-bug window. Verify the version on install. Node 20 LTS. Skip the bundled storefront. Commit base + lockfile.
- **Dependencies**: None
- **Deliverables**: `backend/` (incl. `medusa-config.ts`, `package.json`, `package-lock.json`)
- **Acceptance Criteria**: `package.json` shows exact `2.15.3` for all `@medusajs/*`; `npx medusa develop` boots; admin reachable at `/app`; MFA enrollment screen accessible for the admin user.

### ✅ SETUP-01B: Supply-chain hardening policy

- **Completed 2026-05-31**: `backend/.npmrc` has `save-exact=true`; all backend `package.json` deps pinned exact (no `^`/`~`, incl. `overrides`); `ci/audit.yml` added (allowlist-aware `npm audit` gate, fails on non-allowlisted high/critical — validated); `docs/supply-chain.md` policy added. NOTE: baseline tree has high advisories beyond the documented `uuid` one (e.g. `@mikro-orm/knex`, `@opentelemetry/exporter-prometheus`) — triage into `docs/npm-audit-exceptions.md` is follow-up security work. Storefront pinning deferred until it's scaffolded.
- **Objective**: Reduce npm supply-chain attack risk across both repos.
- **Requirements**: Pin all deps to exact versions (no `^`/`~`); commit lockfiles; use `npm ci` everywhere (CI + server), never `npm install` in deploy; adopt a ~7–14 day cooldown before bumping to any newly published version; run `npm audit` in CI and fail on high/critical; review `bakong-khqr` source and vendor its QR logic into `src/modules/bakong-payment/` rather than depending on it live; keep dependency count minimal.
- **Dependencies**: SETUP-01
- **Deliverables**: `.npmrc` (`save-exact=true`), CI audit step (`ci/audit.yml`), `docs/supply-chain.md`
- **Acceptance Criteria**: `save-exact=true` set; CI fails on a seeded high-severity advisory; no `^`/`~` ranges in either `package.json`.

### ✅ SETUP-02: Connect Postgres

- _Completed 2026-05-31 — `DATABASE_URL` set in `backend/.env`; `npx medusa db:migrate` ran clean; 138 core tables verified (product, order, customer, region, …)._
- **Objective**: Point Medusa at the chosen Postgres.
- **Requirements**: Set `DATABASE_URL` in `.env` — Postgres on the Proxmox VM for dev (current); Supabase for production after go-live (same URL var, swapped per environment). Run `npx medusa db:migrate` to apply core schema.
- **Dependencies**: SETUP-01
- **Deliverables**: `backend/.env`
- **Acceptance Criteria**: `db:migrate` completes; core tables exist in the DB.

### ✅ SETUP-03: Configure Redis

- _Completed 2026-05-31 — Redis modules (`cache-redis`, `event-bus-redis`, `workflow-engine-redis`) wired in `medusa-config.ts`, gated on `REDIS_URL` with in-memory fallback for dev; `REDIS_URL` set in `.env`/`.env.template`. Verified: `npx medusa develop` boots on :9000 with all three Redis connections established and no event-bus warning. (Note: `workflow-engine-redis` requires `options: { redis: { url } }` in v2.15.3 — the flat `redisUrl` form crashes the loader.)_
- **Objective**: Enable event bus + workflow engine for production reliability.
- **Requirements**: Add Redis modules in `medusa-config.ts` (`@medusajs/event-bus-redis`, `@medusajs/workflow-engine-redis`); set `REDIS_URL`. Dev may use in-memory.
- **Dependencies**: SETUP-01
- **Deliverables**: `medusa-config.ts`, `.env`
- **Acceptance Criteria**: Backend boots with Redis modules loaded; no event-bus warnings in prod mode.

### ✅ SETUP-04: Regions & currencies (USD + KHR)

- _Completed 2026-05-31 — `src/scripts/seed.ts` (region/currency block) sets store `supported_currencies` to USD (default) + KHR and creates a `Cambodia` region (`currency_code: usd`, country `kh`). Ran via `npx medusa exec`; live `/store/regions` returns the Cambodia region (usd) and the store exposes both usd + khr. Per Medusa v2, dual currency is store-level (one `currency_code` per region); KHR derived via `USD_KHR_RATE` (FRONTEND-22 / INTEGRATION-08) — confirmed decision._
- **Objective**: Enable dual currency.
- **Requirements**: Create a Cambodia region with `usd` and `khr` enabled via seed/admin; set USD as store default.
- **Dependencies**: SETUP-02
- **Deliverables**: `src/scripts/seed.ts` (region/currency block)
- **Acceptance Criteria**: Store API `/store/regions` returns a region exposing both `usd` and `khr`.

### ✅ SETUP-05: Cloudflare R2 file provider

- _Completed 2026-05-31 — R2 bucket `ali-store-products` wired via `@medusajs/file-s3`; upload→public-URL load verified end-to-end against the temporary `r2.dev` URL. Production `img.alistore.com` swap tracked in SETUP-11._
- **Objective**: Store product images on R2 served via CDN.
- **Requirements**: Configure `@medusajs/file-s3` in `medusa-config.ts` with R2 endpoint, bucket, keys, and public `img.<domain>` base URL. Secrets in `.env`.
- **Dependencies**: SETUP-01
- **Deliverables**: `medusa-config.ts`, `.env`
- **Acceptance Criteria**: Uploading an image in admin returns an `img.<domain>` URL that loads.

### ✅ SETUP-06: `stock_movement` module + model

- _Completed 2026-05-31 — Module `stockMovement` created at `src/modules/stock-movement/` (model + service + index); `stock_movement` model has exactly `id, variant_id, type(enum in|out|adjust), quantity(number), reason(text), order_id(nullable), created_by` (`created_at` auto-added by Medusa DML). Registered in `medusa-config.ts`; `npm run build` completes successfully (module loads without error). Migrations deferred to SETUP-08 per plan._
- **Objective**: Define the custom stock ledger.
- **Requirements**: Create module with model fields exactly: `id`, `variant_id`, `type` (enum `in|out|adjust`), `quantity` (int), `reason` (text), `order_id` (nullable), `created_by` (text), `created_at`.
- **Dependencies**: SETUP-01
- **Deliverables**: `src/modules/stock-movement/models/stock-movement.ts`, `src/modules/stock-movement/service.ts`, `src/modules/stock-movement/index.ts`
- **Acceptance Criteria**: Module registers in `medusa-config.ts` without error.

### ✅ SETUP-07: `customer_social_identity` module + model

- _Completed 2026-05-31 — Module `socialIdentity` created at `src/modules/social-identity/` (model + service + index); `customer_social_identity` model has exactly `id, customer_id, provider(text, default "facebook"), provider_user_id` (`created_at` auto-added by Medusa DML). Registered in `medusa-config.ts`; `npm run build` completes successfully (module loads without error). Migrations deferred to SETUP-08 per plan._
- **Objective**: Define the Facebook-login identity link.
- **Requirements**: Model fields exactly: `id`, `customer_id`, `provider` (default `facebook`), `provider_user_id`, `created_at`.
- **Dependencies**: SETUP-01
- **Deliverables**: `src/modules/social-identity/models/social-identity.ts`, `service.ts`, `index.ts`
- **Acceptance Criteria**: Module registers without error.

### ✅ SETUP-08: Generate & run custom migrations

- _Completed 2026-05-31 — Generated + applied migrations for both custom modules against the UAT DB (`172.16.18.10/medusa`). `npx medusa db:generate stockMovement socialIdentity` (camelCase module keys — the PascalCase form in the requirement errors `UNKNOWN_MODULES`) produced `src/modules/stock-movement/migrations/Migration20260531123948.ts` + `src/modules/social-identity/migrations/Migration20260531123949.ts`; `npx medusa db:migrate` applied both. Verified via `information_schema`: `stock_movement` (id, variant_id, type[check in|out|adjust], quantity, reason, order_id nullable, created_by + DML created_at/updated_at/deleted_at) and `customer_social_identity` (id, customer_id, provider default `facebook`, provider_user_id + DML timestamps) exist with the specified columns._
- **Objective**: Persist the two custom modules.
- **Requirements**: Run `npx medusa db:generate StockMovement SocialIdentity` then `npx medusa db:migrate`. (Medusa emits timestamped migrations after core — no manual numbering.)
- **Dependencies**: SETUP-06, SETUP-07
- **Deliverables**: `src/modules/*/migrations/*.ts`
- **Acceptance Criteria**: Tables `stock_movement` and `customer_social_identity` exist with the specified columns.

### ✅ SETUP-09: Seed product categories (Khmer/EN)

- _Completed 2026-05-31 — `src/scripts/seed.ts` (categories block) seeds 6 English v1 categories with explicit handles (T-shirt, Polo, Outerwear, Hoodie, Pants, Accessories) via `createProductCategoriesWorkflow`, idempotent by handle. Ran `npx medusa exec` against the dev DB: created 5 (Pants skipped — handle already held by a pre-existing default Medusa demo category). Live `GET /store/product-categories` returns all seeded categories `is_active: true`. Khmer labels deferred to v2 per CLARIFY-02._
- **Objective**: Create the storefront category tabs.
- **Requirements**: Seed categories with **English** names for v1 (e.g. `T-shirt`, `Polo`, `Outerwear`) and handles. (Khmer category names = v2.)
- **Dependencies**: SETUP-02
- **Deliverables**: `src/scripts/seed.ts` (categories block)
- **Acceptance Criteria**: `/store/product-categories` returns the seeded categories.

### ✅ SETUP-10: Initialize Next.js 15 storefront

- _Completed 2026-05-31 — Official `nextjs-starter-medusa` cloned into `storefront/` (Next.js 15.3.9, React 19, App Router); nested `.git` + Yarn artifacts removed and converted to **npm** (`.npmrc save-exact=true`, committed `package-lock.json`). **All** deps pinned exact (no `^`/`~`): `@medusajs/js-sdk` + `@medusajs/types` → `2.15.3` (backend core); `@medusajs/ui` 4.1.15, `@medusajs/ui-preset`/`icons` 2.15.5. `.env.local` wired to dev backend (`localhost:9000`), Default Publishable API Key, default region `kh`. `next dev` boots on :8000; `GET /kh/store` → **200** listing all 4 seeded products. **Tailwind v4 DEFERRED to FRONTEND-01** (user-approved): the starter ships Tailwind v3 + `@medusajs/ui`; the v4 `@theme`-token migration belongs to the design-system tasks. Follow-ups: (a) `next.config.js` image-host allowlist for `img.<domain>` (SETUP-05/SETUP-11); (b) `npm audit` 1 high (`next@15.3.9`) + 1 moderate (transitive `postcss`) — fix requires a deliberate Next bump, tracked as storefront hardening._
- **Objective**: Create the storefront from the Medusa Next.js Starter.
- **Requirements**: Clone Medusa `nextjs-starter`; set `MEDUSA_BACKEND_URL`, publishable key; Tailwind v4 present; pin all deps to exact versions and commit the lockfile (per SETUP-01B); boot.
- **Dependencies**: SETUP-01
- **Deliverables**: `storefront/` (`src/app/`, `.env.local`)
- **Acceptance Criteria**: Storefront runs and lists seeded products from the backend.

### SETUP-11: Cloudflare DNS / domain / subdomains

- **Objective**: Route the domain.
- **Requirements**: Add domain to Cloudflare; `shop.<domain>` → Vercel, `img.<domain>` → R2, backend host → Proxmox; enable SSL + CDN caching.
- **Dependencies**: SETUP-05, SETUP-10, CLARIFY-11 (hostname value), CLARIFY-08-REOPEN (real domain)
- **Deliverables**: Cloudflare DNS records (documented in `infra/dns.md`)
- **Acceptance Criteria**: All three subdomains resolve over HTTPS.

### ✅ SETUP-12: Secrets scaffolding

- _Completed 2026-05-31 — keys appended to `backend/.env.template` (repo's committed env convention; `.env.example` would be git-ignored per `.gitignore`)._
- **Objective**: Centralize all external secrets.
- **Requirements**: Define env keys (no values committed): `BAKONG_TOKEN`, `BAKONG_PROXY_URL`, `BAKONG_ACCOUNT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FB_APP_ID`, `FB_APP_SECRET`, `USD_KHR_RATE`, `LOW_STOCK_THRESHOLD`, `DELIVERY_FEE`, `FREE_DELIVERY_THRESHOLD`.
- **Dependencies**: SETUP-01
- **Deliverables**: `.env.example`
- **Acceptance Criteria**: `.env.example` lists every key; none have real values.

---

## Phase 2 — BACKEND (Medusa)

### ✅ BACKEND-01: App settings (rate, threshold, delivery)

- _Completed 2026-05-31 — `src/lib/settings.ts` reads the four env vars with documented fallbacks; `usdToKhr` rounds to whole riel. Type-check + runtime acceptance verified._
- **Objective**: Expose exchange rate, low-stock threshold (default 5), delivery fee, and free-delivery threshold to the rest of the app.
- **Requirements**: Read from env (`USD_KHR_RATE`, `LOW_STOCK_THRESHOLD` default 5, `DELIVERY_FEE`, `FREE_DELIVERY_THRESHOLD`); provide a small config helper `src/lib/settings.ts`. KHR conversion rounds to whole riel. (Rate + delivery _values_ provided later — placeholders until then.)
- **Dependencies**: SETUP-12
- **Deliverables**: `src/lib/settings.ts`
- **Acceptance Criteria**: Helper returns numeric values; `usdToKhr(1)` returns the configured rate, rounded.

### BACKEND-02: CSV product/variant import

- **Objective**: Bulk-load catalog with per-size/color variants.
- **Requirements**: Define the import CSV using **Medusa's official product-import column format** (one row per variant: product title/handle, category, color, size, SKU, USD price, KHR price, initial stock, image URL). No source Google Sheet exists (CLARIFY-09 resolved) — author a **simple ready-made sample clothing catalog** against that format; use Medusa Admin's built-in product import.
- **Dependencies**: SETUP-09
- **Deliverables**: `imports/products-template.csv`, `docs/import.md`
- **Acceptance Criteria**: Importing the template creates products with variants and inventory levels; variants visible in `/store/products`.

### ✅ BACKEND-03: Bakong KHQR payment provider — start ( Done Run security Review)

- _Completed 2026-06-01 — Custom Medusa payment provider `bakong-payment` (`pp_bakong_khqr`) with **vendored** KHQR generation (EMVCo TLV + CRC-16/CCITT-FALSE + md5 reference; no `bakong-khqr` package, per security.md) and an SSRF-guarded proxy client for the deeplink. `POST /store/payments/khqr/start` ({cart_id, currency}) reserves stock (409 out-of-stock), creates payment_collection + Bakong payment_session (native model — order created at completion per PRD §4), and returns {qr, deeplink, reference, expires_at} (deeplink null in sandbox; 502 when proxy configured-but-down). zod validation + per-IP rate limits (5/min, 20/hr) via cache module. `npm run build` green; QR verified structurally valid (correct tag order, CRC recomputes, reference = md5(qr)). NOTE: live HTTP round-trip against a seeded stocked cart not executed in-session (verified at generation+build layer). Verify/capture/stock-out = BACKEND-03B; reservation reconciliation/release = BACKEND-03B/BACKEND-10. Docs: `docs/payments-khqr.md`._
- **Objective**: Generate a dynamic KHQR + deeplink for a cart.
- **Requirements**: Custom payment module `bakong-payment` using `bakong-khqr`; call Bakong through `BAKONG_PROXY_URL`; account type Individual (config). Implements `POST /store/payments/khqr/start` body `{cart_id, currency}` → `{qr, deeplink, reference, expires_at}`; reserve inventory; create order `pending_payment`; errors 409 out-of-stock, 502 proxy/Bakong down.
- **Dependencies**: BACKEND-01, SETUP-03 (Bakong creds/proxy are deploy-time .env secrets — sandbox until provided)
- **Deliverables**: `src/modules/bakong-payment/`, `src/api/store/payments/khqr/start/route.ts`
- **Acceptance Criteria**: Endpoint returns a scannable `qr` string + `reference` against sandbox.

### ✅ BACKEND-03B: Bakong KHQR status + verify

- _Completed 2026-06-01 — `GET /store/payments/khqr/status?reference=` → `{status: pending|paid|expired}`. Server-side verify via the in-Cambodia proxy (`check_transaction_by_md5`, vendored SSRF-guarded `lib/proxy.ts`) keyed on the md5 reference — never trusts the client; result cached ≥3s. On `paid`: releases the `/start` reservation, runs `completeCartWorkflow` (creates the order; the Bakong provider's `authorizePayment` re-verifies via proxy and returns `captured`, so the order is paid), then writes one idempotent `stock_movement(type=out)` per line item (`order_id`, `created_by=system`). On expiry: releases the reservation. zod-validated `reference`; rate limits 60/min + 120/hr per reference + 60/min/IP. `reference→cart` resolved via a cache mapping written by `/start`. `npm run build` + `tsc --noEmit` green. NOTE: live sandbox `paid` flip not executed in-session (no Bakong proxy configured — deploy-time secret); without a proxy the endpoint correctly stays `pending` (verified at code + build layer). Stock-out written inline via the module CRUD (BACKEND-07 to reconcile to a shared method, per locked decision). Supporting edits: `bakong-payment/lib/proxy.ts` (+`checkTransactionByMd5`), `bakong-payment/service.ts` (authorize gate), `khqr/start/route.ts` (reference→cart mapping), `docs/payments-khqr.md`._
- **Objective**: Confirm payment and finalize the order.
- **Requirements**: `GET /store/payments/khqr/status?reference=` → `{status: pending|paid|expired}`; server-side verify via proxy by md5/reference (never trust client); on `paid` set order `paid`, commit reservation, write `stock_movement(type=out)`; on expiry release reservation.
- **Dependencies**: BACKEND-03, BACKEND-07
- **Deliverables**: `src/api/store/payments/khqr/status/route.ts`
- **Acceptance Criteria**: Simulated sandbox payment flips status to `paid`, order becomes `paid`, one `out` movement is recorded.

### BACKEND-04: COD order endpoint

- **Objective**: Place a cash-on-delivery order.
- **Requirements**: `POST /store/orders/cod` body `{cart_id, phone, name, address, note}` → `{order_id, status:"pending_confirmation"}`; reserve inventory; mark unpaid; error 409 out-of-stock. Emits an order-placed event.
- **Dependencies**: BACKEND-01
- **Deliverables**: `src/api/store/orders/cod/route.ts`
- **Acceptance Criteria**: Endpoint creates an order with status `pending_confirmation` and reserved stock.

### BACKEND-05: Facebook OAuth — start

- **Objective**: Begin optional social login.
- **Requirements**: `GET /store/auth/facebook` → redirect to Facebook OAuth (uses `FB_APP_ID`).
- **Dependencies**: SETUP-12
- **Deliverables**: `src/api/store/auth/facebook/route.ts`
- **Acceptance Criteria**: Hitting the route 302-redirects to Facebook with correct client_id + redirect_uri.

### BACKEND-05B: Facebook OAuth — callback

- **Objective**: Complete login and link identity.
- **Requirements**: `GET /store/auth/facebook/callback?code=` → exchange code, upsert `customer`, create `customer_social_identity` (`provider=facebook`, `provider_user_id`), return session + `{customer}`; error 401 on failure.
- **Dependencies**: BACKEND-05, SETUP-07
- **Deliverables**: `src/api/store/auth/facebook/callback/route.ts`
- **Acceptance Criteria**: A test FB login creates a customer + one `customer_social_identity` row and returns a session.

### BACKEND-06: Invoice (VAT-ready HTML)

- **Objective**: Render a printable invoice per order.
- **Requirements**: `GET /store/orders/:id/invoice` (order-token auth) → printable HTML with line items, delivery fee, total; include an optional **VAT line at 10% (Cambodia standard)** + TIN field, hidden/0 by default (TIN provided when enabling); errors 403/404.
- **Dependencies**: BACKEND-04
- **Deliverables**: `src/api/store/orders/[id]/invoice/route.ts`, `src/lib/invoice-template.ts`
- **Acceptance Criteria**: Endpoint returns valid HTML for a real order; VAT line absent when disabled.

### BACKEND-07: Stock movements + auto stock-out

- **Objective**: Admin stock-in endpoint and automatic stock-out on order.
- **Requirements**: `POST /admin/stock-movements` (admin auth) body `{variant_id, type, quantity, reason}` → adjusts the variant `inventory_level` and writes a `stock_movement` row; provide a service method reused by BACKEND-03B/04 to write `type=out` on order commit with `order_id` + `created_by`.
- **Dependencies**: SETUP-08
- **Deliverables**: `src/api/admin/stock-movements/route.ts`, `src/modules/stock-movement/service.ts`
- **Acceptance Criteria**: Posting `type=in, quantity=10` raises the inventory level by 10 and inserts one movement row.

### BACKEND-08: Sales report endpoint

- **Objective**: Period revenue/order summary.
- **Requirements**: `GET /admin/reports/sales?from=&to=` (admin) → `{orders, revenue, top_variants[]}` aggregating paid/confirmed orders in range.
- **Dependencies**: BACKEND-03B, BACKEND-04
- **Deliverables**: `src/api/admin/reports/sales/route.ts`
- **Acceptance Criteria**: For a known set of test orders, `orders` count and `revenue` total match.

### BACKEND-08B: Stock report endpoint

- **Objective**: Current stock + low-stock list.
- **Requirements**: `GET /admin/reports/stock?low_threshold=5` (admin) → `{levels[], low_stock[]}`; default threshold from BACKEND-01.
- **Dependencies**: BACKEND-07
- **Deliverables**: `src/api/admin/reports/stock/route.ts`
- **Acceptance Criteria**: Variants at/below threshold appear in `low_stock[]`; others don't.

### BACKEND-09: Telegram order alert (subscriber)

- **Objective**: Notify the team on every placed order.
- **Requirements**: Subscriber on the order-placed event → POST to Telegram Bot API (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) to a private chat with full order details (order #, items, total USD+KHR, payment method, customer name, phone, address, note); retry on send failure.
- **Dependencies**: BACKEND-04
- **Deliverables**: `src/subscribers/order-placed.ts`
- **Acceptance Criteria**: Placing a COD order posts a message to the configured chat.

### BACKEND-10: Reservation expiry job

- **Objective**: Release stock from unpaid KHQR orders.
- **Requirements**: Scheduled job releasing reservations + cancelling orders still `pending_payment` past the KHQR `expires_at`.
- **Dependencies**: BACKEND-03B
- **Deliverables**: `src/jobs/expire-reservations.ts`
- **Acceptance Criteria**: An expired unpaid order is cancelled and its reserved stock returns to available.

---

## Phase 3 — FRONTEND (DESIGN.md)

### FRONTEND-01: Design tokens

- **Objective**: Encode the Nike token set + coral accent in the theme.
- **Requirements**: In Tailwind v4 `@theme`, define `ink #111111`, `canvas #ffffff`, `soft-cloud #f5f5f5`, `hairline #cacacb`, `hairline-soft #e5e5e5`, `mute #707072`, `success #007d48`, and `accent #C0461F` (coral; replaces Nike's sale-red); 8px spacing scale; pill radius `999px`.
- **Dependencies**: SETUP-10
- **Deliverables**: `src/styles/globals.css`
- **Acceptance Criteria**: Utilities like `bg-ink`, `text-accent`, `rounded-pill` resolve to the specified values.

### FRONTEND-02: Fonts

- **Objective**: Load the Latin font stack (English-first v1).
- **Requirements**: `next/font` for Inter (400/500) and Bebas Neue (campaign 96px/0.9/uppercase); set CSS families. (Khmer font = v2.)
- **Dependencies**: SETUP-10
- **Deliverables**: `src/lib/fonts.ts`, `src/app/layout.tsx`
- **Acceptance Criteria**: Latin text renders Inter/Bebas with no fallback fonts.

### FRONTEND-03: Button + pill primitives

- **Objective**: Core CTA + chip components.
- **Requirements**: `PillButton` (ink bg / white text / `button-md` 16px/500, height 48px, padding 12×24, radius pill); `SearchPill` (soft-cloud); `Chip` (active = ink fill, inactive = hairline border).
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/ui/PillButton.tsx`, `SearchPill.tsx`, `Chip.tsx`
- **Acceptance Criteria**: Components render with correct colors, 48px height, pill radius; ≥44px touch target.

### FRONTEND-04: Top nav (responsive)

- **Objective**: Header with nav, currency toggle, cart.
- **Requirements**: Desktop = wordmark + category links + Sale (accent) + search/user/bag icons; mobile = hamburger + wordmark + bag; currency toggle (USD/KHR); hairline-soft bottom border.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/layout/TopNav.tsx`
- **Acceptance Criteria**: Links show on desktop, collapse to hamburger ≤599px; toggle switches currency state.

### FRONTEND-05: Product card

- **Objective**: The catalog tile.
- **Requirements**: 1:1 image on `soft-cloud` (no radius), ID (mute caption-sm), name (`body-strong` 16/500), price block: original strike-through in `mute`, sale price in `accent`; full-price items show ink-only price.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/product/ProductCard.tsx`
- **Acceptance Criteria**: Sale item shows struck original + coral sale price; non-sale shows single ink price.

### FRONTEND-06: Product grid (responsive)

- **Objective**: Reflowing grid.
- **Requirements**: 4-up (≥1440) → 3-up (desktop) → 2-up (≤1023) → 1-up (≤599); 8px-grid gaps.
- **Dependencies**: FRONTEND-05
- **Deliverables**: `src/components/product/ProductGrid.tsx`
- **Acceptance Criteria**: Column count changes at each breakpoint.

### FRONTEND-07: Category pill tabs

- **Objective**: Horizontal category selector (English v1).
- **Requirements**: Scrollable `Chip` row; active = ink fill; leading search pill.
- **Dependencies**: FRONTEND-03, SETUP-09
- **Deliverables**: `src/components/product/CategoryTabs.tsx`
- **Acceptance Criteria**: Renders seeded categories; selecting one marks it active.

### FRONTEND-08: Campaign hero band

- **Objective**: Editorial hero.
- **Requirements**: `soft-cloud` band, eyebrow (caption-sm uppercase), display headline (Bebas tier), `PillButton` "Shop now"; horizontal on desktop.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/layout/Hero.tsx`
- **Acceptance Criteria**: Renders headline + working CTA; stacks on mobile.

### FRONTEND-09: Catalog / Home page

- **Objective**: Compose the landing page.
- **Requirements**: TopNav + Hero + CategoryTabs + ProductGrid; mobile bottom bar (FRONTEND-21).
- **Dependencies**: FRONTEND-04, FRONTEND-06, FRONTEND-07, FRONTEND-08
- **Deliverables**: `src/app/page.tsx`
- **Acceptance Criteria**: Page renders all sections with placeholder data.

### FRONTEND-10: Category page

- **Objective**: Per-category listing.
- **Requirements**: Route `/[category]`; filtered grid; reuses FilterSidebar.
- **Dependencies**: FRONTEND-09, FRONTEND-11
- **Deliverables**: `src/app/category/[handle]/page.tsx`
- **Acceptance Criteria**: Renders only that category's products.

### FRONTEND-11: Filter sidebar / drawer

- **Objective**: Filters by category/size/color/price.
- **Requirements**: Desktop 220px left rail (hairline dividers, group headers `heading-md`); mobile off-canvas drawer toggled from a Filter button.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/product/FilterSidebar.tsx`
- **Acceptance Criteria**: Rail shows on desktop; becomes a drawer ≤1023px.

### FRONTEND-12: PDP image gallery

- **Objective**: Product images.
- **Requirements**: Large 1:1 image on `soft-cloud` + thumbnail strip; `next/image`.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/product/Gallery.tsx`
- **Acceptance Criteria**: Selecting a thumbnail swaps the main image.

### FRONTEND-13: Variant picker (color + size + stock)

- **Objective**: Choose variant with live stock state.
- **Requirements**: Color swatch dots (active = ink ring), size pills; out-of-stock size = disabled + struck; show "N left" / "sold out" from inventory.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/product/VariantPicker.tsx`
- **Acceptance Criteria**: A zero-stock size is non-selectable and struck; selection sets the active variant.

### FRONTEND-14: PDP action block

- **Objective**: Price + buy actions.
- **Requirements**: Price (sale in accent + struck original), `PillButton` "Add to bag", outline "Pay with KHQR" (qr icon), free-delivery note (free over $50).
- **Dependencies**: FRONTEND-13, FRONTEND-03
- **Deliverables**: `src/components/product/BuyBox.tsx`, `src/app/product/[handle]/page.tsx`
- **Acceptance Criteria**: PDP composes gallery + picker + actions; buttons enabled only with a variant selected.

### FRONTEND-15: Cart page

- **Objective**: Review bag.
- **Requirements**: Line items (variant, qty steppers, remove), subtotal, delivery fee + free-over-threshold note ($1.50 fee, free over $50), Checkout `PillButton`.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/app/cart/page.tsx`
- **Acceptance Criteria**: Qty change updates subtotal; fee shows/zeroes per threshold.

### FRONTEND-16: Checkout form

- **Objective**: Delivery info + payment choice.
- **Requirements**: Fields Full Name, **Phone (required)**, Address, Note; payment radio KHQR / COD; summary with total; Place-order `PillButton` disabled until phone valid.
- **Dependencies**: FRONTEND-15
- **Deliverables**: `src/app/checkout/page.tsx`, `src/components/checkout/DeliveryForm.tsx`
- **Acceptance Criteria**: Submit blocked without phone; both payment options selectable.

### FRONTEND-17: Facebook login button

- **Objective**: Optional social sign-in.
- **Requirements**: "Continue with Facebook" linking to `/store/auth/facebook`; prefills name on return.
- **Dependencies**: FRONTEND-16
- **Deliverables**: `src/components/checkout/FacebookLogin.tsx`
- **Acceptance Criteria**: Button initiates the FB flow; returned name prefills the form.

### FRONTEND-18: KHQR pay screen

- **Objective**: Show QR and await payment.
- **Requirements**: Render `qr` + deeplink button + countdown to `expires_at` + auto-poll; "regenerate" on expiry.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/app/checkout/khqr/page.tsx`
- **Acceptance Criteria**: Displays a scannable QR and a live countdown; expiry reveals regenerate.

### FRONTEND-19: Order confirmation

- **Objective**: Post-order screen for both paths.
- **Requirements**: Paid → receipt + invoice link; COD → "our team will contact you" + Facebook page + Telegram support buttons + invoice link.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/app/order/[id]/page.tsx`
- **Acceptance Criteria**: Paid and COD orders each render their correct variant.

### FRONTEND-20: Footer

- **Objective**: Site footer.
- **Requirements**: Link columns (Help, Delivery, Telegram, Facebook), hairline dividers, `utility-xs` copyright row.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/layout/Footer.tsx`
- **Acceptance Criteria**: Footer renders with dividers and links.

### FRONTEND-21: Mobile bottom bar

- **Objective**: Persistent cart/checkout bar on mobile.
- **Requirements**: Item count left, Checkout `PillButton` right; hidden on desktop. (Normal flow — no `position: fixed` issues.)
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/layout/BottomBar.tsx`
- **Acceptance Criteria**: Shows ≤599px with live item count; hidden on desktop.

### FRONTEND-22: Currency formatting

- **Objective**: USD/KHR display logic.
- **Requirements**: Formatter using `USD_KHR_RATE`; USD 2-dp, KHR whole riel with `៛`; driven by the nav toggle.
- **Dependencies**: FRONTEND-04, BACKEND-01
- **Deliverables**: `src/lib/price.ts`
- **Acceptance Criteria**: Toggling currency reformats all prices; KHR has no decimals.

---

## Phase 4 — INTEGRATION

### INTEGRATION-01: Catalog data wiring

- **Objective**: Real products/categories on storefront.
- **Requirements**: Configure Medusa JS SDK client; fetch products + categories into Home/Category/PDP.
- **Dependencies**: FRONTEND-09, FRONTEND-10, FRONTEND-14, SETUP-10
- **Deliverables**: `src/lib/medusa.ts`
- **Acceptance Criteria**: Catalog shows real backend products with prices.

### INTEGRATION-02: Cart operations

- **Objective**: Wire add/update/remove.
- **Requirements**: Cart create/line-item add/update/delete via SDK; persist cart id.
- **Dependencies**: INTEGRATION-01, FRONTEND-15
- **Deliverables**: `src/lib/cart.ts`
- **Acceptance Criteria**: Adding from PDP updates cart count and cart page.

### INTEGRATION-03: Variant availability wiring

- **Objective**: Real stock in the picker.
- **Requirements**: Bind `VariantPicker` to inventory levels per variant.
- **Dependencies**: INTEGRATION-01, FRONTEND-13
- **Deliverables**: `src/components/product/VariantPicker.tsx` (data wiring)
- **Acceptance Criteria**: Out-of-stock variants from the DB render as struck/disabled.

### INTEGRATION-04: COD submission

- **Objective**: Connect checkout to BACKEND-04.
- **Requirements**: COD path POSTs `/store/orders/cod`; on success route to confirmation (COD variant).
- **Dependencies**: FRONTEND-16, BACKEND-04, FRONTEND-19
- **Deliverables**: `src/lib/checkout.ts` (cod)
- **Acceptance Criteria**: Submitting COD creates a `pending_confirmation` order and lands on the COD confirmation.

### INTEGRATION-05: KHQR submission + polling

- **Objective**: Connect checkout to BACKEND-03/03B.
- **Requirements**: KHQR path calls `/khqr/start`, renders pay screen, polls `/khqr/status`; on `paid` route to paid confirmation.
- **Dependencies**: FRONTEND-18, BACKEND-03, BACKEND-03B, FRONTEND-19
- **Deliverables**: `src/lib/checkout.ts` (khqr)
- **Acceptance Criteria**: Sandbox payment moves the UI from pending → paid confirmation.

### INTEGRATION-06: Facebook login wiring

- **Objective**: End-to-end social login.
- **Requirements**: Wire button → BACKEND-05/05B → session → prefilled form.
- **Dependencies**: FRONTEND-17, BACKEND-05B
- **Deliverables**: `src/lib/auth.ts`
- **Acceptance Criteria**: Completing FB login returns to checkout with the name prefilled.

### INTEGRATION-07: Invoice link wiring

- **Objective**: Open invoice from confirmation.
- **Requirements**: Link confirmation to `/store/orders/:id/invoice` with order token.
- **Dependencies**: FRONTEND-19, BACKEND-06
- **Deliverables**: `src/app/order/[id]/page.tsx` (link)
- **Acceptance Criteria**: Invoice opens for that order; 403 for a wrong token.

### INTEGRATION-08: Currency end-to-end

- **Objective**: Selected currency drives KHQR amount.
- **Requirements**: Pass toggle currency through checkout into `/khqr/start`; verify amount matches converted value.
- **Dependencies**: FRONTEND-22, INTEGRATION-05
- **Deliverables**: `src/lib/checkout.ts` (currency)
- **Acceptance Criteria**: KHR checkout generates a KHQR for the correct whole-riel amount.

### INTEGRATION-09: Image delivery

- **Objective**: Fast images via R2/CDN.
- **Requirements**: Add `img.<domain>` to `next.config` `images.remotePatterns`; use `next/image` with sizes; lazy-load.
- **Dependencies**: SETUP-05, SETUP-11, FRONTEND-05
- **Deliverables**: `next.config.js`
- **Acceptance Criteria**: Product images load from `img.<domain>` as optimized responsive images.

### INTEGRATION-10: Telegram alert end-to-end

- **Objective**: Verify the notification path.
- **Requirements**: Place a real test order → confirm subscriber posts to Telegram.
- **Dependencies**: BACKEND-09, INTEGRATION-04
- **Deliverables**: (verification; no new file)
- **Acceptance Criteria**: A test order produces a Telegram message with the configured fields.

---

## Phase 5 — TEST

### TEST-01: Catalog & PDP render

- **Objective**: Verify browse + variant states.
- **Requirements**: Check grid reflow, sale-price treatment, variant stock states.
- **Dependencies**: INTEGRATION-03
- **Deliverables**: `tests/catalog.spec.ts`
- **Acceptance Criteria**: Grid columns change per breakpoint; struck sold-out size confirmed.

### TEST-02: Cart math

- **Objective**: Verify totals + delivery logic.
- **Requirements**: Assert subtotal, delivery fee, free-over-threshold, KHR rounding.
- **Dependencies**: INTEGRATION-02, FRONTEND-22
- **Deliverables**: `tests/cart.spec.ts`
- **Acceptance Criteria**: Below threshold adds fee; at/above shows free; KHR integer.

### TEST-03: COD end-to-end

- **Objective**: Verify COD path.
- **Requirements**: Place COD → order `pending_confirmation` + Telegram alert + stock reserved.
- **Dependencies**: INTEGRATION-04, INTEGRATION-10
- **Deliverables**: `tests/cod.spec.ts`
- **Acceptance Criteria**: All three effects observed.

### TEST-04: KHQR end-to-end (sandbox)

- **Objective**: Verify online payment path.
- **Requirements**: start → simulate pay → status `paid` → order `paid` → one `stock_movement(out)`.
- **Dependencies**: INTEGRATION-05
- **Deliverables**: `tests/khqr.spec.ts`
- **Acceptance Criteria**: Full chain passes against sandbox.

### TEST-05: Stock-in flow

- **Objective**: Verify receiving + availability.
- **Requirements**: Admin stock-in → level rises, `in` movement recorded, storefront availability updates.
- **Dependencies**: BACKEND-07, INTEGRATION-03
- **Deliverables**: `tests/stock-in.spec.ts`
- **Acceptance Criteria**: Level +N, one `in` row, PDP reflects new stock.

### TEST-06: Reports

- **Objective**: Verify sales + stock reports.
- **Requirements**: Seed known orders/levels; assert sales totals and low-stock list.
- **Dependencies**: BACKEND-08, BACKEND-08B, TEST-04
- **Deliverables**: `tests/reports.spec.ts`
- **Acceptance Criteria**: Revenue/order counts and low-stock membership match expectations.

### TEST-07: Invoice

- **Objective**: Verify invoice output.
- **Requirements**: Render invoice; confirm VAT line hidden when disabled.
- **Dependencies**: INTEGRATION-07
- **Deliverables**: `tests/invoice.spec.ts`
- **Acceptance Criteria**: Valid HTML; no VAT line with VAT off.

### TEST-08: Facebook login

- **Objective**: Verify social login.
- **Requirements**: Complete FB login (test app) → customer + `customer_social_identity` row.
- **Dependencies**: INTEGRATION-06
- **Deliverables**: `tests/fb-login.spec.ts`
- **Acceptance Criteria**: One identity row created; session returned.

### TEST-09: Responsive & in-app browser

- **Objective**: Verify mobile-first behavior.
- **Requirements**: Test at 360/768/1440 and inside Facebook/Telegram in-app browsers (nav collapse, filter drawer, polling, OAuth redirect).
- **Dependencies**: INTEGRATION-05, INTEGRATION-06
- **Deliverables**: `tests/responsive.md` (checklist)
- **Acceptance Criteria**: All pass in in-app browsers; no broken OAuth/polling.

### TEST-10: Accessibility

- **Objective**: Verify a11y basics.
- **Requirements**: ≥44px touch targets, contrast on coral/ink, Khmer rendering, labeled inputs.
- **Dependencies**: FRONTEND-02, FRONTEND-03
- **Deliverables**: `tests/a11y.md` (checklist)
- **Acceptance Criteria**: Targets ≥44px; no contrast failures; Khmer legible.

### TEST-11: Security

- **Objective**: Verify privacy/security posture.
- **Requirements**: No secrets in client bundle; proxy reachable only from backend (IP allowlist); payment status verified server-side only; no card data anywhere.
- **Dependencies**: BACKEND-03B, INTEGRATION-09
- **Deliverables**: `tests/security.md` (checklist)
- **Acceptance Criteria**: All checks pass; client-forged "paid" is rejected.
