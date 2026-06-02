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

### ✅ BACKEND-04: COD order endpoint

- **Completed 2026-06-01** — `POST /store/orders/cod` places an unpaid (manual `pp_system_default` session) order via `completeCartWorkflow`, which reserves inventory and emits `order.placed`; pre-check + completion-catch return 409 out-of-stock; contact details persisted to order metadata; idempotent on re-submit.
- **Objective**: Place a cash-on-delivery order.
- **Requirements**: `POST /store/orders/cod` body `{cart_id, phone, name, address, note}` → `{order_id, status:"pending_confirmation"}`; reserve inventory; mark unpaid; error 409 out-of-stock. Emits an order-placed event.
- **Dependencies**: BACKEND-01
- **Deliverables**: `src/api/store/orders/cod/route.ts`
- **Acceptance Criteria**: Endpoint creates an order with status `pending_confirmation` and reserved stock.

### ✅ BACKEND-05: Facebook OAuth — start

- **Completed 2026-06-01** — `GET /store/auth/facebook` 302-redirects to Facebook's OAuth dialog with `client_id` (`FB_APP_ID`), an allowlist-validated `redirect_uri`, minimal scopes (`email,public_profile`), and a server-generated single-use `state` stored in Redis + mirrored to an HttpOnly `SameSite=Lax` cookie for callback binding; 10/min/IP rate-limited; fails closed (503) when `FB_APP_ID` unset. Verified live: real 302 + correct `client_id`/`redirect_uri` in the `Location` header.
- **Objective**: Begin optional social login.
- **Requirements**: `GET /store/auth/facebook` → redirect to Facebook OAuth (uses `FB_APP_ID`).
- **Dependencies**: SETUP-12
- **Deliverables**: `src/api/store/auth/facebook/route.ts`
- **Acceptance Criteria**: Hitting the route 302-redirects to Facebook with correct client_id + redirect_uri.

### ✅ BACKEND-05B: Facebook OAuth — callback

- **Completed 2026-06-01** — `GET /store/auth/facebook/callback` verifies BACKEND-05's `state` (query == `_fb_oauth_state` cookie + live Redis entry, consumed single-use), calls `authModule.validateCallback("facebook", …)`, then creates a **new, unlinked** customer via `createCustomerAccountWorkflow` (or reuses by immutable `provider_user_id`) — never auto-links by email (409 on collision, per security.md) — writes one `customer_social_identity` row, establishes a session via `req.session.auth_context` (HttpOnly `connect.sid`, no token in body), and returns `{customer}`. Scope was expanded (user-approved) to a real Facebook Auth provider: `src/modules/auth-facebook/` (ports `@medusajs/auth-google`) registered in `medusa-config.ts` alongside `emailpass` (admin MFA preserved). Verified: `tsc` clean; server boots with the new auth config (emailpass+facebook load, no errors); callback route reachable; state/CSRF rejection works (401 `authentication_failed` / `invalid_state`). **Not runtime-proven:** the full FB happy-path (real login → customer + social row + session) needs real `FB_APP_ID`/`FB_APP_SECRET` + a consenting Facebook user — verify with real credentials before go-live. Follow-ups: add `FB_OAUTH_REDIRECT_URI` to `.env.template` and set per env; re-verify admin login + MFA after the auth-module change.
- **Objective**: Complete login and link identity.
- **Requirements**: `GET /store/auth/facebook/callback?code=` → exchange code, upsert `customer`, create `customer_social_identity` (`provider=facebook`, `provider_user_id`), return session + `{customer}`; error 401 on failure.
- **Dependencies**: BACKEND-05, SETUP-07
- **Deliverables**: `src/api/store/auth/facebook/callback/route.ts`
- **Acceptance Criteria**: A test FB login creates a customer + one `customer_social_identity` row and returns a session.

### ✅ BACKEND-05C: Google OAuth — start

- **Completed 2026-06-01** — `GET /store/auth/google` 302-redirects to Google's OAuth dialog (`https://accounts.google.com/o/oauth2/v2/auth`) with `client_id` (`GOOGLE_CLIENT_ID`), an allowlist-validated `redirect_uri` (server config, never the Host header; https-except-localhost, no userinfo, exact callback path), `scope=email profile openid`, `response_type=code`, and a server-generated single-use 256-bit `state` stored in the Cache module (`google:oauth:state:`, 600s TTL) and mirrored to an HttpOnly `SameSite=Lax` cookie (`_google_oauth_state`) — mirrors BACKEND-05's mechanism exactly. 10/min/IP rate-limited; fails closed (503) when `GOOGLE_CLIENT_ID` unset, 500 on redirect-uri misconfig. Built-in `@medusajs/auth-google` (v2.15.3, already installed — no new dep) registered in the Auth Module `providers` array, conditional on `GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET`, alongside `emailpass` (admin MFA preserved) + `facebook`. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI` added to `.env.template` (no values). Verified live: `tsc` clean; server boots with the google provider loaded; route returns a real 302 with correct `client_id` + `redirect_uri` + `state`-matched cookie (publishable-key gated). Callback (BACKEND-05D, with its open ⚠️ design decision) and the storefront Google-login button are out of scope here.
- **Objective**: Begin optional Google social login (parallel to the Facebook flow, BACKEND-05).
- **Requirements**: `GET /store/auth/google` → 302 redirect to Google OAuth (uses `GOOGLE_CLIENT_ID`). Generate a server-side, single-use, session-bound `state` stored in Redis + an HttpOnly `SameSite=Lax` cookie (mirror BACKEND-05's mechanism exactly). `redirect_uri` comes from server config validated against a hard-coded allowlist — never the request Host header. Scopes: `email profile openid` only (the minimal set the built-in Google provider uses). Rate limit 10/min/IP. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` to `.env.template` (no values committed). Register the built-in `@medusajs/auth-google` provider in the Auth Module `providers` array in `medusa-config.ts` (conditional on creds present, alongside `emailpass` + `facebook`).
- **Dependencies**: SETUP-12, BACKEND-05B (reuses the Auth Module `providers` array and the state/cookie pattern established for Facebook).
- **Deliverables**: `src/api/store/auth/google/route.ts`; `medusa-config.ts` (add `google` provider); `.env.template` (Google env keys).
- **Acceptance Criteria**: Hitting the route 302-redirects to Google with correct `client_id` + `redirect_uri`.

### ✅ BACKEND-05D: Google OAuth — callback

- **Completed 2026-06-01** — `GET /store/auth/google/callback?code=&state=` completes the BACKEND-05C flow using **approach (b)** (user-confirmed auth decision): the route is the CSRF authority and does the Google exchange/verify itself rather than the built-in provider's `validateCallback` (whose own state check conflicts with our route-owned state). Flow: (1) verify `state` — query == HttpOnly `_google_oauth_state` cookie **and** live Cache/Redis entry (`google:oauth:state:`), then consume single-use + clear cookie; (2) exchange `code` at the hard-coded `https://oauth2.googleapis.com/token` (secrets in POST body, `redirect:"error"`), verify the `id_token` claims `aud`/`iss`/`exp`/`email_verified` via `jwt.decode` (no JWKS round-trip — token arrives directly from Google over TLS, OIDC §3.1.3.7; `jsonwebtoken` already installed, no new dep); (3) retrieve-or-create an `auth_identity` keyed by the immutable Google `sub`; (4) resolve customer — returning user matched by `provider_user_id`/`app_metadata.customer_id` only, **never** auto-linked by email (409 `email_conflict`), else new `customer` via `createCustomerAccountWorkflow` + one `customer_social_identity(provider=google, provider_user_id)`; (5) session via `req.session.auth_context` (HttpOnly cookie, no token in body) returning `{customer}`. All failures → 401 `{error, request_id}`; 503 when creds unset; 10/min/IP rate limit; no PII/tokens logged. The built-in `@medusajs/auth-google` (05C) stays registered but unused here. Verified live: `tsc` clean; server boots with the provider; forged state → 401 `invalid_state`; missing params → 401 `authentication_failed`; a **valid** state from `/start` passes CSRF then fails token exchange on a fake code (401 `authentication_failed`); replayed state → 401 `invalid_state` (single-use). **Not runtime-proven:** the full happy-path (real login → customer + social row + session) needs real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` + a consenting Google user — verify with real credentials before go-live (same caveat as BACKEND-05B). Storefront button/wiring/test tracked as `FRONTEND-17B`/`INTEGRATION-06B`/`TEST-08B`.
- **Objective**: Complete Google login and link identity.
- **Requirements**: `GET /store/auth/google/callback?code=` → verify the BACKEND-05C `state` (query `state` == cookie **and** live Redis entry, then consume — single-use CSRF), exchange the code + read the verified Google profile, then resolve the customer: match a returning user by the immutable `provider_user_id` only; otherwise create a **new, unlinked** `customer` and one `customer_social_identity` (`provider=google`, `provider_user_id`). **Never auto-link to a pre-existing customer by email** (security.md account-link safety — same rule as BACKEND-05B; 409 on email collision). Establish a real session (`req.session.auth_context` → HttpOnly cookie, no token in the body) and return `{customer}`; error 401 on failure.
- **Dependencies**: BACKEND-05C, SETUP-07.
- **Deliverables**: `src/api/store/auth/google/callback/route.ts`.
- **Acceptance Criteria**: A test Google login creates a customer + one `customer_social_identity` row (`provider=google`) and returns a session.
- **⚠️ Design note (resolve before implementing)**: Medusa's built-in Google provider (`@medusajs/auth-google`) enforces its **own** OAuth `state` via the provider's `authenticate()`/`getState()` — which is incompatible with the custom `/store/auth/google` routes that own their own state (the same mismatch hit in BACKEND-05B). The implementer must pick one: (a) add a thin custom Google provider that performs the code/`id_token` exchange but skips the provider-level state check (mirroring `src/modules/auth-facebook/`, letting the route be the CSRF authority), or (b) perform the Google token + `id_token` verification directly in the callback route. STOP and confirm the approach (auth decision) before coding.
- **Related (storefront)**: a Google login button + wiring is required for end-user access — tracked as `FRONTEND-17B` (button), `INTEGRATION-06B` (wiring), and `TEST-08B` (test), parallel to the Facebook `FRONTEND-17`/`INTEGRATION-06`/`TEST-08`. Out of scope for these two backend tasks.

### ✅ BACKEND-06: Invoice (VAT-ready HTML)

- **Completed 2026-06-01** — `GET /store/orders/:id/invoice?token=` returns a printable, self-contained HTML invoice (header, order #/date, line items, subtotal, delivery, total) with an **optional VAT line + TIN that are OFF by default** in v1 (env-gated `INVOICE_VAT_ENABLED`; `VAT_RATE` default 0.10; computed display-only since Medusa tax stays off). Auth is the security.md order-token: a 256-bit `crypto.randomBytes(32)` base64url token minted once at order creation (COD `BACKEND-04` + KHQR finalize `BACKEND-03B` now call the shared `src/lib/order-token.ts` `ensureInvoiceToken`, persist it to `order.metadata`, and return `invoice_token` in their responses), verified here in constant time (`timingSafeEqual`) with 30-day expiry + admin-revocable flag. All dynamic values HTML-escaped (XSS-safe); response is `no-store` + `nosniff`; inherits Medusa's store publishable-key gate; 60/min/IP rate limit. Verified live (booted server, real persisted order, real minted token): 200 `text/html` with correct headers + valid doctype + line items/unit prices/delivery/contact rendered; **VAT line absent when disabled**; 403 wrong token, 404 unknown order, 400 missing token, 400 missing publishable key. Token verifier unit-checked (valid/wrong/wrong-length/expired/revoked/missing all correct); template math unit-checked ($49.50 subtotal / $51.00 total / $55.95 with VAT + TIN). **Note:** a fully cart-completed order (non-zero computed aggregate totals) could not be produced in dev because no shipping option covers Cambodia (a SETUP/seed gap, not a BACKEND-06 defect) — the route faithfully renders the order's computed fields (`shipping_total` + `unit_price` render correctly through the same path; the test order's `item_total` was genuinely 0 in the DB), so totals display correctly on a completed order. Storefront link wiring is `INTEGRATION-07`; spec tests are `TEST-07`.
- **Objective**: Render a printable invoice per order.
- **Requirements**: `GET /store/orders/:id/invoice` (order-token auth) → printable HTML with line items, delivery fee, total; include an optional **VAT line at 10% (Cambodia standard)** + TIN field, hidden/0 by default (TIN provided when enabling); errors 403/404.
- **Dependencies**: BACKEND-04
- **Deliverables**: `src/api/store/orders/[id]/invoice/route.ts`, `src/lib/invoice-template.ts`
- **Acceptance Criteria**: Endpoint returns valid HTML for a real order; VAT line absent when disabled.

### ✅ BACKEND-07: Stock movements + auto stock-out

- _Completed 2026-06-01 — `POST /admin/stock-movements` (`src/api/admin/stock-movements/route.ts`): zod-validated body `{variant_id, type, quantity, reason}`, resolves the variant's inventory item + location level via `query.graph`, adjusts the level through the built-in `updateInventoryLevelsWorkflow` (in→+q, out→−q with 400 `insufficient_stock` guard, adjust→absolute), and writes one `stock_movement` row stamped `created_by = admin actor_id`; admin-session rate limit 60/min. `src/modules/stock-movement/service.ts` gained `recordMovement(...)` + `recordStockOut({variant_id, quantity, order_id, created_by, reason?})` — the `type=out` helper for BACKEND-03B/04 at order commit. `npx tsc --noEmit` clean; live dev server returns 401 to an unauthenticated POST (route registered + admin-guarded). ⚠️ The authenticated end-to-end "+10 + one row" observation was NOT runtime-executed (needs an admin MFA session + seeded variant, unavailable this session) — defer to UAT/TEST. `adjust`/`out` numeric direction assumed (only `in` is in the acceptance criterion)._
- **Objective**: Admin stock-in endpoint and automatic stock-out on order.
- **Requirements**: `POST /admin/stock-movements` (admin auth) body `{variant_id, type, quantity, reason}` → adjusts the variant `inventory_level` and writes a `stock_movement` row; provide a service method reused by BACKEND-03B/04 to write `type=out` on order commit with `order_id` + `created_by`.
- **Dependencies**: SETUP-08
- **Deliverables**: `src/api/admin/stock-movements/route.ts`, `src/modules/stock-movement/service.ts`
- **Acceptance Criteria**: Posting `type=in, quantity=10` raises the inventory level by 10 and inserts one movement row.

### ✅ BACKEND-08: Sales report endpoint

- _Completed 2026-06-01 — `GET /admin/reports/sales?from=&to=` (`src/api/admin/reports/sales/route.ts`): zod-validated optional ISO `from`/`to` window (parseable + `from ≤ to`), admin-guarded (`/admin/*`) with a defensive `actor_id` check + 60/min/admin-session rate limit. Sweeps in-range orders via `query.graph` (paged 200; `created_at $gte/$lte`) and aggregates → `{ from, to, orders, revenue, top_variants[] }`. Qualification "paid OR not-cancelled" (locked this task): an order counts when `payment_status==="captured"` OR `status!=="canceled"`. `revenue` is grouped by `currency_code` with no cross-currency conversion (locked decision — summing USD+KHR is meaningless); `top_variants` ranked by units sold (currency-agnostic), top 10 `{variant_id,title,quantity}`; per-currency revenue rounded to cents. `npx tsc --noEmit` clean; live dev server returns **401** to an unauthenticated GET (route registered + admin-guarded). ⚠️ The numeric "count + revenue match" was NOT runtime-executed — needs an admin MFA session + a known set of seeded **paid** orders; a fully captured dev order is blocked by the same seed gap noted in BACKEND-06 (no Cambodia shipping option), and this match is a declared dependency of TEST-04. Two acceptance-affecting ambiguities (order qualification + multi-currency revenue shape) were resolved by the user, not assumed._
- **Objective**: Period revenue/order summary.
- **Requirements**: `GET /admin/reports/sales?from=&to=` (admin) → `{orders, revenue, top_variants[]}` aggregating paid/confirmed orders in range.
- **Dependencies**: BACKEND-03B, BACKEND-04
- **Deliverables**: `src/api/admin/reports/sales/route.ts`
- **Acceptance Criteria**: For a known set of test orders, `orders` count and `revenue` total match.

### ✅ BACKEND-08B: Stock report endpoint

- **Completed 2026-06-01** — `GET /admin/reports/stock?low_threshold=5` (`src/api/admin/reports/stock/route.ts`): admin-guarded (`/admin/*` + defensive `actor_id` check), zod-validated query (`low_threshold` optional digits-only non-negative integer; rejects negatives/junk), 60/min/admin-session rate limit, `{ error, request_id }` errors only. Sweeps all variants via `query.graph` (paged 200), sums each variant's `inventory_items.inventory.location_levels.stocked_quantity` (PRD §4 "stock truth"), and returns `{ threshold, levels[], low_stock[] }` with rows `{ variant_id, title, sku, quantity }`; `low_stock[] = levels.filter(quantity <= threshold)`, sorted most-urgent-first. Threshold from `low_threshold` else `getLowStockThreshold()` (BACKEND-01 `LOW_STOCK_THRESHOLD`, default 5). Variants with no inventory level are omitted (no stock truth → not falsely flagged). Metric = stocked quantity (not available/reserved), per PRD §3.4/§4; no extras added. `npx tsc --noEmit` clean. ⚠️ The live numeric "at/below appears, others don't" observation was NOT runtime-executed — needs an admin MFA session + seeded variants at known levels (same dev-env limitation as BACKEND-07/08); the `<=` filter satisfies it by logic, deferred to TEST-04.
- **Objective**: Current stock + low-stock list.
- **Requirements**: `GET /admin/reports/stock?low_threshold=5` (admin) → `{levels[], low_stock[]}`; default threshold from BACKEND-01.
- **Dependencies**: BACKEND-07
- **Deliverables**: `src/api/admin/reports/stock/route.ts`
- **Acceptance Criteria**: Variants at/below threshold appear in `low_stock[]`; others don't.

### ✅ BACKEND-09: Telegram order alert (subscriber)

- _Completed 2026-06-01 — `src/subscribers/order-placed.ts` listens on the `order.placed` event (emitted by `completeCartWorkflow` for both COD/BACKEND-04 and KHQR/BACKEND-03B). Resolves the full order via `query.graph` and POSTs a plain-text alert to the Telegram Bot API (`https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage`, `chat_id=TELEGRAM_CHAT_ID`) with order # (`display_id`), line items (`title — variant_title ×qty`), total **USD + KHR** (KHR via BACKEND-01 `usdToKhr`, whole riel), payment method (COD via `metadata.payment_method`/`pp_system_default`; KHQR via `pp_bakong_khqr`), and customer name/phone/address/note (preferring COD `metadata.cod_contact`, falling back to `shipping_address`). **Retry on send failure** = 3 attempts + linear backoff + 10s/attempt timeout. Security (security.md): phone/address/note only in the private-chat message, never logged; bot token never logged; hard-coded Telegram host (no SSRF); plain text (no `parse_mode`); in-process 30/min send budget; subscriber never throws; no-ops with a warning when the two secrets are unset (CLARIFY-06: builds against placeholders). `npx tsc --noEmit` clean. ⚠️ The live "posts a message to the configured chat" observation was NOT runtime-executed — `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are deploy-time secrets absent in dev, and a fully cart-completed dev order is blocked by the same seed gap noted in BACKEND-06/07/08 (no Cambodia shipping option). Defer the live send to UAT with real credentials._
- **Objective**: Notify the team on every placed order.
- **Requirements**: Subscriber on the order-placed event → POST to Telegram Bot API (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) to a private chat with full order details (order #, items, total USD+KHR, payment method, customer name, phone, address, note); retry on send failure.
- **Dependencies**: BACKEND-04
- **Deliverables**: `src/subscribers/order-placed.ts`
- **Acceptance Criteria**: Placing a COD order posts a message to the configured chat.

### ✅ BACKEND-10: Reservation expiry job

- **Completed 2026-06-01** — `src/jobs/expire-reservations.ts` releases the `/start` reservation and deletes the stale pending Bakong session for expired, unpaid, not-completed KHQR carts (no order exists pre-verify per locked PRD §4; "cancel order" reconciled to "cancel pending session" — confirmed with operator).
- **Objective**: Release stock from unpaid KHQR orders.
- **Requirements**: Scheduled job releasing reservations + cancelling orders still `pending_payment` past the KHQR `expires_at`.
- **Dependencies**: BACKEND-03B
- **Deliverables**: `src/jobs/expire-reservations.ts`
- **Acceptance Criteria**: An expired unpaid order is cancelled and its reserved stock returns to available.

---

## Phase 3 — FRONTEND (DESIGN.md)

### ✅ FRONTEND-01: Design tokens

- _Completed 2026-06-01 — Tokens encoded in `storefront/tailwind.config.js` `theme.extend` (colors `ink #111111`, `canvas #ffffff`, `soft-cloud #f5f5f5`, `hairline #cacacb`, `hairline-soft #e5e5e5`, `mute #707072`, `success #007d48`, `accent #C0461F` coral; additive 8px spacing scale `xxs 2 · xs 4 · sm 8 · md 12 · lg 18 · xl 24 · xxl 30 · section 48`; `borderRadius.pill 999px`). All additive — Tailwind v3 + `@medusajs/ui-preset` and existing starter UI untouched. **Deviation (user-approved):** the storefront is still on Tailwind v3 (Medusa starter), where the deliverable's v4 `@theme` syntax is a no-op; user chose "stay on v3, tokens in config", so tokens live in `tailwind.config.js` rather than `src/styles/globals.css` (left unchanged). A full v3→v4 migration was rejected as it would break the Medusa preset + `src/modules/` UI. Verified by compiling Tailwind against the token classes: `bg-ink`→`rgb(17 17 17)`, `text-accent`/`bg-accent`→`rgb(192 70 31)` (#C0461F), `bg-soft-cloud`→`#f5f5f5`, `text-success`→`#007d48`, `rounded-pill`→`border-radius:999px`, `p-sm`→8px, `p-xl`→24px, `gap-section`→48px — all resolve to spec._
- **Objective**: Encode the Nike token set + coral accent in the theme.
- **Requirements**: In Tailwind v4 `@theme`, define `ink #111111`, `canvas #ffffff`, `soft-cloud #f5f5f5`, `hairline #cacacb`, `hairline-soft #e5e5e5`, `mute #707072`, `success #007d48`, and `accent #C0461F` (coral; replaces Nike's sale-red); 8px spacing scale; pill radius `999px`.
- **Dependencies**: SETUP-10
- **Deliverables**: `src/styles/globals.css`
- **Acceptance Criteria**: Utilities like `bg-ink`, `text-accent`, `rounded-pill` resolve to the specified values.

### ✅ FRONTEND-02: Fonts

- _Completed 2026-06-01 — `storefront/src/lib/fonts.ts` loads the Latin stack via `next/font/google` (self-hosted, no runtime Google request): `inter` (Inter, weights 400/500 only per DESIGN.md, var `--font-inter`) + `bebasNeue` (Bebas Neue, single weight 400, var `--font-bebas-neue`), both `subsets:["latin"]`, `display:"swap"`; no Khmer fallback (CLARIFY-02). `src/app/layout.tsx` applies both CSS-variable classes to `<html>` and `inter.className` to `<body>` (Inter = default UI font; Bebas exposed via `--font-bebas-neue` for the campaign tier / FRONTEND-08). Deliverables only — `tailwind.config.js`/`globals.css` untouched. Verified: clean `tsc --noEmit` for both files (next/font's per-font weight types validate the 400/500 + 400 config); remaining tsc errors are pre-existing starter issues out of scope. Bebas display styling (96px/0.9/uppercase) is applied by consuming components, not the loader. Live browser computed-style check not run in-session._
- **Objective**: Load the Latin font stack (English-first v1).
- **Requirements**: `next/font` for Inter (400/500) and Bebas Neue (campaign 96px/0.9/uppercase); set CSS families. (Khmer font = v2.)
- **Dependencies**: SETUP-10
- **Deliverables**: `src/lib/fonts.ts`, `src/app/layout.tsx`
- **Acceptance Criteria**: Latin text renders Inter/Bebas with no fallback fonts.

### ✅ FRONTEND-03: Button + pill primitives

- _Completed 2026-06-01 — Three project primitives in `storefront/src/components/ui/` (new dir) using only FRONTEND-01 tokens, no third-party UI lib. `PillButton.tsx`: `bg-ink text-canvas`, `h-12` (48px), `px-6 py-3` (24×12), `rounded-pill`, `text-base font-medium leading-normal` (= button-md 16px/500/1.5), forwards native button props + `disabled`/`hover:opacity` states. `SearchPill.tsx`: `bg-soft-cloud text-ink`, `h-12` (48px), `rounded-pill`, `px-4`, `placeholder:text-mute`, DESIGN.md focus state (canvas bg + ink border, no shadow); magnifier icon deferred (icon-set decision out of scope). `Chip.tsx`: `active` prop → ink fill (`bg-ink text-canvas`) / inactive → `border border-hairline bg-canvas text-ink`, `rounded-pill`, `h-11` (44px touch floor), `aria-pressed`. Verified: clean `tsc --noEmit` on all three; token classes resolve per FRONTEND-01. `button-md` expressed via Tailwind primitives (no typography utility exists yet); Chip at 44px (touch floor) vs PillButton/SearchPill 48px. Static/type verification only — live browser render not run._
- **Objective**: Core CTA + chip components.
- **Requirements**: `PillButton` (ink bg / white text / `button-md` 16px/500, height 48px, padding 12×24, radius pill); `SearchPill` (soft-cloud); `Chip` (active = ink fill, inactive = hairline border).
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/ui/PillButton.tsx`, `SearchPill.tsx`, `Chip.tsx`
- **Acceptance Criteria**: Components render with correct colors, 48px height, pill radius; ≥44px touch target.

### ✅ FRONTEND-04: Top nav (responsive)

- _Completed 2026-06-02 — `storefront/src/components/layout/TopNav.tsx` (new `layout/` dir): responsive `"use client"` header on `bg-canvas`/`text-ink` with `border-b border-hairline-soft`, 56px (`h-14`) row. **Desktop (≥600px):** leading "ALI STORE" wordmark → category links (`New · Women · Men · Kids · Sale`) → right cluster = USD/KHR currency toggle + search/account/bag icon buttons. **Mobile (≤599px):** hamburger (left) + centered wordmark + bag (right); links + currency toggle live in a left slide-in drawer (ink/40 backdrop, close button). Currency toggle = file-private `CurrencyToggle` built from the existing `Chip` primitive (`useState<"USD"|"KHR">`, active chip reflects state). Icons from already-installed `@medusajs/icons` (`MagnifyingGlass`, `User`, `ShoppingBag`, `BarsThree`, `XMark`) — no new dependency. Tokens-only, no accent color anywhere, no gradients/shadows/`dark:`. **Decisions (operator-confirmed this task):** "Sale" renders in **ink**, not accent — design.md reserves accent for sale-price text + KHQR CTA only (rule wins over the task's "(accent)" wording); icon set = `@medusajs/icons`. The ≤599/≥600 boundary has no named breakpoint token in `tailwind.config.js`, so it uses Tailwind's `min-[600px]:` arbitrary-breakpoint variant to hit DESIGN.md's "1-up (≤599)" exactly. Category links are placeholders (`href:"/"`) pending real-category wiring (FRONTEND-07/10). Verified: `tsc --noEmit` clean for the file; breakpoint + currency-state logic confirmed by class/state inspection. ⚠️ Live render at 360px not browser-executed in-session (no dev server run)._
- **Objective**: Header with nav, currency toggle, cart.
- **Requirements**: Desktop = wordmark + category links + Sale (accent) + search/user/bag icons; mobile = hamburger + wordmark + bag; currency toggle (USD/KHR); hairline-soft bottom border.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/layout/TopNav.tsx`
- **Acceptance Criteria**: Links show on desktop, collapse to hamburger ≤599px; toggle switches currency state.

### ✅ FRONTEND-05: Product card

- _Completed 2026-06-02 — `storefront/src/components/product/ProductCard.tsx` (new `product/` dir): presentational Server Component for the catalog tile. 1:1 image (`aspect-square`) full-bleed on `bg-soft-cloud`, no radius, via `next/image` `fill` + explicit grid-driven `sizes` (no fixed px). Zero card padding; metadata below the image with 8px gaps (DESIGN.md). Product **ID** = `text-mute` caption-sm (`text-xs font-medium` = 12/500); **name** = `text-ink` body-strong (`text-base font-medium` = 16/500). **Price block:** non-sale → single `text-ink` price; sale (when `originalPrice` prop present) → struck-through original in `text-mute` followed by sale price in `text-accent` (coral). Accent used only on the sale price (permitted use). Tokens-only, no gradients/shadows/`dark:`, single 500 weight. Prices accepted display-ready (formatting/currency out of scope — `lib/price.ts` not yet built). **Decision:** followed the task's Requirements + Acceptance ordering (struck original → sale price, no "% off"), which both agree, over DESIGN.md's `product-card` note (sale-first + "% off"). No PDP link (not in Requirements). Verified: `tsc --noEmit` clean for the file; sale/non-sale branch + tokens confirmed by inspection. ⚠️ No live browser render in-session._
- **Objective**: The catalog tile.
- **Requirements**: 1:1 image on `soft-cloud` (no radius), ID (mute caption-sm), name (`body-strong` 16/500), price block: original strike-through in `mute`, sale price in `accent`; full-price items show ink-only price.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/product/ProductCard.tsx`
- **Acceptance Criteria**: Sale item shows struck original + coral sale price; non-sale shows single ink price.

### ✅ FRONTEND-06: Product grid (responsive)

- _Completed 2026-06-02 — `storefront/src/components/product/ProductGrid.tsx` (presentational Server Component, no `"use client"`): CSS-grid container reflowing 1-up (base ≤599) → 2-up (`min-[600px]:`) → 3-up (`min-[1024px]:`) → 4-up (`min-[1440px]:`), `gap-2` (8px) gutters. Pixel boundaries (1440/1024/600) match `ProductCard`'s `IMAGE_SIZES` so the `next/image` `sizes` hint tracks the column width; `min-[Npx]:` arbitrary variants used since `tailwind.config.js` has no named breakpoint tokens (same convention as FRONTEND-04). Accepts `children` (the `ProductCard` tiles) — single-responsibility layout, reused by FRONTEND-09/10. Tokens-only, no accent/gradients/shadows/`dark:`. Verified: clean `tsc --noEmit` on the file; column ladder confirmed by class inspection. Live browser render at the four breakpoints not run in-session._
- **Objective**: Reflowing grid.
- **Requirements**: 4-up (≥1440) → 3-up (desktop) → 2-up (≤1023) → 1-up (≤599); 8px-grid gaps.
- **Dependencies**: FRONTEND-05
- **Deliverables**: `src/components/product/ProductGrid.tsx`
- **Acceptance Criteria**: Column count changes at each breakpoint.

### ✅ FRONTEND-07: Category pill tabs

- _Completed 2026-06-02 — `storefront/src/components/product/CategoryTabs.tsx` (`"use client"`): leading `SearchPill` + horizontally scrollable (`overflow-x-auto`, `shrink-0` items, `gap-2`) row of `Chip`s, one per category from a typed `categories: { handle, name }[]` prop. Selection state (`activeHandle`) is client-local; the selected chip renders the active ink fill via the `Chip` primitive (`active={activeHandle === handle}`). Optional `onCategorySelect(handle)` callback notifies the parent. Categories supplied by a Server Component parent (FRONTEND-09) that fetches the SETUP-09-seeded categories (T-shirt, Polo, Outerwear, Hoodie, Pants, Accessories) via the SDK — consistent with Stack.md's server-fetch / client-only-for-interactivity rule. Reuses FRONTEND-03 primitives only; tokens-only, no accent/gradients/shadows/`dark:`. Verified: clean `tsc --noEmit`; selection + active-fill logic confirmed by inspection. Live browser render at 360px not run in-session._
- **Objective**: Horizontal category selector (English v1).
- **Requirements**: Scrollable `Chip` row; active = ink fill; leading search pill.
- **Dependencies**: FRONTEND-03, SETUP-09
- **Deliverables**: `src/components/product/CategoryTabs.tsx`
- **Acceptance Criteria**: Renders seeded categories; selecting one marks it active.

### ✅ FRONTEND-08: Campaign hero band

- _Completed 2026-06-02 — `storefront/src/components/layout/Hero.tsx` (presentational Server Component, no `"use client"`): `bg-soft-cloud` band with a caption-sm uppercase eyebrow (`text-xs font-medium uppercase leading-normal text-ink`), a Bebas display-tier headline via the `--font-bebas-neue` CSS variable (`font-[family-name:var(--font-bebas-neue)]`, `uppercase`, `leading-[0.9]`, `text-5xl`/48px → `min-[600px]:text-8xl`/96px), and the FRONTEND-03 `PillButton` "Shop now". Lockup is `flex-col` (stacked) on mobile, `min-[600px]:flex-row … justify-between` (headline leading, CTA trailing) on desktop. Named spacing tokens (`py-section` 48px, `gap-xl` 24px, `gap-4` 16px) + `px-4`/`min-[600px]:px-6` matching TopNav. Optional `eyebrow`/`headline` props with placeholder defaults. Headline weight left at Bebas's native 400 (single-weight font); `leading-[0.9]` used to hit DESIGN.md's exact 0.9 (no `leading` token exists). No hero image (not in Requirements). Tokens-only, no accent/gradients/shadows/`dark:`. Verified: clean `tsc --noEmit`; stack/horizontal + Bebas tier confirmed by inspection. Live browser render not run in-session._
- **Objective**: Editorial hero.
- **Requirements**: `soft-cloud` band, eyebrow (caption-sm uppercase), display headline (Bebas tier), `PillButton` "Shop now"; horizontal on desktop.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/layout/Hero.tsx`
- **Acceptance Criteria**: Renders headline + working CTA; stacks on mobile.

### ✅ FRONTEND-09: Catalog / Home page

- _Completed 2026-06-02 — `storefront/src/app/page.tsx` (Server Component): composes the landing shell `TopNav` (FRONTEND-04) → `Hero` (FRONTEND-08, full-bleed soft-cloud band) → centered content `section` (`max-w-8xl`, `px-4`/`min-[600px]:px-6`, `py-section`, `gap-xl`) holding `CategoryTabs` (FRONTEND-07) + a `ProductGrid` (FRONTEND-06) of `ProductCard`s (FRONTEND-05). Inline placeholder data per the acceptance criterion: 6 categories mirroring the SETUP-09 seed + 6 products (two on sale) using Medusa demo images from the bucket already allow-listed in `next.config.js` so `next/image` resolves them. Only serializable props passed (no callbacks) → page stays a Server Component while TopNav/CategoryTabs remain `"use client"` islands. **Scope:** the Requirements' "mobile bottom bar (FRONTEND-21)" is deferred — `BottomBar` is FRONTEND-21's deliverable and not a dependency of this task (deps 04/06/07/08); it gets wired in when FRONTEND-21 is built. Deliverable path `src/app/page.tsx` created as specified without touching the starter's `[countryCode]` routing (out of scope). Verified: clean `tsc --noEmit` (validates imports + all component prop contracts); live dev-server browser render not run in-session._
- **Objective**: Compose the landing page.
- **Requirements**: TopNav + Hero + CategoryTabs + ProductGrid; mobile bottom bar (FRONTEND-21).
- **Dependencies**: FRONTEND-04, FRONTEND-06, FRONTEND-07, FRONTEND-08
- **Deliverables**: `src/app/page.tsx`
- **Acceptance Criteria**: Page renders all sections with placeholder data.

### ✅ FRONTEND-10: Category page

- _Completed 2026-06-02 — `storefront/src/app/category/[handle]/page.tsx` (async Server Component, route `/category/[handle]`): reads the async `params.handle` (Next 15), filters inline placeholder products by `categoryHandle`, renders matches in a `ProductGrid` of `ProductCard`s beside the reused `FilterSidebar` (FRONTEND-11) — desktop rail / mobile drawer handled inside the sidebar. Layout `flex-col` (mobile) → `small:flex-row` (desktop). Category title (`text-3xl font-medium uppercase`) from a handle→name map mirroring the SETUP-09 seed. Placeholder images from the Medusa demo bucket allow-listed in `next.config.js`. **Scope:** route path follows the concrete Deliverable (`/category/[handle]`) not the Requirements' shorthand `/[category]`; starter's separate `[countryCode]/(main)/categories` route left untouched. `TopNav` + heading added for navigable page chrome (FRONTEND-09 precedent). Sidebar's own multi-select filters are interactive but not wired to re-filter this server-rendered grid (would require a client page; grid is filtered by route category, which the acceptance requires). Verified: clean `tsc --noEmit`; category filter confirmed by inspection. Live browser render not run in-session._
- **Objective**: Per-category listing.
- **Requirements**: Route `/[category]`; filtered grid; reuses FilterSidebar.
- **Dependencies**: FRONTEND-09, FRONTEND-11
- **Deliverables**: `src/app/category/[handle]/page.tsx`
- **Acceptance Criteria**: Renders only that category's products.

### ✅ FRONTEND-11: Filter sidebar / drawer

- _Completed 2026-06-02 — `storefront/src/components/product/FilterSidebar.tsx` (`"use client"`): four filter groups (Category/Size/Color/Price), each a `heading-md` header (`text-base font-medium leading-7`) + multi-select `Chip` options (active = ink fill), separated by 1px `divide-hairline` dividers at `spacing.lg` (18px). **Desktop (≥1024px = config `small`):** fixed `w-56` (≈220px, kept on the 8px grid per design rule) `bg-canvas` left rail (`hidden w-56 shrink-0 bg-canvas small:block`). **Mobile (≤1023px):** rail hidden behind a "Filters" `PillButton` opening a full-screen off-canvas drawer (`fixed inset-0`, slide transition, `XMark` close). Shared `renderGroups()` in both; selection is internal with an optional `onChange(selected)` (`Record<group,string[]>`, immutable updates) for a parent to drive filtering. Color filtered by name (Chips), not swatches (swatches = FRONTEND-13). Header uses `heading-md` per task Requirements (over the DESIGN component-note `body-strong`; differ only in line-height). Reuses FRONTEND-03 primitives + `@medusajs/icons` only; tokens-only. Verified: clean `tsc --noEmit`; rail/drawer + boundary confirmed by inspection. Live browser render not run in-session._
- **Objective**: Filters by category/size/color/price.
- **Requirements**: Desktop 220px left rail (hairline dividers, group headers `heading-md`); mobile off-canvas drawer toggled from a Filter button.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/product/FilterSidebar.tsx`
- **Acceptance Criteria**: Rail shows on desktop; becomes a drawer ≤1023px.

### ✅ FRONTEND-12: PDP image gallery

- _Completed 2026-06-02 — `storefront/src/components/product/Gallery.tsx` (`"use client"`): large 1:1 main image (`relative aspect-square w-full bg-soft-cloud`) via `next/image` `fill` + explicit `sizes` (`(min-width: 1024px) 50vw, 100vw`) + `priority`, no radius — same image treatment as `ProductCard`; below it a horizontally scrollable (`overflow-x-auto`, `gap-2`) strip of fixed 64px 1:1 thumbnails (`h-16 w-16`, grid-aligned, also `next/image`). Clicking a thumbnail sets local `activeIndex` and swaps the main image. Active thumbnail marked with a 1px `border-ink` (inactive `border-transparent` → no layout shift); ink not accent, per design rule reserving accent for sale price + KHQR CTA. Strip hidden when ≤1 image; thumbnails are `aria-pressed` buttons with `aria-label`. `DESIGN.md` has no gallery section, so the task Requirements were the sole spec. Tokens-only, no gradients/shadows/`dark:`. Verified: `Gallery.tsx` clean on `tsc --noEmit` (remaining project errors are pre-existing in the untouched Medusa starter `src/modules/*`); thumbnail→main swap confirmed by inspection. Wired into the PDP by FRONTEND-14. Live browser render not run in-session._
- **Objective**: Product images.
- **Requirements**: Large 1:1 image on `soft-cloud` + thumbnail strip; `next/image`.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/product/Gallery.tsx`
- **Acceptance Criteria**: Selecting a thumbnail swaps the main image.

### ✅ FRONTEND-13: Variant picker (color + size + stock)

- _Completed 2026-06-02 — `storefront/src/components/product/VariantPicker.tsx` (`"use client"`, 196 lines): presentational picker taking `variants: VariantOption[]` (`id, color, colorHex, size, stock`) + optional `onVariantChange(variant | null)`. **Color swatch dots:** unique colorways (first-seen order), 44px touch target wrapping a 32px `rounded-full` dot filled from `colorHex` via inline style (DESIGN.md defines swatch fills as product data); inactive = 1px `hairline` ring (white-colorway visibility), active = DESIGN.md concentric selected-state ring (`ring-2 ring-ink ring-offset-2 ring-offset-canvas` = 2px ink outer + 2px canvas gap, not a decorative shadow). **Size pills:** reuse the `Chip` primitive (active = ink fill); a size with no in-stock variant for the selected color is `disabled` + `line-through` + `opacity-50` and guarded against selection. **Stock note** (caption-sm mute, `aria-live="polite"`): "Select a size" → "{n} left"; sold-out sizes conveyed by struck pills with `aria-label` "{size}, sold out". Owns color/size state, resolves the in-stock variant and emits it (null when no valid in-stock variant) so FRONTEND-14 can gate buy actions; changing color clears a now-unavailable size. Tokens-only, immutable updates, no gradients/shadows/`dark:`. Note: swatch rendered at an accessible 44px target rather than DESIGN.md's literal 12px static-card dot. Verified: clean `tsc --noEmit` for this file (remaining errors pre-existing in untouched starter `src/modules/*`); zero-stock disable+strike and variant emit confirmed by inspection. Live browser render not run in-session._
- **Objective**: Choose variant with live stock state.
- **Requirements**: Color swatch dots (active = ink ring), size pills; out-of-stock size = disabled + struck; show "N left" / "sold out" from inventory.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/product/VariantPicker.tsx`
- **Acceptance Criteria**: A zero-stock size is non-selectable and struck; selection sets the active variant.

### ✅ FRONTEND-14: PDP action block

- _Completed 2026-06-02 — `storefront/src/components/product/BuyBox.tsx` (`"use client"`, 95 lines) + `storefront/src/app/product/[handle]/page.tsx` (`"use client"`, 103 lines). **BuyBox:** price row mirrors `ProductCard` (full price = ink; sale = struck original in `mute` + sale price in `accent`); "Add to bag" reuses the `PillButton` primitive (ink primary); "Pay with KHQR" is the outline accent CTA — same 48px pill geometry/`button-md` type as `PillButton` but `border-accent` + `text-accent` with the `@medusajs/icons` `Scan` icon (no QR icon exists in the project's single icon set, so `Scan` = "scan to pay"); free-delivery note "Free delivery over $50" (caption-sm mute). Both CTAs `disabled` unless `hasSelectedVariant`. Accent appears only on the sale price + KHQR CTA, per design rule. **PDP page:** client route composing `Gallery` (FRONTEND-12) + `VariantPicker` (FRONTEND-13) + `BuyBox`; lifts the selected variant via `VariantPicker.onVariantChange` into state and passes `hasSelectedVariant` to `BuyBox`. Two-column desktop (`small:flex-row`), single-column mobile-first. Placeholder product/variants/images (demo bucket, some sizes stocked 0) per the FRONTEND-09/10 precedent — real SDK fetch + cart/KHQR wiring is INTEGRATION-phase. KHQR outline CTA rendered inline in BuyBox (no outline-button primitive exists; a new `ui/` primitive is out of this task's Deliverables). Tokens-only, no gradients/shadows/`dark:`. Verified: clean `tsc --noEmit` for both files (remaining errors pre-existing in untouched starter `src/modules/*`); composition + variant-gated buttons confirmed by inspection. Live browser render not run in-session._
- **Objective**: Price + buy actions.
- **Requirements**: Price (sale in accent + struck original), `PillButton` "Add to bag", outline "Pay with KHQR" (qr icon), free-delivery note (free over $50).
- **Dependencies**: FRONTEND-13, FRONTEND-03
- **Deliverables**: `src/components/product/BuyBox.tsx`, `src/app/product/[handle]/page.tsx`
- **Acceptance Criteria**: PDP composes gallery + picker + actions; buttons enabled only with a variant selected.

### ✅ FRONTEND-15: Cart page

- _Completed 2026-06-02 — `storefront/src/app/cart/page.tsx` (`"use client"`): route `/cart`. Line items (1:1 `soft-cloud` thumbnail via `next/image`, name + `productId · variant` label, unit price with sale treatment — struck `mute` original + `accent` sale price), inline qty stepper (−/N/+, 44px targets, decrement disabled at 1) and `Trash` remove (`@medusajs/icons`). Order summary recomputes subtotal live from `Σ unitPrice×qty`; delivery fee = `(empty || subtotal ≥ $50) ? 0 : $1.50`, rendered "Free"/`$1.50`; "Free delivery over $50" note; ink Checkout `PillButton`. Empty state with "Continue shopping". Reuses `PillButton`/`TopNav`, tokens-only, no new primitive/dependency. DELIVERY_FEE/FREE_DELIVERY_THRESHOLD held as named constants (env/BACKEND-01 wiring is INTEGRATION); placeholder in-memory data — SDK cart wiring is INTEGRATION-02. Verified clean `tsc --noEmit` for this file._
- **Objective**: Review bag.
- **Requirements**: Line items (variant, qty steppers, remove), subtotal, delivery fee + free-over-threshold note ($1.50 fee, free over $50), Checkout `PillButton`.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/app/cart/page.tsx`
- **Acceptance Criteria**: Qty change updates subtotal; fee shows/zeroes per threshold.

### ✅ FRONTEND-16: Checkout form

- _Completed 2026-06-02 — `storefront/src/components/checkout/DeliveryForm.tsx` (`"use client"`) + `storefront/src/app/checkout/page.tsx` (`"use client"`, route `/checkout`). **DeliveryForm:** controlled four-field form (Full Name, **Phone required**, Address, Note); exports `DeliveryDetails`, `EMPTY_DELIVERY_DETAILS`, and `isValidPhone` (regex `^(\+855|0)[1-9]\d{7,8}$` from security.md, whitespace-tolerant) as the shared validator; fields reuse FRONTEND-03's `SearchPill` treatment (soft-cloud fill, ink focus border — DESIGN.md documents no checkout field component, so no new token/primitive invented; single-line = pills, multi-line = `rounded-large`); phone format hint surfaces as an error only after invalid input; phone never logged. **Checkout page:** composes `DeliveryForm` + KHQR/COD payment radio group (`PaymentChoice`, accessible `fieldset`/`legend` + real `<input type="radio">` with ink indicator) + order summary (subtotal, delivery, **total**, free-over-$50 note) + Place-order `PillButton` `disabled` until `isValidPhone(details.phone)`. Reuses `TopNav`/`PillButton`; tokens-only, accent-free (accent reserved for sale price + KHQR CTA, so the method radio uses ink). Placeholder summary numbers + locked delivery rule (flat $1.50, free ≥ $50) per FRONTEND-15 precedent; live SDK cart, COD POST (`/store/orders/cod`), and KHQR start are INTEGRATION-phase (KHQR Place-order routes to `/checkout/khqr`). Verified: clean `tsc --noEmit` on both deliverable files (remaining errors pre-existing in untouched starter `src/modules/checkout/components/shipping/index.tsx`); submit-gating + option selectability confirmed by inspection. Live browser render not run in-session._
- **Objective**: Delivery info + payment choice.
- **Requirements**: Fields Full Name, **Phone (required)**, Address, Note; payment radio KHQR / COD; summary with total; Place-order `PillButton` disabled until phone valid.
- **Dependencies**: FRONTEND-15
- **Deliverables**: `src/app/checkout/page.tsx`, `src/components/checkout/DeliveryForm.tsx`
- **Acceptance Criteria**: Submit blocked without phone; both payment options selectable.

### ✅ FRONTEND-17: Facebook login button

- _Completed 2026-06-02 — `storefront/src/components/checkout/FacebookLogin.tsx` (`"use client"`). Renders a "Continue with Facebook" ink outline pill (`<a>`, PillButton geometry, accent-free per design.md) linking to `/store/auth/facebook` (BACKEND-05 OAuth start) — relative href per the agreed same-origin-rewrite approach (no public backend origin is exposed to client code; same-origin also keeps the `SameSite=Strict` session cookie usable), overridable via `loginHref`. Prefill-on-return: a mount-only effect reads the current customer via the existing `retrieveCustomer()` (`GET /store/customers/me`); if a session exists it emits the combined `first_name`/`last_name` display name through the `onPrefillName` callback (guests → `null`, nothing prefilled), matching PRD §7 "session + {customer}". No third-party social-button library; tokens-only. Two auth-flow ambiguities were resolved with the user before coding (prefill source = SDK customer fetch via session; link target = relative path + rewrite). Scope: this task's sole deliverable is the component; mounting it in the checkout page + binding `onPrefillName` to form state, and reconciling BACKEND-05's session cookie with the starter's token-auth header, are INTEGRATION. Verified: clean `tsc --noEmit` for the file (remaining errors pre-existing in untouched starter `src/modules/*`). Full OAuth round-trip not run in-session (needs the INTEGRATION rewrite + FB credentials)._
- **Objective**: Optional social sign-in.
- **Requirements**: "Continue with Facebook" linking to `/store/auth/facebook`; prefills name on return.
- **Dependencies**: FRONTEND-16
- **Deliverables**: `src/components/checkout/FacebookLogin.tsx`
- **Acceptance Criteria**: Button initiates the FB flow; returned name prefills the form.

### ✅ FRONTEND-17B: Google login button

- _Completed 2026-06-02 — `storefront/src/components/checkout/GoogleLogin.tsx` (`"use client"`), a direct mirror of `FacebookLogin` (FRONTEND-17) with only the endpoint changed. Renders a "Continue with Google" ink outline pill (`<a>`, PillButton geometry, accent-free per design.md, no third-party social-button library) linking to `/store/auth/google` (BACKEND-05C OAuth start) — relative href per the same-origin-rewrite approach (overridable via `loginHref`). Prefill-on-return: a mount-only effect reads the current customer via the existing `retrieveCustomer()` (`GET /store/customers/me`) and emits the combined `first_name`/`last_name` display name through `onPrefillName` (guests → `null`), matching PRD §7 "session + {customer}". The two auth decisions resolved in FRONTEND-17 (prefill = SDK session fetch; link = relative path + rewrite) carry over by this task's "reuse the same pattern" instruction. Scope: sole deliverable is the component; mounting it in the checkout page + binding `onPrefillName`, and reconciling BACKEND-05C's session cookie with the starter's token-auth header, are INTEGRATION. Verified: clean `tsc --noEmit` for the file (remaining errors pre-existing in untouched starter `src/modules/*`). Full OAuth round-trip not run in-session (needs the INTEGRATION rewrite + Google credentials)._
- **Objective**: Optional social sign-in (parallel to FRONTEND-17, Facebook).
- **Requirements**: "Continue with Google" linking to `/store/auth/google` (BACKEND-05C); prefills name on return. Reuse the same login-button placement/pattern as `FacebookLogin`; do not introduce a third-party social-button library (design.md). Accent color is NOT used (reserved for sale price + KHQR CTA).
- **Dependencies**: FRONTEND-16, BACKEND-05C
- **Deliverables**: `src/components/checkout/GoogleLogin.tsx`
- **Acceptance Criteria**: Button initiates the Google flow (`/store/auth/google`); returned name prefills the form.

### ✅ FRONTEND-18: KHQR pay screen

- _Completed 2026-06-02 — `storefront/src/app/checkout/khqr/page.tsx` (`"use client"`), route `/checkout/khqr` (already the target of `checkout/page.tsx`'s KHQR branch). Renders the Bakong QR by encoding the EMVCo `qr` string client-side with `qrcode.react`'s `QRCodeSVG` (high-contrast ink-on-canvas, level M, quiet zone) — added `qrcode.react@4.2.0` (exact-pinned per `.npmrc`; ISC; zero runtime deps; native React 19 peer; renders to SVG so CSP-safe and the sensitive `qr` never leaves the browser). The QR-library choice was the one blocker; raised via the task's STOP-and-ask path and the operator answered "pick one for me". Live `m:ss` countdown to `expires_at` (1s interval, `aria-live`); 3s auto-poll (matches BACKEND-03B verify-cache TTL, under the 60/min/reference limit) that routes to `/order/[id]` on `paid` and reveals a **Regenerate QR** button on expiry. Coral accent used exactly once — the optional "Pay with KHQR" deeplink CTA (rendered only when the proxy returned a deeplink), styled as an `<a>` per the `FacebookLogin` pill-anchor precedent. Per FRONTEND-16's precedent the two seam functions (`startKhqr`/`pollKhqrStatus`) are local placeholders — a synthetic non-account sample QR + a perpetually-`pending` status (never a fabricated `paid`, security.md) — whose shapes match the BACKEND-03/03B contracts; INTEGRATION-05 replaces only their bodies with `@lib/checkout` calls. Verified: clean `tsc --noEmit` for the file (the `next lint --file` rule-load error is a pre-existing tooling artifact, reproduces on the existing checkout page). Full payment round-trip not run in-session (needs the INTEGRATION-05 wiring + Bakong sandbox)._
- **Objective**: Show QR and await payment.
- **Requirements**: Render `qr` + deeplink button + countdown to `expires_at` + auto-poll; "regenerate" on expiry.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/app/checkout/khqr/page.tsx`
- **Acceptance Criteria**: Displays a scannable QR and a live countdown; expiry reveals regenerate.

### ✅ FRONTEND-19: Order confirmation

- _Completed 2026-06-02 — `storefront/src/app/order/[id]/page.tsx`, route `/order/[id]` (the target of the KHQR pay screen's `paid` redirect and the COD checkout route). Server Component (Stack.md default; static content + links, no interactivity) rendering `TopNav` + one of two variants keyed off `order.state`: **paid** → `CheckCircle` "Payment confirmed" receipt + order reference + invoice link; **COD** (`pending_confirmation`) → `BellAlert` "Order placed" / "Our team will contact you to confirm…" + Facebook page & Telegram support buttons (external ink-outline anchor-pills, `rel="noreferrer noopener"`, FacebookLogin precedent) + the same invoice link. Accent-free (design.md reserves coral for sale price + KHQR CTA); single icon set `@medusajs/icons` outline only; named tokens + 8px grid throughout. Per the FRONTEND-16/18 placeholder precedent the variant is driven by a local `fetchOrderConfirmation` seam returning `{id, state, invoiceUrl}` — choosing the variant from an optional `?status=cod` hint so both render now (`/order/<id>` paid; `/order/<id>?status=cod` COD), never fabricating "paid" from client data (security.md); INTEGRATION-04/05 replace the seam body with the real Medusa SDK order lookup deriving the variant from server-verified payment status and drop the hint. Invoice link points at `GET /store/orders/:id/invoice` (same-origin relative; order-token plumbing is an INTEGRATION concern); order id is `encodeURIComponent`-escaped into the path and React-escaped on display. Facebook/Telegram URLs are public placeholder constants (no env defined; set at config/INTEGRATION). Verified: clean `tsc --noEmit` for the file (remaining repo TS errors are pre-existing, in untouched starter `[countryCode]`/`modules` files). Live order data not fetched in-session (INTEGRATION-04/05)._
- **Objective**: Post-order screen for both paths.
- **Requirements**: Paid → receipt + invoice link; COD → "our team will contact you" + Facebook page + Telegram support buttons + invoice link.
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/app/order/[id]/page.tsx`
- **Acceptance Criteria**: Paid and COD orders each render their correct variant.

### ✅ FRONTEND-20: Footer

- _Completed 2026-06-02 — `storefront/src/components/layout/Footer.tsx` (presentational Server Component, no `"use client"`): `bg-canvas` footer with a 1px `border-hairline` **top divider**, four link columns (**Help / Delivery / Telegram / Facebook**) in a 1-up → `min-[600px]:` 2-up → `min-[1024px]:` 4-up grid — each a body-strong ink header (`text-base font-medium`) over a caption-md mute `next/link` list (`text-sm font-medium leading-normal`, placeholder `/` hrefs) — then a second `border-hairline` `<hr>` rule and the **`utility-xs` copyright row** (`© {year} Ali Store…`, `text-[9px] font-medium leading-[1.75]`). The 9px utility-xs token is hit via primitives because no typography utility class exists and `tailwind.config.js` is outside this task's Deliverables (same precedent as Hero's `leading-[0.9]`); 9px is DESIGN.md's explicit fine-print exception to the 12px minimum. Column sub-links + hrefs are placeholders (real Help/Delivery routes and Telegram/Facebook channel URLs not wired yet), consistent with TopNav. Tokens-only, no accent/gradients/shadows/`dark:`, weights 400/500 only. Verified: clean `tsc --noEmit` for the file. Footer not yet composed into layout/home (outside the single declared Deliverable). Live browser render not run in-session._
- **Objective**: Site footer.
- **Requirements**: Link columns (Help, Delivery, Telegram, Facebook), hairline dividers, `utility-xs` copyright row.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/layout/Footer.tsx`
- **Acceptance Criteria**: Footer renders with dividers and links.

### ✅ FRONTEND-21: Mobile bottom bar

- _Completed 2026-06-02 — `storefront/src/components/layout/BottomBar.tsx`: presentational `"use client"` mobile cart/checkout bar. Left = `ShoppingBag` icon (`@medusajs/icons`, TopNav's set) + pluralized item-count label (`{n} item`/`items`) with `aria-live="polite"`; right = ink `PillButton` (FRONTEND-03) navigating to `/checkout` via `useRouter().push` (cart-page pattern), disabled when the bag is empty. Hidden at ≥600px via `min-[600px]:hidden` → visible ≤599px only (project 1-up boundary, same variant as TopNav/Footer). Normal document flow with a single `border-t border-hairline` separator — no `position: fixed`, no shadow. Tokens-only (`bg-canvas`/`text-ink`/`border-hairline`), no accent, 500 weight only, no new deps. `itemCount` is a prop — live cart source (`lib/cart.ts`) is INTEGRATION-02; bar re-renders on count change. Verified clean `tsc --noEmit`; static/type verification only — live 360px browser render not run in-session._
- **Objective**: Persistent cart/checkout bar on mobile.
- **Requirements**: Item count left, Checkout `PillButton` right; hidden on desktop. (Normal flow — no `position: fixed` issues.)
- **Dependencies**: FRONTEND-03
- **Deliverables**: `src/components/layout/BottomBar.tsx`
- **Acceptance Criteria**: Shows ≤599px with live item count; hidden on desktop.

### ✅ FRONTEND-22: Currency formatting

- _Completed 2026-06-02 — `src/lib/price.ts` formats a USD-base amount in the currency chosen by the nav toggle (FRONTEND-04): USD via `Intl` (2-dp, `$`, grouping); KHR derived from USD through `USD_KHR_RATE` (placeholder 4100, mirroring backend `usdToKhr`), rounded to whole riel and rendered with the `៛` prefix (manual symbol — `en-US` ICU renders KHR as the code). Exposes `formatPrice`/`formatUsd`/`formatKhr`/`usdToKhr`/`getUsdKhrRate` + a `Currency` type; rate read from `NEXT_PUBLIC_USD_KHR_RATE` then `USD_KHR_RATE`, with an injectable `usdKhrRate` override. `tsc -p` clean; runtime-verified `$29.00`/`$1,299.50` and `៛118,900`/`៛50,594` (no decimals), `usdToKhr(1)=4100`, toggle `$10.00`↔`៛41,000`. Component wiring is INTEGRATION-phase (presentational components already take display-ready strings)._
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

### INTEGRATION-06B: Google login wiring

- **Objective**: End-to-end Google social login (parallel to INTEGRATION-06, Facebook).
- **Requirements**: Wire button → BACKEND-05C/05D → session → prefilled form. Reuse `src/lib/auth.ts` (extend, do not fork) so Facebook and Google share the post-login session/prefill handling.
- **Dependencies**: FRONTEND-17B, BACKEND-05D
- **Deliverables**: `src/lib/auth.ts`
- **Acceptance Criteria**: Completing Google login returns to checkout with the name prefilled.

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

### TEST-08B: Google login

- **Objective**: Verify Google social login (parallel to TEST-08, Facebook).
- **Requirements**: Complete Google login (test OAuth client) → customer + `customer_social_identity` row (`provider=google`).
- **Dependencies**: INTEGRATION-06B
- **Deliverables**: `tests/google-login.spec.ts`
- **Acceptance Criteria**: One identity row created (`provider=google`); session returned.

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
