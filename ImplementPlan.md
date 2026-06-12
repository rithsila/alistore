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
- **CLARIFY-12 (PayWay credentials)** — ABA PayWay sandbox `merchant_id`/`api_key` (self-register at sandbox.payway.com.kh, arrive by email) and, post-UAT, production credentials + egress-IP whitelisting via paywaysales@ababank.com. Non-blocking for dev: PAYWAY tasks build against the local hash-verifying mock (`sandbox/aba-payway/mock-server.mjs`, :4284). → PAYWAY-08. **Locked decisions (2026-06-10):** PayWay **replaces** Bakong as the active KHQR provider (Bakong module stays dormant unless its creds are set); v1 scope is **KHQR-only** (`abapay_khqr_deeplink`) — no hosted card checkout. Research + API contract: `docs/aba-payway-integration-guide.md`.
- **CLARIFY-13 (Google login in v1 scope) ⚠️** — `CLAUDE.md` / `Stack.md` / FRONTEND-17 lock **Facebook** as the _optional_ customer OAuth provider for v1; Google sign-in was added later (BACKEND-05C, FRONTEND-17B, INTEGRATION-06B, TEST-08B) and is now live in the account menu and checkout. Decide whether Google **stays in v1** or is **deferred to v2** (Facebook-only for v1). Surfaced by the FRONTEND-29 account-menu research (2026-06-12): a passwordless, phone-first Cambodia shop leading its account menu with two Western social providers is off-pattern; trimming to Facebook-only is one option. **Non-blocking:** both providers remain until resolved; FRONTEND-29 keeps both and removes nothing unilaterally. → FRONTEND-29, FRONTEND-17B.

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

### ✅ BACKEND-02: CSV product/variant import

- **Completed 2026-06-12** — Deliverables shipped: `imports/products-template.csv` (3 sample products × 6 variants each, authored against Medusa v2.15.3's official product-import column format — one row per variant, Size × Color options, separate USD + KHR price columns, SKUs, image URLs) and `docs/import.md` (column reference, prerequisites, Admin import steps, and the required manual post-import steps). Acceptance criterion amended (this task): Medusa's built-in CSV importer creates inventory *items* but **not** stocked quantities, and cannot set sales-channel/category from CSV (verified against the v2.15.3 importer) — so inventory levels + sales-channel assignment are documented manual post-import steps in `docs/import.md`, not an import side effect. The interactive Admin import itself is an operator action (not executed in-session).
- **Objective**: Bulk-load catalog with per-size/color variants.
- **Requirements**: Define the import CSV using **Medusa's official product-import column format** (one row per variant: product title/handle, category, color, size, SKU, USD price, KHR price, initial stock, image URL). No source Google Sheet exists (CLARIFY-09 resolved) — author a **simple ready-made sample clothing catalog** against that format; use Medusa Admin's built-in product import.
- **Dependencies**: SETUP-09
- **Deliverables**: `imports/products-template.csv`, `docs/import.md`
- **Acceptance Criteria**: Importing the template (Medusa Admin → Products → Import) creates products with their Size × Color variants and USD + KHR prices; inventory levels and sales-channel assignment are then set manually post-import per `docs/import.md` (Medusa's CSV importer creates inventory *items* but not stocked quantities, and cannot assign sales-channel/category from CSV); after those steps, variants are visible in `/store/products`.

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

### ✅ BACKEND-11: OAuth return intent (account vs checkout)

- _Completed 2026-06-12 — both OAuth start routes (`api/store/auth/facebook/route.ts`, `api/store/auth/google/route.ts`) now accept an optional `?intent=` resolved against a hard-coded `{ checkout: "/checkout", account: "/account" }` map (type-narrowing guard, default `checkout`) and store the resolved path as `return_to` in the existing single-use Redis state entry (`{ issued_at, return_to }`). Both callbacks (`…/facebook/callback`, `…/google/callback`) read `return_to` from the already-verified state, re-validate it against the same path allowlist (defense in depth, default `/checkout`), and use it for the terminal `res.redirect(302, …)` in place of the removed hard-coded `STOREFRONT_RETURN_PATH`. No client redirect URL is ever echoed — the target rides the server-side, single-use state; default `/checkout` behavior is unchanged when no `intent` is supplied (the two OAuth E2E specs, which start without an intent, still land on `/checkout`). Security (security.md): redirect target server-derived from a hard-coded allowlist, prototype-safe lookups (literal-key narrowing on the start side, `Set<string>` membership on the callback side). `npm run build` clean (backend 6.35s + admin 25.60s)._
- **Objective**: Let social login return the browser to `/account` (login-from-nav) while keeping `/checkout` the default — without echoing any client-supplied redirect target (security.md).
- **Requirements**: In both OAuth start routes (`api/store/auth/facebook/route.ts`, `api/store/auth/google/route.ts`) accept an optional `?intent=` resolved against a hard-coded map `{ checkout: "/checkout", account: "/account" }` (default `checkout`); store the resolved path in the existing single-use Redis state entry (`{ issued_at, return_to }`). In both callbacks read `return_to` from the already-fetched state entry, re-validate it against the same allowlist (defense in depth; default `/checkout`), and use it for the terminal `res.redirect(302, …)` in place of the hard-coded `STOREFRONT_RETURN_PATH`. No client redirect URL is ever echoed; the target rides the server-side, single-use state. Default `/checkout` behavior is unchanged when no `intent` is supplied. Per plan `docs/superpowers/plans/2026-06-11-customer-accounts-wave1.md` (Task 2) and spec `docs/superpowers/specs/2026-06-11-customer-account-design.md` (§9).
- **Dependencies**: BACKEND-05, BACKEND-05C
- **Deliverables**: `backend/src/api/store/auth/facebook/route.ts` (modified), `backend/src/api/store/auth/facebook/callback/route.ts` (modified), `backend/src/api/store/auth/google/route.ts` (modified), `backend/src/api/store/auth/google/callback/route.ts` (modified)
- **Acceptance Criteria**: `GET /store/auth/{facebook,google}?intent=account` completes login and 302s to `/account`; no `intent` (or an unknown one) 302s to `/checkout`; an unrecognized stored value falls back to `/checkout`; `npm run build` clean.

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
- _Updated 2026-06-05 — Footer is now **mounted once in the root layout** (`storefront/src/app/layout.tsx`, commit `162ec20`) so every page carries it (DESIGN.md: identical chrome across the page set; ecommerce best practice: footer on all pages). Mobile columns changed from a tall 1-up stack to a **2-up grid** (Help/Delivery, Telegram/Facebook), 4-up at ≥1024 (commit `4ca555b`). Acceptance criterion now **live-verified**: `<footer>` + dividers + links + copyright render on `/`, `/cart`, `/checkout` (served HTML), and a 360px headless-Chromium screenshot confirms the 2×2 layout._
- **Objective**: Site footer.
- **Requirements**: Link columns (Help, Delivery, Telegram, Facebook), hairline dividers, `utility-xs` copyright row.
- **Dependencies**: FRONTEND-01
- **Deliverables**: `src/components/layout/Footer.tsx`
- **Acceptance Criteria**: Footer renders with dividers and links.

### ✅ FRONTEND-21: Mobile bottom bar

- _Completed 2026-06-02 — `storefront/src/components/layout/BottomBar.tsx`: presentational `"use client"` mobile cart/checkout bar. Left = `ShoppingBag` icon (`@medusajs/icons`, TopNav's set) + pluralized item-count label (`{n} item`/`items`) with `aria-live="polite"`; right = ink `PillButton` (FRONTEND-03) navigating to `/checkout` via `useRouter().push` (cart-page pattern), disabled when the bag is empty. Hidden at ≥600px via `min-[600px]:hidden` → visible ≤599px only (project 1-up boundary, same variant as TopNav/Footer). Normal document flow with a single `border-t border-hairline` separator — no `position: fixed`, no shadow. Tokens-only (`bg-canvas`/`text-ink`/`border-hairline`), no accent, 500 weight only, no new deps. `itemCount` is a prop — live cart source (`lib/cart.ts`) is INTEGRATION-02; bar re-renders on count change. Verified clean `tsc --noEmit`; static/type verification only — live 360px browser render not run in-session._
- _Updated 2026-06-05 — BottomBar is now **mounted on the home page** (`storefront/src/app/page.tsx`, FRONTEND-09's stated requirement; commit `162ec20`) and its `itemCount` prop was replaced by the **live `useCartCount()` subscription** (`@lib/hooks/use-cart-count` — the exact pattern TopNav's bag badge uses), so the count and the Checkout-disabled state update without navigation. Acceptance criterion now **live-verified**: bar renders at 360px ("0 items" + Checkout pill, user screenshot + served HTML on `/`), hidden ≥600px via `min-[600px]:hidden`._
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

### ✅ FRONTEND-23: Product search

- **Completed 2026-06-11** — Wired the dead `TopNav` magnifier into working submit-based keyword search. New `NavSearch` (client, desktop ≥600px) expands a `SearchBox` to the left of the icon, autofocuses it, and collapses on Escape / pointer-down outside / second click (icon flips to ✕); while collapsed the field is `disabled` so it stays out of the tab order. `SearchBox` is a thin `next/form` GET composition over the FRONTEND-03 `SearchPill` (`name="q"`, `maxLength=100`) that navigates to `/search?q=` — reused both in the nav and, prefilled, atop the results page. New `/search` Server Component (`app/search/page.tsx`) mirrors the `category/[handle]` shell (own `TopNav` + `max-w-8xl` main), reads `q` (array-safe, trimmed), and renders three states: empty → "Search for products by name." prompt; no matches → `No products match "<q>".`; matches → `Results for "<q>"` heading + `ProductGrid`/`ProductCard`. Backed by a new `searchProducts()` in `@lib/medusa` (stock Medusa `GET /store/products?q=`, reuses `PRODUCT_FIELDS` + `toCatalogProduct`/`isCatalogProduct`, trims + 100-char caps the query, skips priceless products, short-circuits empty queries with no round-trip). Mobile hamburger drawer gained a "Search" row (magnifier + label) linking to `/search`; the 3-element mobile top row and the Account/User icon are untouched. `q` is React-escaped wherever echoed (XSS-safe); named tokens only, accent stays reserved, no gradients/shadows/`dark:` — `width`-only reveal animation. `tsc --noEmit` clean (exit 0); design-violation scan of all four files found only explanatory comments. 360px holds by construction (NavSearch is desktop-only inside the `min-[600px]:flex` cluster; the drawer row and `/search` shell reuse primitives already verified at 360px) — no fresh live screenshot taken this session.
- **Objective**: Wire the dead `TopNav` magnifier into working keyword product search.
- **Requirements**: Desktop — the magnifier expands a `SearchPill` out to the left (autofocus on open; collapses on Esc / click-away / second click); typing a query + Enter navigates to `/search?q=`. Mobile — add a "Search" row to the hamburger drawer linking to `/search` (3-element mobile top row unchanged). New `/search` Server Component (mirrors the `category/[handle]` shell: own `TopNav` + `max-w-8xl` main) renders a prefilled `SearchBox` then lists products matching `q` via a new `searchProducts()` helper in `src/lib/medusa.ts` (stock Medusa `GET /store/products?q=`, reusing `PRODUCT_FIELDS` + `toCatalogProduct`) in `ProductGrid` / `ProductCard`. States: empty/whitespace `q` → prompt; 0 results → `No products match "<q>"`; results → `Results for "<q>"` heading + grid. No filter sidebar in v1. Submit-based only — NOT search-as-you-type (PRD §2, v2-deferred). `q` trimmed + length-capped and React-escaped (XSS-safe). Reuses existing primitives; named tokens only, accent stays reserved (sale price + KHQR), no gradients/shadows/`dark:`, verified at 360px. `SearchBox`/`NavSearch` are compositions of the existing `SearchPill`, not new design primitives. Per design spec `docs/superpowers/specs/2026-06-11-storefront-product-search-design.md`.
- **Dependencies**: FRONTEND-03, FRONTEND-04, FRONTEND-06, INTEGRATION-01
- **Deliverables**: `src/app/search/page.tsx`, `src/components/layout/SearchBox.tsx`, `src/components/layout/NavSearch.tsx`, `src/components/layout/TopNav.tsx` (modified), `src/lib/medusa.ts` (modified — add `searchProducts`)
- **Acceptance Criteria**: Nav magnifier expands an autofocused input that collapses on Esc / click-away / second click; Enter navigates to `/search?q=`; `/search?q=<term>` lists matching products with the field prefilled; empty `q` shows the prompt and a non-matching `q` shows the no-results copy; the mobile hamburger drawer has a "Search" row; layout holds at 360px; no accent misuse, shadows, gradients, or `dark:`; the Account/User icon is left unchanged.

### ✅ FRONTEND-24: Size Guide page

- **Completed 2026-06-11** — `/size-guide` info page built on `InfoPageLayout` (FAQ/Delivery/Returns frame → shared single `<h1>`): intro, Asia-fit note, how-to-measure tips, and Tops/Bottoms `<table>`s rendered generically from `src/lib/size-guide.ts` — refactored so the numeric `TOP_FIT`/`BOTTOM_FIT` tables are the single source of truth, with the display strings + US/EU/UK equivalents derived (no values hardcoded in the page) and a header NOTE flagging the figures as placeholders the owner must replace with real tape measurements before launch. Footer "Size Guide" repointed `/` → `/size-guide`; `tests/info-pages.spec.ts` extended (single-h1, both tables, footer-link navigation, 360px no-overflow with tables scrolling in their `overflow-x-auto` wrapper). Verified: `tsc --noEmit` clean, info-pages spec 8/8 pass, token scan clean (tokens-only, accent unused). Same-session follow-up beyond this task's scope (user-requested): an interactive client-side "Find my size" recommender — `src/app/size-guide/FitFinder.tsx` + a pure `recommendFit()` in the lib + `tests/fit.spec.ts` (9/9) — runs entirely in-browser (no body metrics sent to the server); not part of FRONTEND-24's deliverables, track under its own ID if plan coverage is wanted.
- **Objective**: Make the footer's dead "Size Guide" link (`Footer.tsx`, currently `href="/"`) a real `/size-guide` info page, closing the last placeholder Help link (Track Order stays `/` — v2, needs accounts/lookup).
- **Requirements**: Research-backed build-custom decision (no OSS package exists — npm/GitHub survey 2026-06-11; Shopify Dawn's link→static-content pattern + Farfetch blackout's category-level data model + EN 13402 open data are the references). (1) `src/lib/size-guide.ts` — typed constants, same single-source-of-truth pattern as `lib/delivery.ts`: `TOPS` and `BOTTOMS` row arrays (S/M/L/XL → body-measurement cm ranges: chest/shoulder/length for tops, waist/hip/inseam for bottoms, plus approximate US/EU/UK equivalents), `HOW_TO_MEASURE` tips (chest/waist/hip), and an Asia-fit `SIZE_NOTE` ("runs ~1 size smaller than US/EU; between sizes → size up"). Values are EN 13402-informed placeholders shifted one step down for Asian-cut garments — **owner must replace with tape measurements of actual stock before launch** (flagged in a file-header NOTE, like delivery.ts's enforcement note). (2) `src/app/size-guide/page.tsx` — Server Component reusing `InfoPageLayout` (FAQ/Delivery/Returns pattern): intro, the Asia-fit note, "How to measure" tips, then one semantic `<table>` per chart (Tops, Bottoms) rendered from the lib constants — `bg-soft-cloud` header row, `border-hairline` row dividers, Inter 400/500, wrapped in `overflow-x-auto` so 360px holds. (3) `Footer.tsx` — repoint Size Guide to `/size-guide`. (4) Extend `tests/info-pages.spec.ts` with `/size-guide` coverage (single `h1`, both tables render, footer link navigates, 360px viewport — existing spec's pattern). Tokens-only, no accent, no gradients/shadows/`dark:`, no new components or deps. PDP "Size guide" link near `VariantPicker` + modal is explicitly **out of scope** — separate future task (needs a modal primitive that doesn't exist).
- **Dependencies**: FRONTEND-01, FRONTEND-20 (footer), InfoPageLayout (footer-info-pages work, 2026-06-11)
- **Deliverables**: `src/lib/size-guide.ts`, `src/app/size-guide/page.tsx`, `src/components/layout/Footer.tsx` (modified — repoint link), `tests/info-pages.spec.ts` (modified — add `/size-guide` coverage)
- **Acceptance Criteria**: Footer "Size Guide" opens `/size-guide`; page renders Tops + Bottoms tables with cm measurements and intl equivalents derived from `lib/size-guide.ts` (no values hardcoded in the page); Asia-fit note and how-to-measure tips visible; single `h1`; layout holds at 360px with no horizontal page overflow (tables scroll within their wrapper); tokens-only styling, accent unused; Playwright info-pages spec passes; placeholder-measurement NOTE present in the lib file.

### ✅ FRONTEND-25: Unified session-aware customer reads

- _Completed 2026-06-12 — Extracted the dual-credential header builder out of `lib/auth.ts` into a new shared `src/lib/data/session-headers.ts` (`buildSessionHeaders` + `extractCookie` + `SESSION_COOKIE_NAME`, `import "server-only"`; reads the RAW Cookie header so the signed `connect.sid` is forwarded un-re-encoded). `lib/auth.ts` now imports those (private copies + the now-unused `next/headers`/`cookies` imports dropped); `retrieveSessionCustomer`/`getSocialLoginPrefillName` unchanged. `lib/data/customer.ts` routes both `retrieveCustomer` (kept `*orders`; switched `force-cache`→`no-store`, dropped the `getCacheOptions` tag-cache; short-circuits to `null` when neither `authorization` nor `cookie` is present) and `updateCustomer` through `buildSessionHeaders` — JWT behavior unchanged, social `connect.sid` sessions now resolve. Verified `npx tsc --noEmit` exit 0 (the authoritative type gate — `next.config.js` sets `typescript.ignoreBuildErrors: true`, and a full `next build` is blocked only by the live `next dev` holding `.next`). Runtime behavioural proof lands in the trailing account E2E (TEST-12 / Wave-1 Task 6)._
- **Objective**: Make the storefront's customer reads work for social-login sessions (which carry `connect.sid`, not a JWT) so the account area can resolve the signed-in customer.
- **Requirements**: Extract the dual-credential header builder currently private in `lib/auth.ts` into a shared `src/lib/data/session-headers.ts` (`buildSessionHeaders` + `extractCookie` + `SESSION_COOKIE_NAME`; reads the RAW Cookie header so the signed `connect.sid` is forwarded un-re-encoded); refactor `lib/auth.ts` to import from it (drop the private copies). Route `lib/data/customer.ts`'s `retrieveCustomer` (keep the `*orders` field expansion; switch to `cache: "no-store"`) and `updateCustomer` through `buildSessionHeaders`. No behavior change for JWT sessions; social `connect.sid` sessions now resolve. Per plan `docs/superpowers/plans/2026-06-11-customer-accounts-wave1.md` (Task 1).
- **Dependencies**: INTEGRATION-06, INTEGRATION-06B
- **Deliverables**: `src/lib/data/session-headers.ts` (new), `src/lib/auth.ts` (modified), `src/lib/data/customer.ts` (modified)
- **Acceptance Criteria**: `retrieveCustomer()` returns the customer for a `connect.sid`-only session and `null` for a guest; `updateCustomer` persists under either credential; no cross-user caching (`no-store`); `npm run build` clean.

### ✅ FRONTEND-26: Account nav popover

- _Completed 2026-06-12 — Replaced the dead desktop account button (`TopNav.tsx:177`) with a working `AccountMenu` popover and added an "Account" row to the mobile drawer. New `src/lib/account.ts` `getAccountMenuState()` (`"use server"`) reads the session-aware `retrieveCustomer()` (FRONTEND-25) and returns the display name only (no other PII to the client; mirrors `getSocialLoginPrefillName`). New `src/components/layout/AccountMenu.tsx` (`"use client"`): a `User`-icon button with `aria-haspopup="menu"`/`aria-expanded` toggling a `role="menu"` popover — signed out → "Continue with Facebook"/"Continue with Google" anchors to `/store/auth/{facebook,google}?intent=account`; signed in → "Signed in as {name}" + Account / Profile links + `<form action={logout}>` Log out; closes on Escape + outside `mousedown` (listeners attached only while open). New `logout` server action in `lib/data/customer.ts` (best-effort `sdk.auth.logout()` in try/catch for JWT-less social sessions, `removeAuthToken()`, expire `connect.sid` with `maxAge:-1, path:"/"`, revalidate the customers cache tag, `removeCartId()`, `redirect("/")`) replaces the starter's broken `signout` (grep-confirmed unreferenced; its `/${countryCode}/account` redirect 404s in this flat storefront). Ink/mute/hairline/canvas tokens only — accent unused, single hairline, no shadow/`dark:`. `npx tsc --noEmit` exit 0 (authoritative gate — `next.config.js` sets `typescript.ignoreBuildErrors`); off-token scan clean. 360px holds by construction (popover is desktop-only inside the `min-[600px]:flex` cluster; the drawer row reuses the verified pattern) — behavioural proof lands in TEST-12 (Wave-1 Task 6)._
- **Objective**: Replace the dead account icon (`TopNav.tsx:177`) with a working popover — social sign-in when signed out, account links when signed in.
- **Requirements**: New `src/lib/account.ts` server action `getAccountMenuState()` → `{ name } | null` (display name only; no other PII to the client; mirrors `getSocialLoginPrefillName`). New `src/components/layout/AccountMenu.tsx` (`"use client"`): a `User`-icon button toggling a `role="menu"` popover — signed out → "Continue with Facebook"/"Continue with Google" anchors to `/store/auth/{facebook,google}?intent=account`; signed in → greeting + Account / Profile / Log out (logout via `<form action={logout}>`). A11y: `aria-haspopup` + `aria-expanded`, Escape + outside-click close. Add the `logout` server action to `lib/data/customer.ts` (best-effort `sdk.auth.logout()`, `removeAuthToken()`, expire the `connect.sid` cookie on this origin (`maxAge: -1`), revalidate the customers cache tag, `removeCartId()`, `redirect("/")` — replaces the starter's `signout`, whose `/${countryCode}/account` redirect 404s here) so the signed-in menu's Log out works; **defined here (first consumer) rather than in FRONTEND-27, since FRONTEND-27 depends on this task**. Known limitation: the backend session record lingers to TTL; cookie expiry makes it unreachable — a proxied server-side destroy is a Wave-2 hardening follow-up. Mount it in `TopNav.tsx` (replace the dead button) and add an "Account" row to the mobile drawer (the guard sends guests back to `/`). Ink only (accent reserved for sale price + KHQR); single hairline; no shadow/`dark:`. Per plan (Task 3).
- **Dependencies**: FRONTEND-04, FRONTEND-25, BACKEND-11
- **Deliverables**: `src/lib/account.ts` (new), `src/components/layout/AccountMenu.tsx` (new), `src/components/layout/TopNav.tsx` (modified), `src/lib/data/customer.ts` (modified — add `logout`)
- **Acceptance Criteria**: Signed-out icon opens a popover with both providers (the Google href carries `intent=account`); signed-in shows account links + a working Log out; popover closes on Escape/outside-click; the mobile drawer has an Account row; layout holds at 360px; accent unused.

### ✅ FRONTEND-27: Guarded account shell (home + logout)

- _Completed 2026-06-12 — New `src/app/account/layout.tsx` (Server Component, Approach A guard): `await retrieveCustomer()` → `redirect("/")` for guests, then renders `TopNav` + an `AccountNav` sidebar (`<aside>`) + the page `<section>` in a responsive `max-w-5xl` main (stacked on mobile, sidebar+content row at ≥600px). New `src/components/account/AccountNav.tsx` (Account/Profile `Link`s + a `<form action={logout}>` Log out) imports the existing `logout` server action from `@lib/data/customer` (defined in FRONTEND-26 — not redefined). New `src/app/account/page.tsx` greets the customer by name ("My account" + greeting, falling back to "there"). Tokens-only (ink/mute, `gap-section`/`py-section`), no accent/gradients/shadows/`dark:`. `npx tsc --noEmit` exit 0 (authoritative gate — `next.config.js` sets `typescript.ignoreBuildErrors`; a literal `next build` is blocked only by the running `next dev` holding `.next`). Runtime behavioural proof (guard redirect, name render, logout) lands in TEST-12 / Wave-1 Task 6._
- **Objective**: A protected `/account` landing page with sign-out.
- **Requirements**: New `src/app/account/layout.tsx` (Server Component): resolve `retrieveCustomer()`, `redirect("/")` for guests, render `TopNav` + an `AccountNav` sidebar + the page. New `src/components/account/AccountNav.tsx` (Account/Profile links + logout `<form>`). New `src/app/account/page.tsx` (greeting by name). `AccountNav`'s logout `<form action={logout}>` reuses the `logout` server action defined in FRONTEND-26 (`lib/data/customer.ts`) — import it, do not redefine it. Per plan (Task 4).
- **Dependencies**: FRONTEND-25, FRONTEND-26
- **Deliverables**: `src/app/account/layout.tsx` (new), `src/app/account/page.tsx` (new), `src/components/account/AccountNav.tsx` (new)
- **Acceptance Criteria**: `/account` renders the signed-in customer's name; a guest hitting `/account` is redirected to `/`; Log out clears the session and returns home; `npm run build` clean.

### ✅ FRONTEND-28: Account profile page

- _Completed 2026-06-12 — New `src/lib/validation/phone.ts` (`CAMBODIA_PHONE_REGEX = /^(\+855|0)[1-9]\d{7,8}$/` verbatim from security.md/PRD + `isValidCambodiaPhone`, trims before testing). New `src/components/account/ProfileForm.tsx` (`"use client"`): controlled first/last-name + phone fields and a read-only (`disabled readOnly`) provider-supplied email; on submit it validates the phone with the shared regex **before** any network call (invalid → inline `role="alert"` message, no request fired), then calls the session-aware `updateCustomer` (FRONTEND-25), surfacing `saving`/`saved`/`error` states. New `src/app/account/profile/page.tsx` (Server Component under the FRONTEND-27 guarded shell) reads the customer and renders a single `<h1>Profile</h1>` + the prefilled form. One deliberate deviation from the plan's sketch (design.md wins over task wording per Workflow.md — reuse primitives, don't reinvent): inputs use the established `DeliveryForm` field surface (soft-cloud fill, pill radius, ink focus) and the Save CTA uses the `ui/PillButton` primitive instead of hand-rolled hairline inputs/`<button>`; functional behavior is exactly as specified. Tokens-only, accent unused, no dark/shadow/gradient (off-token scan clean). Verified `npx tsc --noEmit` exit 0 (authoritative gate — `next.config.js` sets `typescript.ignoreBuildErrors`; a literal `next build` is blocked only by the running `next dev` holding `.next`). Runtime behavioural proof lands in TEST-12 (Wave-1 Task 6)._
- **Objective**: Let a signed-in customer edit their name and phone.
- **Requirements**: New `src/lib/validation/phone.ts` (`CAMBODIA_PHONE_REGEX = /^(\+855|0)[1-9]\d{7,8}$/` + `isValidCambodiaPhone`, the PRD/security.md regex). New `src/components/account/ProfileForm.tsx` (`"use client"`): controlled first/last name + phone fields, read-only email (provider-supplied); validates phone with the shared regex before calling `updateCustomer`; shows saved/error states. New `src/app/account/profile/page.tsx` (reads the customer, renders `ProfileForm` prefilled). Tokens-only; pill inputs; ink button; accent unused. Per plan (Task 5).
- **Dependencies**: FRONTEND-27 (the profile save path uses the session-aware `updateCustomer` from FRONTEND-25, reached transitively through FRONTEND-27)
- **Deliverables**: `src/lib/validation/phone.ts` (new), `src/components/account/ProfileForm.tsx` (new), `src/app/account/profile/page.tsx` (new)
- **Acceptance Criteria**: `/account/profile` prefills the customer's name/phone and shows email read-only; a valid edit persists via `updateCustomer`; an invalid phone is blocked with a message before any request; `npm run build` clean.

### FRONTEND-29: Account menu — reframe signed-out popover + guest order-tracking entry

- **Objective**: Replace the bare two-link, social-only popover (it reads as a dev stub and leads with an "optional" v1 feature as the entire signed-out experience) with a framed, model-appropriate account menu, and surface **guest order-tracking** as the primary action for our passwordless, phone-first shop.
- **Rationale (research 2026-06-12, `ecc:market-research`)**: The fashion references we design against — Nike, Zara, ASOS — lead the account affordance with Sign In **plus a guest order-lookup path** (Nike tracks guests by the checkout phone number — our exact identity model), not a pair of OAuth buttons. 2025/26 login-UX guidance is explicit that social login belongs *alongside* a primary method (2–3 methods max, the rest behind "more options"), **never as the whole menu** — "social-login-only is not recommended." Today's popover (`AccountMenu.tsx:111-119`) violates both: no heading/benefit, no track-order path, and social sign-in (spec-"optional") is the entire signed-out content. Sources: nike.com/orders/details, authgear.com login-UX 2025, loginradius/corbado social-login benchmarks.
- **Requirements**: Edit **only** the signed-out branch of `src/components/layout/AccountMenu.tsx` (signed-in branch unchanged). (1) Add a short heading + one-line benefit ("Sign in for faster checkout") above the providers so the popover is framed rather than a floating two-link stub; group the provider anchors beneath it, keeping the existing `/store/auth/{provider}?intent=account` hrefs and the a11y/Escape/outside-click behavior untouched. (2) Add a **"Track your order"** entry as the FIRST item in the signed-out menu → `/track`. This sub-part is **dependency-gated on TRACK-04** (the `/track` page + live link); until TRACK-04 ships, **omit the entry — do not point it at `/`** (mirrors the footer "Track Order" rule in the TRACK phase). (3) **Google scope**: `CLAUDE.md` and FRONTEND-17/17B locked **Facebook** as the optional provider; Google was added under TEST-08B/INTEGRATION-06B and may be out of v1 scope. Do **not** remove it under this task — tracked as **CLARIFY-13** (Google-in-v1); keep both providers until it resolves. Tokens-only: ink/mute/hairline/canvas, **accent unused** (reserved for sale price + KHQR CTA), single hairline, no shadow/gradient/`dark:`. No new component and no third-party social-button library (`design.md`); reuse the existing `MENU_LINK` styling. Verify at 360px and confirm the mobile drawer Account row stays coherent.
- **Dependencies**: FRONTEND-26 (the popover being revised). The guest-tracking entry additionally depends on **TRACK-04** (v2-deferred — that sub-part lands with the TRACK phase). **CLARIFY-13** (Google-in-v1 scope) — non-blocking for the reframe.
- **Deliverables**: `storefront/src/components/layout/AccountMenu.tsx` (modified)
- **Acceptance Criteria**: Signed-out popover shows a heading + benefit line with the provider(s) grouped beneath (no longer a bare two-link stub) and no longer leads with social as its only content; "Track your order" appears as the first signed-out entry **once TRACK-04 has shipped** and is omitted (not pointed at `/`) until then; signed-in branch unchanged; both providers remain until the Google-scope `/clarify` resolves; tokens-only, accent unused, single hairline, no shadow/`dark:`; layout holds at 360px; `npx tsc --noEmit` exit 0.

---

## Phase 4 — INTEGRATION

### ✅ INTEGRATION-01: Catalog data wiring

- _Completed 2026-06-02 — `src/lib/medusa.ts` is the storefront catalog data layer: a `"use server"` module over the single configured `@lib/config` SDK, exposing `getCatalogProducts` / `getCategories` / `getCategoryProducts` / `getProductDetail`. It resolves the price region once from `/store/regions` (prefers `NEXT_PUBLIC_DEFAULT_REGION=kh` → the Cambodia/USD region, else first), reads Medusa v2 `calculated_price.calculated_amount` (major units) and formats USD via `@lib/price`'s `formatUsd`, normalizing `StoreProduct`/`StoreProductCategory` into `ProductCard`/`CategoryTabs`/`Gallery` props; products without a calculated price are skipped. Home + Category (async Server Components) and the client PDP (via the `getProductDetail` server action) now render real backend products, replacing the FRONTEND placeholder arrays. `tsc` clean; verified against the live dev backend — home renders Medusa Sweatpants/T-Shirt/Shorts/Sweatshirt at `$15.00` with SKU references, `/category/pants` renders the Pants heading + Medusa Sweatpants `$15.00`, no errors. Per-variant inventory binding (INTEGRATION-03) and cart wiring (INTEGRATION-02) intentionally left out of scope._
- **Objective**: Real products/categories on storefront.
- **Requirements**: Configure Medusa JS SDK client; fetch products + categories into Home/Category/PDP.
- **Dependencies**: FRONTEND-09, FRONTEND-10, FRONTEND-14, SETUP-10
- **Deliverables**: `src/lib/medusa.ts`
- **Acceptance Criteria**: Catalog shows real backend products with prices.

### ✅ INTEGRATION-02: Cart operations

- _Completed 2026-06-03 — `src/lib/cart.ts` is the cart-operations layer: a `"use server"` module over the single `@lib/config` SDK exposing `addToCart` / `updateLineItem` / `removeLineItem` (create on first add, line-item add/update/delete) plus `getCart` / `getCartItemCount`, with the cart id read/written only from the `HttpOnly` `_medusa_cart_id` cookie (never client-supplied) and amounts returned as numeric USD major units. Consumer wiring (beyond the single declared deliverable, to satisfy the end-to-end acceptance — mirrors how INTEGRATION-01 wired its pages): `@lib/medusa.getProductDetail` now returns real Medusa variants (real `variant_id` + Color/Size parsed generically from variant options; placeholder stock — real inventory is INTEGRATION-03); the PDP (`product/[handle]/page.tsx`) feeds the picker real variants and wires "Add to bag" → `addToCart` → a same-tab cart-changed event (`@lib/cart-events`); `useCartCount` (`@lib/hooks/use-cart-count`) drives a live `TopNav` bag count badge linking to `/cart`; the cart page (`app/cart/page.tsx`) reads/updates/removes against the real cart; `VariantPicker` hides the colour group for size-only products. `tsc` clean; verified against the live dev backend — adding the Medusa T-Shirt (M / Black, SKU SHIRT-M-BLACK) from the PDP lands in `/cart` as a real $15.00 line (subtotal $15.00 / delivery $1.50 / total $16.50). NOTE: the catalog grid → PDP link is still unwired (cards carry no `handle`/`Link`) — a separate gap, not part of this task; PDPs are reachable by direct URL._
- **Objective**: Wire add/update/remove.
- **Requirements**: Cart create/line-item add/update/delete via SDK; persist cart id.
- **Dependencies**: INTEGRATION-01, FRONTEND-15
- **Deliverables**: `src/lib/cart.ts`
- **Acceptance Criteria**: Adding from PDP updates cart count and cart page.

### ✅ INTEGRATION-03: Variant availability wiring

- _Completed 2026-06-03 — `VariantPicker` is now driven by **real per-variant inventory** from the DB. `getProductDetail` (`@lib/medusa`) requests `+variants.inventory_quantity,+variants.manage_inventory,+variants.allow_backorder` and resolves each variant's availability via `variantStock()`: a variant that doesn't manage inventory or allows backorder is `Infinity` (always purchasable, shown as "In stock" with no count), otherwise Medusa's computed `inventory_quantity` is the available count and a non-positive/absent count ⇒ `0` (sold out). The PDP passes these `variants` (each carrying real `variant_id` + `stock`) straight into `<VariantPicker>`, which renders any size with `stock <= 0` as a disabled, `line-through opacity-50` `Chip` (`aria-label="{size}, sold out"`) and never emits it as a selectable variant; the stock note reads "{n} left" / "In stock" / "Sold out" / "Select a size" accordingly. `tsc --noEmit` clean. Verified against the live dev backend: real inventory flows through (`SHIRT-M-BLACK` returns `inventory_quantity=999996` — the live reserved-adjusted count from the INTEGRATION-02 add-to-cart test — and the unmanaged `winter` variant resolves to `Infinity`), confirming the wiring reads genuine DB inventory. NOTE: all current seed variants are in stock (≥999,996 or unlimited), so a struck pill is not observable from seed data today; the sold-out rendering is verified via the confirmed non-positive→`0` mapping (a single uniform code path) plus the component's deterministic `stock <= 0` struck/disabled branch, not a seeded zero-stock product._
- **Objective**: Real stock in the picker.
- **Requirements**: Bind `VariantPicker` to inventory levels per variant.
- **Dependencies**: INTEGRATION-01, FRONTEND-13
- **Deliverables**: `src/components/product/VariantPicker.tsx` (data wiring)
- **Acceptance Criteria**: Out-of-stock variants from the DB render as struck/disabled.

### ✅ INTEGRATION-04: COD submission

- _Completed 2026-06-03 — `storefront/src/lib/checkout.ts` (`"use server"`, COD slice) places a Cash-on-Delivery order: validates contact (security.md phone regex + optional email shape), reads `cart_id` from the HttpOnly cookie only (never client-supplied), preps the cart per BACKEND-04's locked assumption (sets email + Cambodia `kh` shipping address, adds the first `/store/shipping-options` result), POSTs `/store/orders/cod`, clears the cart cookie, and returns the new order id (errors mapped to customer-safe, PII-free messages). Consumer wiring (INTEGRATION-01/02 precedent): `DeliveryForm` gained an optional **Email** field (`DeliveryDetails.email`); the checkout page's COD branch `await`s `placeCodOrder(details)` → routes to `/order/[id]?status=cod` (FRONTEND-19 COD variant), with an `isPlacing` state + inline `role="alert"` error. Three open contract points were resolved with the user before coding: cart prep is in scope; email is an optional form field with a `<phone-digits>@guest.alistore.com` blank fallback; shipping method = first available option. Unblocked the BACKEND-06 shipping-seed gap with `backend/src/scripts/seed-shipping.ts` (idempotent: stock-location↔manual provider + sales-channel link, default shipping profile with all products linked, a `kh` fulfillment set/service zone, and a flat **$1.50** Cambodia shipping option) — run against the dev DB. Verified live end-to-end: `tsc --noEmit` clean; a `kh` cart now returns **1** shipping option (was 0); `POST /store/orders/cod` returns `status: pending_confirmation` + order id + invoice token. NOTE: the free-over-$50 / env-driven `DELIVERY_FEE` wiring and the checkout-page placeholder summary remain separate follow-ups; `seed-shipping.ts` must be re-run after any fresh DB reset (it belongs to SETUP)._
- **Objective**: Connect checkout to BACKEND-04.
- **Requirements**: COD path POSTs `/store/orders/cod`; on success route to confirmation (COD variant).
- **Dependencies**: FRONTEND-16, BACKEND-04, FRONTEND-19
- **Deliverables**: `src/lib/checkout.ts` (cod)
- **Acceptance Criteria**: Submitting COD creates a `pending_confirmation` order and lands on the COD confirmation.

### ✅ INTEGRATION-05: KHQR submission + polling

- **Completed 2026-06-06** — `src/lib/checkout.ts` khqr slice: `startKhqr` (→ `POST /khqr/start`, cart id from HttpOnly cookie only, INTEGRATION-08 currency cookie threaded) and `pollKhqrStatus` (→ `GET /khqr/status`, server-reported status verbatim, clears the cart cookie on `paid`) drive the FRONTEND-18 pay screen (live QR + 3s poll → `router.push('/order/<id>')`). Completion-blocking gap found and fixed under TEST-04 (user-approved): the checkout page's KHQR branch never prepped the cart, so a verified payment could never complete — `prepareKhqrCheckout` now reuses the COD validation/prep (email + Cambodia address with phone + shipping method) before routing to `/checkout/khqr`. Acceptance observed live via TEST-04's full-chain spec: pay screen pending ("Waiting for payment…") → simulated sandbox payment via the mock-proxy seam → UI auto-redirects to the paid confirmation ("Payment confirmed"). Known LOW leftovers (recorded in TEST-04's note): the paid redirect drops `invoice_token` (no invoice link on the paid confirmation) and the optional note isn't persisted for KHQR orders.
- **Objective**: Connect checkout to BACKEND-03/03B.
- **Requirements**: KHQR path calls `/khqr/start`, renders pay screen, polls `/khqr/status`; on `paid` route to paid confirmation.
- **Dependencies**: FRONTEND-18, BACKEND-03, BACKEND-03B, FRONTEND-19
- **Deliverables**: `src/lib/checkout.ts` (khqr)
- **Acceptance Criteria**: Sandbox payment moves the UI from pending → paid confirmation.

### ✅ INTEGRATION-06: Facebook login wiring

- **Completed 2026-06-03** — End-to-end Facebook social login wired via the "Rewrite + session" approach (user-confirmed). New `storefront/src/lib/auth.ts` exposes `getSocialLoginPrefillName()` (server action: forwards the post-login HttpOnly `connect.sid` session — and any `_medusa_jwt` — to `/store/customers/me` and returns the display name; provider-agnostic so INTEGRATION-06B reuses it). New `storefront/src/middleware.ts` proxies `/store/auth/*` to the Medusa backend on the storefront origin injecting the public `x-publishable-api-key` (required: Medusa gates the whole `/store` namespace behind that header, which a browser nav can't send — verified 400→handler). Backend FB callback (`backend/src/api/store/auth/facebook/callback/route.ts`) now ends in a hard-coded relative `302 → /checkout` instead of JSON (security.md: no open redirect). Consumer wiring (INTEGRATION-01/02/04 precedent): `FacebookLogin` reads via `getSocialLoginPrefillName()`; the checkout page mounts it and drops the name into `fullName`. Verified: storefront `tsc` clean; live probe through the running stack returned `x-middleware-rewrite → :9000` + `503 facebook_login_unavailable` (NOT the pub-key `400`), proving the middleware defeats the gate and reaches the OAuth handler (503 only because `FB_APP_ID`/`FB_APP_SECRET` are empty in dev). **Config requirement:** `FB_OAUTH_REDIRECT_URI` must point at the storefront origin's callback (`http://localhost:8000/store/auth/facebook/callback` in dev; prod equivalent registered in the FB app) so the state/session cookies stay same-origin. **Not runtime-proven:** the full Facebook consent round-trip needs real FB creds + a consenting user (same caveat as BACKEND-05B).
- **Objective**: End-to-end social login.
- **Requirements**: Wire button → BACKEND-05/05B → session → prefilled form.
- **Dependencies**: FRONTEND-17, BACKEND-05B
- **Deliverables**: `src/lib/auth.ts`
- **Acceptance Criteria**: Completing FB login returns to checkout with the name prefilled.

### ✅ INTEGRATION-06B: Google login wiring

- **Completed 2026-06-03** — End-to-end Google social login wired as the exact parallel of INTEGRATION-06 (Facebook). `GoogleLogin` (FRONTEND-17B) now reads the post-login session via the shared, provider-agnostic `getSocialLoginPrefillName()` (`@lib/auth`) instead of the starter's JWT-only `retrieveCustomer()` — the "reuse, do not fork" requirement — so it resolves the `connect.sid` session BACKEND-05D establishes (no `_medusa_jwt` is issued). The checkout page mounts `GoogleLogin` beside `FacebookLogin`, binding its `onPrefillName` to the same handler (drops the name into Full Name). The Google callback (`backend/src/api/store/auth/google/callback/route.ts`) now ends in a hard-coded relative `302 → /checkout` instead of JSON `{customer}` (mirroring INTEGRATION-06's change to the FB callback; security.md: no open redirect) so the browser navigation actually returns to checkout. The existing `/store/auth/*` middleware proxy (INTEGRATION-06) already covers Google via its `:path*` matcher. Verified: storefront `tsc` clean; backend `tsc` clean for the edited route (only pre-existing, unrelated `seed-shipping.ts` errors remain). **Not runtime-proven** (same caveat as BACKEND-05D / INTEGRATION-06): the full Google consent round-trip needs real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` + a consenting user — the wiring is structurally identical to the Facebook path INTEGRATION-06 live-probed.
- **Objective**: End-to-end Google social login (parallel to INTEGRATION-06, Facebook).
- **Requirements**: Wire button → BACKEND-05C/05D → session → prefilled form. Reuse `src/lib/auth.ts` (extend, do not fork) so Facebook and Google share the post-login session/prefill handling.
- **Dependencies**: FRONTEND-17B, BACKEND-05D
- **Deliverables**: `src/lib/auth.ts`
- **Acceptance Criteria**: Completing Google login returns to checkout with the name prefilled.

### ✅ INTEGRATION-07: Invoice link wiring

- **Completed 2026-06-03** — The order-confirmation invoice link now carries the per-order invoice token, via two user-chosen mechanisms. (1) **Token transport (`?token=`)**: `placeCodOrder` (`storefront/src/lib/checkout.ts`) returns BACKEND-04's `invoice_token`, the checkout page's COD branch appends it to the redirect (`/order/[id]?status=cod&token=…`, built with `URLSearchParams`), and `order/[id]/page.tsx` reads `searchParams.token` to build `/store/orders/:id/invoice?token=<encoded>` — omitting the link entirely when no token is present (a tokenless request can only 403). The token is only ever forwarded, never minted client-side. (2) **Link transport (middleware)**: `storefront/src/middleware.ts`'s matcher widened from `/store/auth/:path*` to also proxy `/store/orders/:id/invoice`, reusing the same publishable-key injection so the same-origin `<a>` GET clears Medusa's `/store` key gate; the route stays self-guarded by the per-order token (no unauthenticated order access). KHQR's equivalent `?token=` redirect is deferred to INTEGRATION-05 (not yet built). Verified: storefront `tsc --noEmit` clean (exit 0, 0 errors). Live three-probe proof against the running backend — (a) backend direct **no key** → `400 Publishable API key required` (gate is real); (b) backend direct **with key** → `404 order_not_found` (BACKEND-06 handler reached, `?token=` accepted); (c) **through the :8000 proxy sending no key** → `404 order_not_found`, byte-identical to (b) — proving the new matcher caught the invoice path, injected the key, and forwarded `?token=` to the token-gated handler. The `403-on-wrong-token` is that same handler BACKEND-06 already live-verified; probe (c) proves the proxy delivers the token to it (order existence is checked before the token, so a fake order yields 404 and a real order + wrong token yields 403). A fully completed order to observe a literal 200/403 through the proxy was not generated this session (the known dev shipping-seed boundary), but every step of the wiring is runtime-proven.
- **Objective**: Open invoice from confirmation.
- **Requirements**: Link confirmation to `/store/orders/:id/invoice` with order token.
- **Dependencies**: FRONTEND-19, BACKEND-06
- **Deliverables**: `src/app/order/[id]/page.tsx` (link)
- **Acceptance Criteria**: Invoice opens for that order; 403 for a wrong token.

### ✅ INTEGRATION-08: Currency end-to-end

- **Completed 2026-06-04** — The nav toggle's currency now drives the KHQR denomination, via the user-chosen **preference-cookie transport**: `TopNav` (FRONTEND-04) persists the toggle choice in a plain `ali_currency` cookie (1-year, `Path=/`, `SameSite=Lax`, `Secure` on https; deliberately non-HttpOnly — a UI preference, not a credential) and restores it after mount (post-hydration `useEffect`, SSR-safe), so the selection survives navigation instead of resetting per page. `startKhqr` (`storefront/src/lib/checkout.ts`) replaces the hardcoded `"USD"` with `getSelectedCurrency()` — reads the cookie server-side via `next/headers`, validates against the BACKEND-03 zod enum (`USD|KHR`), falls back to USD on absent/tampered values — and passes it as `currency` to `POST /store/payments/khqr/start`. No backend change needed: BACKEND-03 already converts server-side (`usdToKhr`, whole riel); the client never supplies an amount, so the cookie can only pick between the two supported denominations. `Currency` type now imported from `@lib/price` in both files (single source of truth, review finding). Verified: `tsc --noEmit` clean; live backend probe decoded the EMV QR — KHR cart → tag 53 `116`/tag 54 `61500` = round($15 × `USD_KHR_RATE` 4100), whole riel; USD cart → `840`/`15`; full real-browser E2E against the running stack (headless Chromium): KHR chip click → cookie set → toggle restored after nav → add-to-bag → `/checkout/khqr` rendered a live QR via the server action → re-calling `/start` for that cart *requesting USD* returned the reused session as KHR 61,500, proving the cookie's KHR flowed through `startKhqr`. Known cosmetic LOW: one-frame USD flash before the cookie-restore effect (eliminating it needs a Server-Component-passed initial value — out of scope).
- **Objective**: Selected currency drives KHQR amount.
- **Requirements**: Pass toggle currency through checkout into `/khqr/start`; verify amount matches converted value.
- **Dependencies**: FRONTEND-22, INTEGRATION-05
- **Deliverables**: `src/lib/checkout.ts` (currency)
- **Acceptance Criteria**: KHR checkout generates a KHQR for the correct whole-riel amount.

### ✅ INTEGRATION-09: Image delivery

- **Completed 2026-06-04** — `img.alistore.com` (CLARIFY-08's locked value; provisional per CLARIFY-08-REOPEN) added to `storefront/next.config.js` `images.remotePatterns` alongside the SETUP-05 R2 dev host (`pub-…r2.dev`), which stays for dev. No component changes were needed: audit confirmed every image consumer already meets the `next/image` + `sizes` + lazy-load requirements — `ProductCard` (`fill` + grid-matched `sizes`, lazy), `Gallery` (main image `sizes` + `priority` as the PDP LCP element; `64px` lazy thumbnails), cart line rows (lazy + `sizes`); zero `<img>` tags in `storefront/src`. Runtime-proven against the live dev server: a real R2-hosted product image ("winter") through `/_next/image` → 200 as `image/webp` with responsive resize (88 B @ w=64 vs 1,962 B @ w=640); an `img.alistore.com` URL → 500 (DNS fetch fail — host unrouted until SETUP-11), *not* `400 "url" parameter is not allowed`, proving the allowlist entry is active; negative control `evil.example.com` → 400 not-allowed. Caveat: literal delivery *from* `img.alistore.com` is DNS-gated on SETUP-11 (domain purchase + Cloudflare records) — nothing further owed from the storefront side; if the purchased domain differs, the hostname swap belongs to SETUP-11.
- **Objective**: Fast images via R2/CDN.
- **Requirements**: Add `img.<domain>` to `next.config` `images.remotePatterns`; use `next/image` with sizes; lazy-load.
- **Dependencies**: SETUP-05, SETUP-11, FRONTEND-05
- **Deliverables**: `next.config.js`
- **Acceptance Criteria**: Product images load from `img.<domain>` as optimized responsive images.

### ✅ INTEGRATION-10: Telegram alert end-to-end

- **Completed 2026-06-12** — user-confirmed live UAT observation: a real test order produced a Telegram message in the operator's private chat with the configured fields (order #, line items + qty, total USD + ≈KHR, payment method, customer name, phone, address, note). Real `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` now set in `backend/.env`, so the BACKEND-09 `order.placed` subscriber (`backend/src/subscribers/order-placed.ts`) sends instead of no-op'ing; it fires for both COD (BACKEND-04) and KHQR (BACKEND-03B) via `completeCartWorkflow`. Supersedes the earlier UAT deferral noted in TEST-03 (which had no dev send seam while secrets were empty).
- **Objective**: Verify the notification path.
- **Requirements**: Place a real test order → confirm subscriber posts to Telegram.
- **Dependencies**: BACKEND-09, INTEGRATION-04
- **Deliverables**: (verification; no new file)
- **Acceptance Criteria**: A test order produces a Telegram message with the configured fields.

---

## Phase 5 — TEST

### ✅ TEST-01: Catalog & PDP render

- **Completed 2026-06-06** — `storefront/tests/catalog.spec.ts` (8 tests) + `storefront/playwright.config.ts`; all pass against the live dev stack with `dev-seed-catalog-fixtures.ts` applied: grid 1/2/3/4-up at 360/768/1100/1440px, sale card struck mute original + accent coral sale price, sold-out XL chip struck & disabled, in-stock size selectable with stock note.
- **Objective**: Verify browse + variant states.
- **Requirements**: Check grid reflow, sale-price treatment, variant stock states.
- **Dependencies**: INTEGRATION-03
- **Deliverables**: `tests/catalog.spec.ts`
- **Acceptance Criteria**: Grid columns change per breakpoint; struck sold-out size confirmed.

### ✅ TEST-02: Cart math

- **Completed 2026-06-06** — `storefront/tests/cart.spec.ts` (4 tests), all passing against the live dev stack with the TEST-01 fixtures: subtotal for single ($15.00) and mixed full+sale lines ($22.00→$50.00→$57.00 via PDP adds + cart stepper), flat $1.50 delivery below threshold, "Free" at exactly $50.00 and above; KHR rounding asserted at the FRONTEND-22 formatter (whole riel, `៛`-prefixed, no decimals — no UI surface renders KHR strings; the KHQR EMV amount is TEST-04's scope).
- **Objective**: Verify totals + delivery logic.
- **Requirements**: Assert subtotal, delivery fee, free-over-threshold, KHR rounding.
- **Dependencies**: INTEGRATION-02, FRONTEND-22
- **Deliverables**: `tests/cart.spec.ts`
- **Acceptance Criteria**: Below threshold adds fee; at/above shows free; KHR integer.

### ✅ TEST-03: COD end-to-end

- **Completed 2026-06-11** — `storefront/tests/cod.spec.ts`: UI journey (pending_confirmation + stock decrement) + API contract test; Telegram alert deferred to UAT per user decision (security.md hard-codes Bot API host, no mockable dev seam; UAT procedure documented in spec).
- **Objective**: Verify COD path.
- **Requirements**: Place COD → order `pending_confirmation` + Telegram alert + stock reserved.
- **Dependencies**: INTEGRATION-04, INTEGRATION-10
- **Deliverables**: `tests/cod.spec.ts`
- **Acceptance Criteria**: All three effects observed.

### ✅ TEST-04: KHQR end-to-end (sandbox)

- **Completed 2026-06-06** — `storefront/tests/khqr.spec.ts` (2 tests, serial), full chain green against the live dev stack: start contract (EMVCo QR, `reference = md5(qr)`, ~20-min expiry, status `pending` before pay) + the full UI chain (PDP → checkout → pay screen → simulated pay → "Payment confirmed" redirect → status `paid` + invoice 200 → DB evidence via `dev-verify-khqr-order.ts`: payment `captured_at` set, exactly one `stock_movement(out)` qty 1 `created_by=system`). "Simulate pay" = user-approved seam: the spec hosts a mock Bakong proxy on `127.0.0.1:4280` and `bakong-payment/lib/proxy.ts` gained a loopback-only SSRF escape dual-gated on `NODE_ENV≠production` + `BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1` (dev `.env` block documented in `.env.template`; prod behavior unchanged), so the REAL verify → `authorizePayment` → `completeCartWorkflow` → stock-out path runs unmodified. Also fixed (user-approved, INTEGRATION-05 completion work): the KHQR checkout branch never prepped the cart (email/address/method), so a verified payment could never complete into an order — `prepareKhqrCheckout` (checkout.ts) now reuses the COD prep, and the shipping address carries the phone. Full suite after: 16 passed / 1 skipped (Telegram UAT fixme). Open findings: KHQR paid redirect drops `invoice_token` (no invoice link on paid confirmation — INTEGRATION-07 deferral); KHQR orders don't persist the optional note; `order.payment_status` is undefined via raw `query.graph` (BACKEND-08's paid-qualification leg — relevant to TEST-06); khqr endpoints 502 in dev while the mock env block is set but the mock isn't running.
- **Objective**: Verify online payment path.
- **Requirements**: start → simulate pay → status `paid` → order `paid` → one `stock_movement(out)`.
- **Dependencies**: INTEGRATION-05
- **Deliverables**: `tests/khqr.spec.ts`
- **Acceptance Criteria**: Full chain passes against sandbox.

### ✅ TEST-05: Stock-in flow

- **Completed 2026-06-06** — `storefront/tests/stock-in.spec.ts` (1 test), green solo and in the full parallel suite (17 passed / 1 skipped, the Telegram UAT fixme): admin stock-in of +7 on shorts L → level +7 observed three ways (endpoint response, independent `GET /admin/reports/stock`, DB read), exactly ONE `stock_movement(in)` row proven from the DB via the new read-only helper `backend/src/scripts/dev-verify-stock-in.ts` (unique per-run reason marker), and the PDP "N left" note rises by exactly +7; the level is restored afterwards with a compensating `out` movement (ledger keeps both rows) so the suite stays parallel-safe. Admin auth (user-approved): dev has no MFA (SETUP-01C deferred), so the spec creates a throwaway admin per run (`npx medusa user`, random hex creds, hard `[a-f0-9]` shell guards) and logs in via `POST /auth/user/emailpass` → Bearer JWT — reuse this pattern for TEST-06; each run leaves one inert `test-admin-<hex>@alistore.dev` row in the dev DB. This closes BACKEND-07's deferred authenticated "+N + one row" observation.
- **Objective**: Verify receiving + availability.
- **Requirements**: Admin stock-in → level rises, `in` movement recorded, storefront availability updates.
- **Dependencies**: BACKEND-07, INTEGRATION-03
- **Deliverables**: `tests/stock-in.spec.ts`
- **Acceptance Criteria**: Level +N, one `in` row, PDP reflects new stock.

### ✅ TEST-06: Reports

- **Completed 2026-06-06** — `storefront/tests/reports.spec.ts` (2 tests, serial, shared TEST-05-pattern throwaway admin), green solo and in the full parallel suite (19 passed / 1 skipped, the Telegram UAT fixme): **sales** — two seeded COD orders with known totals (1× sweatshirt S = $16.50, 2× sweatshirt L = $31.50) asserted over the exact `from/to` window: order count + per-currency revenue (`usd: 48.00` quiet-window) + best-sellers (L×2 ranked above S×1); count/revenue equality is interference-proof via independent enumeration through core `GET /admin/orders` over the same window. **stock** — seeded known level (sweatshirt XL `adjust`→3, restored in finally) in `low_stock[]` at threshold 5 with the fixture-zeroed sweatpants XL (0), full `low_stock = levels.filter(q ≤ threshold)` equivalence, exact `<=` boundary (in at 3, out at 2). **Caught + fixed a real BACKEND-08 bug (user-approved)**: the report returned shipping-only revenue ($1.50/order) and empty `top_variants` — `query.graph` order `total` needs `summary` in the field list, and line quantity only resolves via `items.detail.quantity` (`reports/sales/route.ts` ORDER_FIELDS + aggregation fixed; the BACKEND-03 cart-total gotcha's order-entity sibling). COD placements are spaced >60s so cod.spec's unretryable UI checkout never loses the shared 3/min/IP bucket (verified live: unspaced run 429'd it), plus 429-retry for back-to-back runs. Side effects per run: one inert `test-admin-*` user, two pending COD orders + reservations, two `adjust` ledger rows. Open notes: `payment_status` still unresolvable via raw query.graph (qualification unaffected — nothing cancels orders); cart.spec flaked once under parallel load (stepper update >5s, passed on re-run); two pre-existing tsc errors in `seed-shipping.ts` (untouched).
- **Objective**: Verify sales + stock reports.
- **Requirements**: Seed known orders/levels; assert sales totals and low-stock list.
- **Dependencies**: BACKEND-08, BACKEND-08B, TEST-04
- **Deliverables**: `tests/reports.spec.ts`
- **Acceptance Criteria**: Revenue/order counts and low-stock membership match expectations.

### ✅ TEST-07: Invoice

- **Completed 2026-06-06** — `storefront/tests/invoice.spec.ts` (2 tests, serial), green solo and in the full parallel suite (21 passed / 1 skipped, the Telegram UAT fixme): the invoice is fetched through the real user path (storefront `:8000` proxy, NO publishable key attached — proving INTEGRATION-07's middleware injects it) and asserted two ways. **Valid HTML** — 200 `text/html` + `no-store` + `nosniff`, full `<!DOCTYPE html>` document, browser-parsed DOM structure (title `Invoice #N`, issuer header, items table, Subtotal/Delivery/Total footer) with every value cross-checked against an independent admin-API read of the same order (plus a ground-truth guard: admin quantities must be >0 so a graph regression can't cross-cancel into a false pass). **No VAT line with VAT off** — `INVOICE_VAT_ENABLED`-off precondition asserted from `backend/.env`, then absence at three levels: source (no `VAT (`/`class="tin"` markers), DOM (footer EXACTLY Subtotal/Delivery/Total, no visible VAT/TIN text), math (Total = subtotal + delivery to the cent). Harness: deliberately places NO order — the COD 3/min/IP budget is exactly full in parallel runs (cod ×2 unretryable + reports ×1) — instead reuses the TEST-05 throwaway-admin pattern to read the newest order with a valid `metadata.invoice_token` (brief poll on a fresh DB); read-only, side effect one inert `test-admin-*` row. **Caught + fixed a real BACKEND-06 bug (user-approved)**: every customer invoice rendered qty 0 / $0.00 lines and a shipping-only total — the third hit of the query.graph computed-fields gotcha (after BACKEND-03 cart and TEST-06→BACKEND-08 sales); `invoice/route.ts` ORDER_FIELDS gained `summary` + `items.detail.quantity`, quantity read via `item.detail?.quantity ?? item.quantity`. This retro-explains BACKEND-06's "item_total was genuinely 0 in the DB" note — it was this gotcha, not the data. Reviews: code APPROVE (the one MEDIUM, the >0 guard, applied), security Approve (note for CI later: Playwright traces contain the invoice-token URL — scrub before any artifact upload).
- **Objective**: Verify invoice output.
- **Requirements**: Render invoice; confirm VAT line hidden when disabled.
- **Dependencies**: INTEGRATION-07
- **Deliverables**: `tests/invoice.spec.ts`
- **Acceptance Criteria**: Valid HTML; no VAT line with VAT off.

### ✅ TEST-08: Facebook login

- **Completed 2026-06-06** — `storefront/tests/fb-login.spec.ts` (2 tests, serial), green solo and in the full parallel suite (23 passed / 1 skipped, the Telegram UAT fixme): **completed login** — full OAuth round-trip through the real user path (storefront `:8000` `/store/auth/*` proxy with NO publishable key attached — proving INTEGRATION-06's injection): dialog 302 asserted (configured client_id, allowlisted redirect_uri, `email,public_profile` scopes only), `_fb_oauth_state` cookie + Redis verified by the REAL callback chain, customer created from the profile, checkout Full Name prefill live, EXACTLY ONE `customer_social_identity` row (read-only `backend/src/scripts/dev-verify-fb-login.ts` medusa-exec helper, TEST-04/05 precedent), session proof via `connect.sid` → `/store/customers/me` 200. **Returning login** — fresh cookie jar, same FB user → SAME customer, still exactly one identity row (matched by immutable provider_user_id, never email). **Seam (user-approved 2026-06-06)**: dev has no real FB app, so the spec hosts a mock Graph API on `127.0.0.1:4281` (token exchange + `/me`, rejecting any but the exact configured creds) reached via a loopback-only, `NODE_ENV=production`-inert `FB_GRAPH_DEV_BASE_URL` escape in the vendored provider (mirrors the TEST-04 Bakong seam); only Facebook's consent screen is replaced — the real consent round-trip against a live FB app remains a UAT item. Ride-along hardening in `auth-facebook/service.ts`: access token moved from URL param to `Authorization: Bearer` header (never loggable in URLs) + `redirect: "manual"` on both Graph fetches; `backend/.env.template` documents `FB_OAUTH_REDIRECT_URI` + the dev-only `FB_GRAPH_DEV_BASE_URL`. Side effects per run: one customer + auth identity + identity row keyed to a synthetic `fbe2e<hex>` id (inert, identifiable for cleanup). Note: while the dev-mock FB env block is set, "Continue with Facebook" 302s to a real FB dialog that rejects the mock client_id — blank FB creds to restore the 503 `facebook_login_unavailable` behavior.
- **Objective**: Verify social login.
- **Requirements**: Complete FB login (test app) → customer + `customer_social_identity` row.
- **Dependencies**: INTEGRATION-06
- **Deliverables**: `tests/fb-login.spec.ts`
- **Acceptance Criteria**: One identity row created; session returned.

### ✅ TEST-08B: Google login

- **Completed 2026-06-06** — `storefront/tests/google-login.spec.ts` (2 tests, serial), green solo and in the full parallel suite (25 passed / 1 skipped, the Telegram UAT fixme): **completed login** — full OAuth round-trip through the real user path (storefront `:8000` `/store/auth/*` proxy with NO publishable key attached — proving INTEGRATION-06's injection covers Google): dialog 302 asserted (mock client_id, allowlisted redirect_uri on the :8000 origin, `email profile openid` scopes only, `response_type=code`), `_google_oauth_state` cookie + Redis verified by the REAL callback chain (BACKEND-05D approach (b) — state/CSRF single-use, code exchange, id_token claims verify `aud`/`iss`/`exp`/`email_verified`), customer created from the token's profile claims, checkout Full Name prefill live (INTEGRATION-06B), EXACTLY ONE `customer_social_identity` row `provider=google` (read-only `backend/src/scripts/dev-verify-google-login.ts` medusa-exec helper, sibling of the TEST-08 one per user decision), session proof via `connect.sid` → `/store/customers/me` 200. **Returning login** — fresh cookie jar, same Google subject → SAME customer, still exactly one identity row (matched by immutable provider_user_id, never email). **Seam (user-approved 2026-06-06)**: dev has no real Google OAuth client and the callback exchanges the code server-side, so the spec hosts a mock token endpoint on `127.0.0.1:4282` (`POST /token`, rejecting any but the exact configured client id/secret/redirect_uri/code/grant_type) and MINTS the id_token itself (claims-only `jwt.decode` verification — the OIDC §3.1.3.7 posture — so a filler signature works), reached via a loopback-only, `NODE_ENV=production`-inert `GOOGLE_TOKEN_DEV_BASE_URL` escape added to `google/callback/route.ts` (`devTokenUrl()`, mirrors the TEST-08 `FB_GRAPH_DEV_BASE_URL` seam); only Google's consent screen is replaced — the real consent round-trip against a live Google client remains a UAT item. `backend/.env` carries the dev-mock Google block; `backend/.env.template` documents the dev-only var. Reviews: code APPROVE (its one MEDIUM — `execSync` "missing shell:true" — is a non-finding: execSync always shells; the `/^[a-z0-9]+$/` guard is the control), security APPROVE-WITH-NOTES (both pre-existing from TEST-07: `test-results/` gitignore entry + trace scrubbing before any future CI artifact upload). Side effects per run: one customer + auth identity + identity row keyed to a synthetic `ge2e<hex>` subject (inert, identifiable for cleanup). Note: while the dev-mock Google env block is set, "Continue with Google" 302s to a real Google dialog that rejects the mock client_id — blank the creds to restore the 503 `google_login_unavailable` behavior.
- **Objective**: Verify Google social login (parallel to TEST-08, Facebook).
- **Requirements**: Complete Google login (test OAuth client) → customer + `customer_social_identity` row (`provider=google`).
- **Dependencies**: INTEGRATION-06B
- **Deliverables**: `tests/google-login.spec.ts`
- **Acceptance Criteria**: One identity row created (`provider=google`); session returned.

### ✅ TEST-09: Responsive & in-app browser

- _Completed 2026-06-11 — `storefront/tests/responsive.md` (200-line manual UAT checklist): Track A covers viewport reflow at 360/768/1440 grounded in the exact breakpoints from the real components (`TopNav` hamburger ≤599, `BottomBar` hidden ≥600, `ProductGrid` 1→2→3→4-up at 600/1024/1440, `FilterSidebar` drawer <1024 / rail ≥1024, `Checkout` stacked <1024 / two-column ≥1024); expected layout table disambiguates the three test widths (768 = desktop nav + drawer filter + 2-up grid, all independent). Track B covers Facebook and Telegram in-app browsers (nav collapse, filter drawer, `BottomBar` reachability, KHQR polling → paid redirect, Facebook OAuth top-level redirect, Google OAuth external-browser fallback). Four known constraints documented: C1 Google WebView block + external-browser workaround; C2 KHQR deeplink IAB limitation + QR-scan primary path; C3 timer throttling on backgrounded IAB; C4 `BottomBar` normal-flow design. Track A is runnable now against `npm run dev`; grid reflow already green in `catalog.spec.ts`. Track B is a go-live UAT gate — requires deployed HTTPS storefront + real devices + Facebook/Telegram apps — same deferred posture as INTEGRATION-10 (Telegram live send) and TEST-10 (runtime a11y layer). No code touched (checklist-only task)._
- **Objective**: Verify mobile-first behavior.
- **Requirements**: Test at 360/768/1440 and inside Facebook/Telegram in-app browsers (nav collapse, filter drawer, polling, OAuth redirect).
- **Dependencies**: INTEGRATION-05, INTEGRATION-06
- **Deliverables**: `tests/responsive.md` (checklist)
- **Acceptance Criteria**: All pass in in-app browsers; no broken OAuth/polling.

### ✅ TEST-10: Accessibility

- **Completed 2026-06-09** — `storefront/tests/a11y.md` (204-line checklist, sibling of TEST-09's `responsive.md`): a **static-verification + manual-UAT** a11y checklist grounded in the real components. **Touch targets ≥44px** — every primary control enumerated to its implemented size from source (`h-12`=48px: `PillButton`, `SearchPill`, `DeliveryForm` inputs, `BuyBox` KHQR CTA; `h-11`=44px: `Chip`, `TopNav`/`FilterSidebar`/cart `ICON_BUTTON`+`STEPPER_BUTTON`, `VariantPicker` 44×44 swatch hit-area; payment radio rows = `p-4` label box); smallest primary target is exactly 44px. **Contrast on coral/ink** — WCAG ratios computed from the exact `tailwind.config.js` token hexes: `ink` 18.9:1 (canvas)/17.3:1 (soft-cloud), **`accent` coral 5.08:1 (canvas)/4.66:1 (soft-cloud)** both clearing AA, plus `mute` 4.94/4.53 and `success` 5.22; confirmed coral appears only in its two sanctioned uses (sale price + "Pay with KHQR"). **Labeled inputs** — documented the `<label htmlFor>`↔`id` pairs in `DeliveryForm` (name/phone/email/address/note, phone with `aria-required`/`aria-invalid`/`aria-describedby`), the `<fieldset>/<legend>` payment radio group, icon `aria-label`s, `aria-live`/`role="alert"` regions, and `<header>/<nav>/<main>/<footer>` landmarks. **Khmer (rule-driven resolution)** — recorded **N/A for v1**: the task wording ("Khmer rendering/legible") conflicts with the locked CLARIFY-02 English-only decision + `design.md`, and the codebase already reflects it (`fonts.ts` Latin-only subset, `<html lang="en">`), so per Workflow.md ("the rule wins") it's marked N/A with a v2 activation row rather than inventing Khmer support. 5 honest notes (N1–N5): inline-link <44px exception (WCAG 2.5.5/2.5.8), marginal `mute`-on-soft-cloud 4.53:1, low-contrast field fill covered by the 2px ink focus border, `SearchPill` caller-supplied label, and no `Esc`/focus-trap on drawers (flagged as out-of-scope keyboard-a11y follow-up). The runtime layer (on-device tap, axe/Lighthouse, screen-reader/keyboard) is left as a manual UAT gate — not executed from this environment, stated plainly in the doc. No code touched (checklist-only task).
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

### TEST-12: Account area E2E

- **Objective**: Prove the account flow end-to-end against the real dev stack.
- **Requirements**: New `storefront/tests/account.spec.ts` (Playwright), built on the `google-login.spec.ts` (TEST-08B) dev-mock seam — reuse its mock token server + helpers verbatim, drive the OAuth start with `?intent=account`, and assert the post-callback landing is `/account`. Tests: (1) signed-out icon popover shows both providers (the Google href carries `intent=account`); (2) a guest hitting `/account` redirects to `/`; (3) a completed login lands on `/account`, the home greets by name, and `/account/profile` prefills name + email (confirm `createCustomerAccountWorkflow` populates `first_name` from the full Google `name` claim rather than splitting it into first/last — if it splits, assert against the split form); (4) Log out clears the session (the menu shows providers again; `/account` re-guards). Serial; shares the `:4282` Google seam, so run targeted (`npx playwright test account.spec.ts`), not concurrently with `google-login.spec.ts`. Per plan `docs/superpowers/plans/2026-06-11-customer-accounts-wave1.md` (Task 6).
- **Dependencies**: FRONTEND-25, FRONTEND-26, FRONTEND-27, FRONTEND-28, BACKEND-11, TEST-08B
- **Deliverables**: `storefront/tests/account.spec.ts` (new)
- **Acceptance Criteria**: `npx playwright test account.spec.ts` passes all four tests against the running dev stack with the Google dev-mock seam active.

---

## Phase 6 — PAYWAY (ABA PayWay replaces Bakong as KHQR provider)

> Source: `docs/aba-payway-integration-guide.md` (API contract §3, gap analysis §4, blueprint §5) + verified sandbox harness `sandbox/aba-payway/`. Locked: PayWay **replaces** Bakong behind the existing "Pay with KHQR" button; v1 is **KHQR-only** (`abapay_khqr_deeplink`). Customer UX (QR + deeplink + 3s poll) unchanged. `paid` only ever from backend `check-transaction-2` (`payment_status_code === 0`). PayWay needs **no local/proxy server** — public HTTPS API called directly from the backend; pushback is a route on the existing backend, not a new server.

### ✅ PAYWAY-01: Shared groundwork (proxy-guard extraction + env scaffolding)

- _Completed 2026-06-10 — Generic SSRF guard extracted to `backend/src/lib/proxy-guard.ts` (`assertSafeOutboundUrl`/`assertResolvesPublicAddress`/`UnsafeOutboundUrlError`, parameterized env label + caller-computed dev-loopback flag); `bakong-payment/lib/proxy.ts` now delegates while keeping its exported API and `UnsafeProxyUrlError` identity (its consumers — medusa-config boot check, both khqr routes' instanceof checks — untouched). PayWay env scaffolding: `PAYWAY_BASE_URL`/`PAYWAY_MERCHANT_ID`/`PAYWAY_API_KEY`/`PAYWAY_EXPIRES_MINUTES`/`PAYWAY_PUSHBACK_URL`/`PAYWAY_DEV_ALLOW_LOOPBACK`, boot-time `assertSafePayWayUrl` in `medusa-config.ts` against the hard-coded allowlist (checkout/checkout-sandbox.payway.com.kh). `backend/.env.example` created documenting every backend env var (gap G6). Verified: backend tsc green; khqr.spec contract + cod.spec still pass (regression run under PAYWAY-07)._
- **Objective**: Make SSRF guards shareable and scaffold PayWay env config before any PayWay code exists.
- **Requirements**: Extract `isPrivateAddress`/`assertSafeProxyUrl`/`assertResolvesPublic` + error types from `bakong-payment/lib/proxy.ts` into `backend/src/lib/proxy-guard.ts`; Bakong module re-imports (behavior-preserving — `npm run build` + existing KHQR spec must stay green). New env vars: `PAYWAY_BASE_URL`, `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY`, `PAYWAY_DEV_ALLOW_LOOPBACK`; hard-coded host allowlist `checkout.payway.com.kh` + `checkout-sandbox.payway.com.kh`; boot-time URL validation in `medusa-config.ts` (fail fast, same pattern as `BAKONG_PROXY_URL`). Create `backend/.env.example` documenting all backend env vars (closes gap G6).
- **Dependencies**: BACKEND-03B (code being extracted)
- **Deliverables**: `backend/src/lib/proxy-guard.ts`, `backend/.env.example`, edits to `backend/src/modules/bakong-payment/lib/proxy.ts`, `backend/medusa-config.ts`
- **Acceptance Criteria**: Build green; Bakong KHQR spec still passes; boot fails fast on a non-allowlisted `PAYWAY_BASE_URL` (loopback allowed only when dev flag set, two-gate like Bakong).

### ✅ PAYWAY-02: ABA PayWay payment provider module

- _Completed 2026-06-10 — `backend/src/modules/aba-payway/`: vendored `lib/client.ts` (24-field purchase HMAC-SHA512/base64 with `view_type`/`payment_gate` excluded, check-transaction-2, `mintTranId()` = 20 hex chars for PayWay's ≤20 limit, `TRAN_ID_PATTERN`, SSRF-guarded transport with no-redirect + timeout, two-gate loopback escape); `service.ts` (`static identifier = "payway"` → `pp_payway_khqr`): `initiatePayment` → Purchase `abapay_khqr_deeplink` with `lifetime` = reservation TTL, `authorizePayment` → `captured` ONLY on live `payment_status_code === 0` (never throws — stays pending), `refundPayment` NOT_ALLOWED, webhook entry inert (pushback route re-verifies instead); `index.ts` exports `PAYWAY_PROVIDER_ID`. Registration in `medusa-config.ts` conditional on both merchant creds (auth-provider pattern) — dev boots without them; Bakong stays registered (dormant wiring). Verified: provider registered + initiate/authorize exercised end-to-end via the strict-hash mock in payway.spec (PAYWAY-07) — the independent-implementation mock accepting the backend's hashes proves the 24-field spec; real-gateway purchase call also passed hash validation (failed only on the expired key, code 21 — not code 1)._
- **Objective**: Medusa payment provider that creates PayWay KHQR purchases and verifies them server-side.
- **Requirements**: `backend/src/modules/aba-payway/` mirroring `bakong-payment`: `lib/client.ts` = vendored TS port of `sandbox/aba-payway/lib/payway-client.mjs` (24-field purchase hash, check-transaction hash, HMAC-SHA512 base64; no npm `aba-payway`/`payway-js` dep; never log `api_key`/hash inputs). `service.ts` (`static identifier = "payway"`): `initiatePayment` → Purchase with `payment_option=abapay_khqr_deeplink`, `lifetime=20`, minted `tran_id` ≤20 chars (`crypto.randomBytes(10).toString("hex")` — Medusa ids don't fit, gap G7), returns `{qr_string, abapay_deeplink, tran_id, expires_at, status:"pending"}`; `authorizePayment` → check-transaction-2, `captured` **only** on `payment_status_code === 0`; `refundPayment` throws NOT_ALLOWED (manual v1); `getWebhookActionAndData` parses pushback shape but never marks paid (re-verify path only). `index.ts` exports `PAYWAY_PROVIDER_ID = "pp_payway_khqr"`. Conditional registration in `medusa-config.ts` only when `PAYWAY_MERCHANT_ID` + `PAYWAY_API_KEY` set (auth-provider pattern).
- **Dependencies**: PAYWAY-01
- **Deliverables**: `backend/src/modules/aba-payway/{index.ts,service.ts,lib/client.ts}`, `backend/medusa-config.ts` provider entry
- **Acceptance Criteria**: Build green; with mock creds set, provider registers and `initiatePayment` returns a QR via the local mock (:4284); `authorizePayment` returns `captured` only after the mock flips APPROVED.

### ✅ PAYWAY-03: `POST /store/payments/payway/start`

- _Completed 2026-06-10 — Clone of khqr start with the same response contract `{qr, deeplink, reference, expires_at}` (`reference` = minted tran_id): zod middleware (`paywayStartMiddlewares` registered in `src/api/middlewares.ts`), 5/min/IP + 20/hr/cart fixed-window limits, reservation planning with 409 out-of-stock, payment collection reuse, reserve-then-session with release-on-failure, `payway:cart:<tran_id>` cache map (TTL = window + 5 min), idempotent non-expired-session reuse (double-tap can't stack reservations or duplicate PayWay purchases), PayWay failure → 502 `payment_gateway_unavailable`. Shared route helpers live in `payway/shared.ts`. Verified in payway.spec: QR + 20-hex reference + expiry returned; second /start returned the SAME reference with no second mock transaction._
- **Objective**: Start a PayWay KHQR payment for a cart (same storefront contract as the KHQR start route).
- **Requirements**: Clone of `/store/payments/khqr/start`: zod `{cart_id, currency: USD|KHR}` via middleware; rate limits 5/min/IP + 20/hr/cart; stock reservation (409 out-of-stock); payment collection + PayWay session; cache map `payway:cart:<tran_id>` → cart_id (TTL = expiry + 5 min — distinct namespace from `khqr:*`); idempotent session reuse on re-submit; release reservation if session creation fails. Response `{qr, deeplink, reference: tran_id, expires_at}` — same shape the storefront already consumes. KHR amounts whole riel via `usdToKhr`.
- **Dependencies**: PAYWAY-02
- **Deliverables**: `backend/src/api/store/payments/payway/start/{route.ts,middlewares.ts}`, registration in `backend/src/api/middlewares.ts`
- **Acceptance Criteria**: Against the local mock: returns scannable `qr` + `reference`; double-submit reuses the session; out-of-stock returns 409.

### ✅ PAYWAY-03B: `GET /store/payments/payway/status?reference=`

- _Completed 2026-06-10 — Same `{status: pending|paid|expired}` contract as the khqr status route: zod `reference` (`/^[a-f0-9]{20}$/`), 60/min + 120/hr per reference + 60/min/IP, session-ownership check, idempotent `order_cart` short-circuit (existing order → `paid` + invoice token only, completion never re-run), expiry → release + `expired`, server verify via shared `verifyPaywayPaid` (≥3s cache; DECLINED/CANCELLED → terminal `expired` with reservation release), on APPROVED → shared `finalizePaidCart` (release hold → `completeCartWorkflow` with provider re-verify as second independent confirmation → idempotent `stock_movement(out)` per line, reason "KHQR payment (PayWay)" → invoice token). Verified in payway.spec full chain: pending → paid flip drove order creation, `captured_at` stamped on the payment, exactly one `out` row, invoice 200; client-forged paid impossible (status read only from PayWay verify — forged-pushback test doubles as proof)._
- **Objective**: Poll endpoint that confirms payment and finalizes the order.
- **Requirements**: zod-validate `reference` (minted tran_id shape `/^[a-f0-9]{20}$/`); rate limits 60/min + 120/hr per reference + 60/min/IP; server-side verify via check-transaction-2 with ≥3s verify cache (`payway:verify:<tran_id>`); idempotent `order_cart` short-circuit (already-completed cart returns `paid` immediately); on `paid`: release `/start` reservation → `completeCartWorkflow` (provider `authorizePayment` re-verifies — second independent confirmation) → idempotent `stock_movement(type=out)` per line → mint invoice token; on expiry: release reservation, return `expired`. Returns `{status: pending|paid|expired, order_id?, invoice_token?}`.
- **Dependencies**: PAYWAY-03
- **Deliverables**: `backend/src/api/store/payments/payway/status/route.ts`
- **Acceptance Criteria**: Mock paid-flip drives `pending` → `paid`; order created with capture recorded; exactly one `out` movement per line item; client-forged "paid" impossible (status read only from PayWay verify).

### ✅ PAYWAY-04: PayWay pushback (server callback)

- _Completed 2026-06-10 — Implemented at **`/hooks/payway/pushback`** (`backend/src/api/hooks/payway/pushback/route.ts`), NOT under `/store`: Medusa requires the publishable API key on all `/store/*` routes and ABA's callback cannot send one (deliverable path corrected accordingly). zod shape `{tran_id (strict pattern), apv?, status?, return_params?}` → 400 on malformed; 30/min/IP + 10/min/tran_id limits; the UNSIGNED body never drives state — mandatory re-verify via the same `verifyPaywayPaid`, then the same `finalizePaidCart`; uniform `200 {received:true}` for unknown tran_ids (no existence oracle); double delivery safe via the `order_cart` short-circuit + idempotent completion. `PAYWAY_PUSHBACK_URL` documented in `.env.example` (unset in dev = poll-only; the spec posts the callback itself). Verified in payway.spec: pushback completed an order with NO poll (proven causally — mock reverted to PENDING and the 30s verify cache waited out before the status check, so `paid` could only come from the already-created order); forged pushback for an unpaid tran_id changed nothing; malformed body → 400._
- **Objective**: Complete orders even when the customer never returns to the poll screen (pays in ABA app and closes the browser).
- **Requirements**: Accept PayWay's unsigned JSON pushback `{tran_id, apv, status, return_params}`; zod-validate shape; rate-limit per IP and per tran_id; **never trust the body** — re-verify via check-transaction-2, then run the exact PAYWAY-03B completion path (idempotent — poll and pushback may race; `order_cart` short-circuit + Medusa session state guard the double-complete); always respond 200 fast; log with request id, redact buyer PII. `return_url` (base64) is set in PAYWAY-02's purchase call from `PAYWAY_PUSHBACK_URL` env (unset in dev = pushback off, poll-only).
- **Dependencies**: PAYWAY-03B
- **Deliverables**: `backend/src/api/hooks/payway/pushback/route.ts` (under `/hooks` — Medusa requires the publishable key on `/store/*` and ABA's callback can't send one), `PAYWAY_PUSHBACK_URL` in `.env.example`
- **Acceptance Criteria**: Mock pushback completes the order without any poll; a forged pushback for an unpaid tran_id does **not** create/flip anything; double delivery (pushback + poll) yields exactly one order.

### ✅ PAYWAY-05: Reservation expiry + Telegram alert coverage

- _Completed 2026-06-10 — `expire-reservations.ts`: provider match generalized to `KHQR_PROVIDER_IDS = {BAKONG_PROVIDER_ID, PAYWAY_PROVIDER_ID}` (`findExpiredPendingKhqrSession`); all existing guards unchanged (`completed_at: null` filter, terminal-status skip, paginated scan) — PayWay sessions write the same `data.expires_at` aligned to the 20-min TTL (`PAYWAY_EXPIRES_MINUTES`, one constant with the purchase `lifetime`). `order-placed.ts`: `resolvePaymentMethod()` checks `PAYWAY_PROVIDER_ID` first → "KHQR (ABA PayWay)" (COD metadata flag still wins; Bakong → "KHQR"; fallthrough "Unknown" unchanged). NOTE: job behavior verified at code/typecheck level + structural identity with the Bakong path proven by TEST-04-era coverage; a live 20-minute expiry wait was not run (same posture as BACKEND-10's acceptance)._
- **Objective**: PayWay sessions participate in the same lifecycle plumbing as Bakong/COD.
- **Requirements**: `expire-reservations` job treats `PAYWAY_PROVIDER_ID` sessions like Bakong sessions (release reservations + delete stale sessions for incomplete carts; terminal statuses skipped) — purchase `lifetime` (20 min) and reservation TTL pinned to one shared constant (gap G4). `order-placed` subscriber `resolvePaymentMethod()` gains a `PAYWAY_PROVIDER_ID` → "ABA PayWay (KHQR)" branch (gap G3).
- **Dependencies**: PAYWAY-02
- **Deliverables**: edits to `backend/src/jobs/expire-reservations.ts`, `backend/src/subscribers/order-placed.ts`
- **Acceptance Criteria**: An unpaid PayWay cart's reservation is released after expiry by the job; a paid PayWay order's Telegram alert (mock/no-op mode) resolves the method as ABA PayWay, not "Unknown".

### ✅ PAYWAY-06: Storefront cutover (KHQR screen now powered by PayWay)

- _Completed 2026-06-10 — `storefront/src/lib/checkout.ts`: `startKhqr`/`pollKhqrStatus` repointed to `/store/payments/payway/start|status` (same response contract, so the pay screen's countdown/poll/redirect logic is untouched); `REFERENCE_PATTERN` updated to the minted-tran_id shape `/^[a-f0-9]{20}$/`; cart id still read only from the HttpOnly cookie, currency from `ali_currency`. UI text: checkout payment option retitled "Bakong KHQR" → "KHQR" (`checkout/page.tsx`), QR `title` → "KHQR payment code" (`checkout/khqr/page.tsx`); the coral "Pay with KHQR" CTA and all components unchanged — no new components, accent stays in its two sanctioned uses. Verified via the payway.spec full browser journey (PDP → checkout → QR → simulated pay → confirmation with order id + working invoice link) and cod.spec regression. NOTE: 360px layout untouched by this task (text-only edits to existing elements); TEST-09's responsive checklist still stands._
- **Objective**: Point the existing KHQR checkout flow at the PayWay routes — zero visual redesign.
- **Requirements**: `storefront/src/lib/checkout.ts`: `startKhqr()`/`pollKhqrStatus()` call `/store/payments/payway/start|status`; reference validation regex updated to the minted tran_id shape; cart-id still read from HttpOnly cookie only; currency from `ali_currency` cookie. `checkout/khqr/page.tsx`: unchanged poll/countdown; deeplink button opens `abapay_deeplink` (label "Open ABA Mobile"). No new components; accent color stays confined to sale price + KHQR CTA per design rules.
- **Dependencies**: PAYWAY-03B
- **Deliverables**: edits to `storefront/src/lib/checkout.ts`, `storefront/src/app/checkout/khqr/page.tsx`
- **Acceptance Criteria**: Full browser journey against the local mock: checkout → QR renders → mock pay → poll flips → confirmation page with order id + invoice link; COD path untouched and green; layout verified at 360px (no regressions).

### ✅ PAYWAY-07: PayWay end-to-end spec (sandbox)

- _Completed 2026-06-10 — `storefront/tests/payway.spec.ts` (5/5 green, serial): in-spec mock PayWay gateway on **:4284** with STRICT HMAC verification using an INDEPENDENT implementation of the 24-field hash spec (a backend hash bug cannot self-validate; real error codes 1/5 on mismatch). Journeys: (1) start contract — QR + 20-hex reference + expiry + deeplink, strict-mock hash acceptance, status pending, idempotent session reuse with no duplicate purchase; (2) tampered-hash rejection (mock strictness proof); (3) full UI chain — PDP size S → checkout "KHQR" → pay screen → simulated APPROVED → UI poll redirect → order confirmed → status idempotent paid + invoice 200 → backend truth via `dev-verify-khqr-order.ts` (`captured_at` stamped, exactly one `stock_movement(out)`, reason "KHQR payment (PayWay)"); (4) pushback completes the order with NO poll (causal proof via mock-revert + 31s verify-cache wait); (5) forged pushback does nothing + malformed → 400. khqr.spec.ts trimmed to Bakong backend-contract coverage (UI journey superseded — header documents the scope change). backend/.env dev-mock block added (`PAYWAY_BASE_URL=http://127.0.0.1:4284` etc.; while set, /payway/* 502s unless the mock listens). Regression: khqr.spec + cod.spec 3 passed / 1 skipped (Telegram live-send, secrets-gated by design). Builds: backend `npm run build` green (required fixing two pre-existing `seed-shipping.ts` filter-type errors — `is_enabled` filter dropped, `service_zone_id` → `service_zone.id`); storefront tsc green, but `npm run build` could not run while the dev server held `.next` (Windows EPERM) — re-run after stopping the dev server. DEVIATION: the expired-QR branch is not exercised live (20-min window impractical in-spec); it is the identical template TEST-04 proved and the expiry job covers abandonment — documented in the spec header._
- **Objective**: TEST-04-equivalent automated proof for the PayWay chain.
- **Requirements**: `storefront/tests/payway.spec.ts` mirroring `khqr.spec.ts`: in-spec `startMockPayWay()` on **:4284** (4280 Bakong / 4281 FB / 4282 Google taken) implementing `/purchase` + `/check-transaction-2` with **strict HMAC verification** (port of `sandbox/aba-payway/mock-server.mjs`); backend `.env` dev block (`PAYWAY_BASE_URL=http://127.0.0.1:4284`, mock creds, `PAYWAY_DEV_ALLOW_LOOPBACK=1`). Journeys: happy path (start → PENDING → paid-flip → order; backend truth via dev-verify script), tampered-hash rejection, expiry path, pushback completion + forged-pushback rejection (PAYWAY-04). Regression: khqr.spec + cod.spec still pass; `npm run build` green in both repos.
- **Dependencies**: PAYWAY-04, PAYWAY-05, PAYWAY-06
- **Deliverables**: `storefront/tests/payway.spec.ts`, backend `.env` dev block, dev-verify script if a PayWay-specific one is needed
- **Acceptance Criteria**: All payway.spec journeys pass locally; no regression in existing payment specs.

### PAYWAY-08: UAT cutover to real ABA sandbox → production (human + ops gated)

- _Status 2026-06-10 — **BLOCKED on credentials.** Live test against the real sandbox executed with merchant `ec460802` (`sandbox/credential_info.txt`, now git-ignored): purchase returned **code 21 "End of API lifetime"** (trace_id `1f26867ea214ef1d3a27b70ac1aa0595`) — the API key expired 27 Jul 2025; the requested extension is not yet effective (renewals may arrive as a NEW key by email — check inbox / follow up with PayWay quoting the trace id). Encouraging: the failure was NOT code 1 (hash accepted by the real gateway's pipeline) and NOT code 6 (IP not rejected at this stage). A commented real-sandbox block is staged at the bottom of `backend/.env` — paste the renewed key, swap blocks, restart. Retest: set `PAYWAY_*` env vars and run `node sandbox/aba-payway/run-test.mjs`, pay the printed `checkout_qr_url`, then `--check <tran_id>` → APPROVED._
- **Objective**: Prove the integration against ABA's real sandbox, then go live.
- **Requirements**: Register at sandbox.payway.com.kh (creds by email — CLARIFY-12); whitelist UAT/Proxmox egress IP with PayWay integration team (expect `code 6` until done); run `sandbox/aba-payway/run-test.mjs` against the real sandbox, then the full storefront journey with a real sandbox KHQR scan; confirm fees/settlement with paywaysales@ababank.com; production creds + production IP whitelisting; flip `PAYWAY_BASE_URL` + creds per environment (no code change); `PAYWAY_PUSHBACK_URL` set to the public HTTPS backend URL.
- **Dependencies**: PAYWAY-07, CLARIFY-12
- **Deliverables**: env updates per environment; UAT sign-off notes in `docs/aba-payway-integration-guide.md`
- **Acceptance Criteria**: Real sandbox payment flips a real order to paid end-to-end; production checklist complete.

---

## Phase 7 — KHPAY (aggregator replaces direct ABA PayWay as active KHQR provider)

> **Why (locked 2026-06-10):** ABA declined the direct PayWay merchant application pending a business license (PAYWAY-08 blocked indefinitely). KHPAY (https://khpay.site) is a Cambodian aggregator exposing both an ABA PayWay QR rail and a **Bakong KHQR rail**. Locked decisions: (1) **Bakong rail only** — money settles directly to our own Bakong account (configured once in the KHPAY dashboard), not through KHPAY's PayWay link; (2) **in-store QR + polling** — the existing pay screen renders KHPAY's EMV KHQR string, customer never leaves the storefront; (3) **polling-only confirmation** — `paid` comes solely from backend `POST /bakong/check`, no webhook/callback_url. Both `bakong-payment` and `aba-payway` modules stay in the repo, dormant (env-gated). API auth is a bearer key (`KHPAY_API_KEY`); KHPAY's Bakong rail returns no banking-app deeplink (`deeplink: null` — the pay screen's deeplink CTA simply doesn't render). ⚠️ UAT must confirm: KHR-denominated generate (docs lean USD-only), real `bk_…` id shape vs `KHPAY_REFERENCE_PATTERN`, and the daily request quota (Free plan = 100 req/day — the 3s-cached status polling of ONE 20-min checkout can exceed it; budget a paid plan or longer verify cache before go-live).

### ✅ KHPAY-01: KHPAY payment provider module (vendored client, Bakong rail)

- _Completed 2026-06-10 — `backend/src/modules/khpay-payment/`: vendored `lib/client.ts` (`POST /bakong/generate` + `POST /bakong/check`, bearer auth, `{success,data}` envelope tolerant parse, `KHPAY_REFERENCE_PATTERN = /^bk_[A-Za-z0-9]{6,64}$/`, `TRANSACTION_NOT_FOUND` → notFound, SSRF-guarded transport via shared `proxy-guard.ts` with hard-coded allowlist `khpay.site`, no-redirect + 8s timeout, two-gate loopback escape `KHPAY_DEV_ALLOW_LOOPBACK=1`); `service.ts` (`static identifier = "khpay"` → `pp_khpay_khqr`): `initiatePayment` → generate with `type: "individual"` (locked Individual KHQR) + OUR ISO `expires_at` (KHPAY's is non-ISO/zone-ambiguous), `authorizePayment` → `captured` ONLY on live `/bakong/check` paid (never throws — stays pending), `refundPayment` NOT_ALLOWED, webhook entry inert (polling-only); `index.ts` exports `KHPAY_PROVIDER_ID`. Registration in `medusa-config.ts` conditional on `KHPAY_API_KEY` + boot-time `assertSafeKhpayUrl`; env scaffolding in `.env.example` (`KHPAY_BASE_URL`/`KHPAY_API_KEY`/`KHPAY_EXPIRES_MINUTES`/dev flag)._
- **Objective**: Medusa payment provider that creates KHPAY Bakong KHQRs and verifies them server-side.
- **Requirements**: Mirror `aba-payway` module structure; vendored client (no npm SDK); bearer-key auth, never logged; hard-coded SSRF allowlist `khpay.site` + boot check; `paid` only from `/bakong/check`; amount USD 2dp / KHR whole riel; payment lifetime pinned to the 20-min reservation TTL.
- **Dependencies**: PAYWAY-01 (shared proxy-guard)
- **Deliverables**: `backend/src/modules/khpay-payment/{index.ts,service.ts,lib/client.ts}`, `backend/medusa-config.ts` provider entry + boot check, `backend/.env.example` KHPAY block
- **Acceptance Criteria**: Build green; with mock key set, provider registers and `initiatePayment` returns a QR via the local mock (:4285); `authorizePayment` returns `captured` only after the mock flips paid.

### ✅ KHPAY-02: `POST /store/payments/khpay/start`

- _Completed 2026-06-10 — Clone of payway start with the same response contract `{qr, deeplink: null, reference, expires_at}` (`reference` = KHPAY `bk_…` transaction_id; deeplink always null on this rail): zod middleware (`khpayStartMiddlewares` registered in `src/api/middlewares.ts`), 5/min/IP + 20/hr/cart limits, reservation planning with 409 out-of-stock, payment collection reuse, reserve-then-session with release-on-failure, `khpay:cart:<transaction_id>` cache map (TTL = window + 5 min), idempotent non-expired-session reuse, KHPAY failure → 502 `payment_gateway_unavailable`. Route helpers in `khpay/shared.ts` (per-provider copy, repo precedent)._
- **Objective**: Start a KHPAY Bakong KHQR payment for a cart (same storefront contract as the khqr/payway start routes).
- **Requirements**: Same as PAYWAY-03 with KHPAY provider/cache namespaces (`khpay:*`, `rl:khpay_*`).
- **Dependencies**: KHPAY-01
- **Deliverables**: `backend/src/api/store/payments/khpay/{start/route.ts,start/middlewares.ts,shared.ts}`, registration in `backend/src/api/middlewares.ts`
- **Acceptance Criteria**: Against the local mock: returns EMV `qr` + `bk_` reference; double-submit reuses the session; out-of-stock returns 409.

### ✅ KHPAY-03: `GET /store/payments/khpay/status?reference=`

- _Completed 2026-06-10 — Same `{status: pending|paid|expired}` contract as the khqr/payway status routes: zod `reference` (`KHPAY_REFERENCE_PATTERN`), 60/min + 120/hr per reference + 60/min/IP, session-ownership check, idempotent `order_cart` short-circuit, expiry → release + `expired`, server verify via `verifyKhpayPaid` (≥3s cache `khpay:verify:*`; KHPAY `expired`/`failed` → terminal `expired` with reservation release; notFound stays pending until our window gate), on paid → shared `finalizePaidCart` (release hold → `completeCartWorkflow` with provider re-verify → idempotent `stock_movement(out)`, reason **"KHQR payment (KHPAY)"** → invoice token). Polling is the ONLY confirmation path (no webhook/pushback route exists for KHPAY)._
- **Objective**: Poll endpoint that confirms payment and finalizes the order — the single confirmation entry point.
- **Requirements**: Same as PAYWAY-03B minus pushback; verify via `POST /bakong/check`.
- **Dependencies**: KHPAY-02
- **Deliverables**: `backend/src/api/store/payments/khpay/status/route.ts`
- **Acceptance Criteria**: Mock paid-flip drives `pending` → `paid`; order created with capture recorded; exactly one `out` movement per line item; client-forged "paid" impossible.

### ✅ KHPAY-04: Lifecycle plumbing (reservation expiry + Telegram alert coverage)

- _Completed 2026-06-10 — `expire-reservations.ts`: `KHQR_PROVIDER_IDS` now `{BAKONG, PAYWAY, KHPAY}` (KHPAY sessions write the same ISO `data.expires_at` pinned to the TTL, so the one expiry rule covers all three). `order-placed.ts`: `resolvePaymentMethod()` checks `KHPAY_PROVIDER_ID` first → **"KHQR (KHPAY)"** (COD metadata flag still wins; PayWay/Bakong branches unchanged)._
- **Objective**: KHPAY sessions participate in the same lifecycle plumbing as Bakong/PayWay/COD.
- **Dependencies**: KHPAY-01
- **Deliverables**: edits to `backend/src/jobs/expire-reservations.ts`, `backend/src/subscribers/order-placed.ts`
- **Acceptance Criteria**: An unpaid KHPAY cart's reservation is released after expiry by the job; a paid KHPAY order's Telegram alert resolves the method as KHQR (KHPAY).

### ✅ KHPAY-05: Storefront cutover + end-to-end spec

- _Completed 2026-06-10 — Cutover (`storefront/src/lib/checkout.ts`): `startKhqr`/`pollKhqrStatus` repointed to `/store/payments/khpay/start|status` (same response contract — pay screen untouched); `REFERENCE_PATTERN` → `/^bk_[A-Za-z0-9]{6,64}$/`; deeplink CTA self-hides (route always returns `deeplink: null`). Spec (`storefront/tests/khpay.spec.ts`): in-spec mock KHPAY gateway on **:4285** (4280 Bakong / 4281 FB / 4282 Google / 4284 PayWay taken) implementing `/bakong/generate` + `/bakong/check` with **strict bearer-key verification** (401 `INVALID_API_KEY` on mismatch). Journeys: (1) start contract — EMV QR + `bk_` reference + our-window expiry + null deeplink, strict-mock auth acceptance, status pending, idempotent reuse with no duplicate generate; (2) wrong-bearer rejection (mock strictness proof); (3) full UI chain — PDP size S → checkout "KHQR" → pay screen → simulated paid → UI poll redirect → order confirmed → status idempotent paid + invoice 200 → backend truth via `dev-verify-khqr-order.ts` (`captured_at` stamped, exactly one `stock_movement(out)`, reason "KHQR payment (KHPAY)"). backend/.env dev-mock block added (`KHPAY_BASE_URL=http://127.0.0.1:4285/api/v1` etc.; while set, /khpay/* 502s unless the mock listens)._
- **Objective**: Point the existing KHQR checkout flow at the KHPAY routes (zero visual redesign) and prove the chain end-to-end against the strict local mock.
- **Dependencies**: KHPAY-03, KHPAY-04
- **Deliverables**: edits to `storefront/src/lib/checkout.ts`, `storefront/tests/khpay.spec.ts`, backend `.env` dev block
- **Acceptance Criteria**: Full browser journey against the local mock: checkout → QR renders → mock pay → poll flips → confirmation page with order id + invoice link; COD path untouched; no regression in existing payment specs.

### ✅ KHPAY-06: UAT cutover to real KHPAY (human + ops gated)

- _Completed 2026-06-10 — **Real-money payment proven end-to-end**: owner's KHPAY key live (`GET /me` → `bakong_configured: true`, plan "basic"); real banking-app scan paid a $16.50 order (order #64, `order_01KTR2NWRMR6NXDK4N7PFFPS2Z`) → status flipped paid → confirmation page + Telegram alert. UAT findings folded back into code: (1) **KHR rejected live** ("currency must be USD") → start route now always charges USD, display toggle stays display-only; (2) live error envelope uses `error_code` not the documented `code` → client accepts both; (3) real txn ids are `bk_` + 16 UPPERCASE hex (pattern already matched); (4) PDP "Pay with KHQR" CTA had never been wired (FRONTEND-14 gap) → now adds to bag + routes to /checkout; (5) Telegram alert fixes (BACKEND-09): order query gained `summary`/`item_total`/`shipping_total`/`items.detail.quantity` (total had silently summed shipping-only $1.50; quantity showed ×?), note now rides cart `metadata.checkout_note` (written by checkout prep, copied to the order — covers KHQR orders that never POST a note), and the message gained Subtotal/Delivery breakdown lines. WATCH ITEMS (ops): plan quota headroom on "basic" (status polling at the 3s verify cache during checkouts — monitor dashboard usage), and fee/settlement terms still to be confirmed in writing with KHPAY._
- **Objective**: Prove the integration against the real KHPAY gateway, then go live.
- **Requirements**: Create a KHPAY account; configure Dashboard → Settings → Bakong (`account_id`, merchant name, city — settlement target is OUR Bakong account); mint a production API key (Dashboard → Settings → API keys; rotate via `POST /keys/{id}/rotate`); set `KHPAY_API_KEY` (+ leave `KHPAY_BASE_URL` at the default) per environment; **verify with a real ~$0.50 payment**: full storefront journey with a real banking-app scan → order flips paid → money lands in the Bakong account. Confirm during UAT: real `bk_…` id shape matches `KHPAY_REFERENCE_PATTERN`; whether `/bakong/generate` accepts KHR (if not, hide the KHR QR denomination or convert before send); plan quota headroom (Free = 100 req/day vs ~20 status verifies/min/checkout at the 3s cache — Starter+ strongly advised); KHPAY's fee/settlement terms and the vendor's operational trustworthiness (it is an aggregator holding our gateway access — document the risk owner).
- **Dependencies**: KHPAY-05
- **Deliverables**: env updates per environment; UAT sign-off notes in `docs/khpay-integration-guide.md`
- **Acceptance Criteria**: Real payment flips a real order to paid end-to-end; quota/fee/KHR questions answered and recorded; production checklist complete.

---

## Phase 8 — TRACK (Customer order tracking — v2, deferred)

> **Status: DEFERRED to v2 (decided 2026-06-11).** Source: `DESIGN-track-order.md` (full research + comparison). **Locked decisions:** (1) **Build custom, zero new dependencies** — the npm / GitHub / Medusa survey found nothing adoptable: carrier-tracking SDKs (`aftership`, `easypost`, `shippo`, `ts-tracking-number`) assume couriers we don't have (manual local delivery), and the one on-target Medusa plugin `order-management` is **NO-MATCH** (email-only OTP needing email infra we don't run + a fork for phone/Telegram; pins `@medusajs/* 2.11.2` vs our exact 2.15.3; pre-1.0, single-author, ~21 dl/wk, `Math.random()` OTP + in-memory store + no rate limiting — fails the >100-dl/source-review rule). (2) **Auth = token magic-link only** — reuse the invoice capability-token primitive (`backend/src/lib/order-token.ts`), keyed on the **internal non-sequential order `id`** (ULID per `security.md`, exactly how the invoice route is keyed and already carried to the client today) + a single-purpose 256-bit `track_token`; both phone-digit lookup **and** `display_id` keying are **rejected** (low-entropy PII / sequential `display_id` → enumerable, and `display_id` is not surfaced client-side today — the internal `id` already is, removing all extra plumbing). (3) **Status-only response, no PII.** Native Medusa is unsafe for guest lookup: `GET /store/orders/:id` is unauthenticated (leaks any order by id, fails `security.md`'s ownership rule) and `GET /store/orders` is customer-account-only (we're guest-only). Footer "Track Order" stays `href="/"` until TRACK-04 ships. The token approach dissolves the original "needs accounts/lookup" blocker that parked this feature (see FRONTEND-24 note) — it is buildable under guest-only checkout, just not prioritized for v1.

### TRACK-01: Order-tracking capability token

- **Objective**: Mint/verify a single-purpose order-tracking token, reusing the invoice-token primitive.
- **Requirements**: Generalize `backend/src/lib/order-token.ts` to issue a purpose-scoped `track_token` (distinct from the invoice token — `security.md`: tokens are single-purpose): `crypto.randomBytes(32)` base64url (≥128-bit), stored on `order.metadata.track_token`, 30-day TTL, admin-revocable, compared with `timingSafeEqual`. Pure helper — no route yet. Never logged. The existing invoice-token mint/verify path must stay behavior-preserving.
- **Dependencies**: BACKEND-06 (the `order-token.ts` primitive being generalized)
- **Deliverables**: `backend/src/lib/order-token.ts` (extend — add `track_token` mint/verify)
- **Acceptance Criteria**: Helper mints a 256-bit `track_token` onto an order and verifies it via `timingSafeEqual`; wrong/expired/revoked token fails closed; the invoice-token path is unchanged; backend build green.

### TRACK-02: `GET /store/orders/track` (token-gated, status-only)

- **Objective**: Guest order-status lookup keyed on the internal order `id` + `track_token`, returning status only.
- **Requirements**: Clone the `backend/src/api/store/orders/[id]/invoice/route.ts` template, including its **inline** zod validation (`ParamsSchema`/`QuerySchema` in the handler — single source of truth, no separate middleware file). zod-validate `id` (the internal order `id`, supplied as a query param) + `token` before any service call; resolve via `query.graph(entity:"order", filters:{ id })` selecting ONLY status-safe fields — `id, status, created_at, metadata.confirmation_status, payment_collection.payments.captured_at, fulfillments.shipped_at, fulfillments.delivered_at, fulfillments.labels.tracking_number, fulfillments.labels.tracking_url` — **never** phone/address/email, and **never** the computed `payment_status`/`fulfillment_status` (per the invoice route's own field-list note + the `khqr-start` lesson, those resolve `undefined`/`0` through `query.graph`). Derive the timeline from raw fields: **paid** = `payment_collection.payments.captured_at` present (KHQR) or COD `metadata.confirmation_status`; **shipped/delivered** = the `fulfillments.*_at` timestamps. Authorize with `timingSafeEqual` against `order.metadata.track_token`. Rate-limit per-IP **and** per-order-`id` by copying the `overLimit()` fixed-window pattern (it is duplicated per route in `cod`/`invoice`/`khpay`, not a shared export). Unknown order (404) and bad/expired token (403) both return a generic `{ error, request_id }` body — the order `id` is a non-sequential ULID (`security.md`), so existence-probing isn't a practical vector; keep errors generic regardless. `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`. Storefront reaches it through the existing `/store/*` publishable-key proxy (`storefront/src/middleware.ts`).
- **Dependencies**: TRACK-01
- **Deliverables**: `backend/src/api/store/orders/track/route.ts` (zod-validated inline, mirroring the invoice route — no separate middleware file; the `/store` publishable-key middleware is already applied globally)
- **Acceptance Criteria**: Valid `id`+`token` → status payload with no PII and no computed `payment_status`/`fulfillment_status` selected (paid derived from `payments.captured_at`); wrong/expired token → generic 403; unknown `id` → generic 404; both error bodies generic and non-revealing; per-IP and per-order-`id` limits enforced; `no-store`/`nosniff` present.

### TRACK-03: Issue + carry the track link from order finalization

- **Objective**: Mint the track token at order finalization and carry the link to the confirmation screen.
- **Requirements**: Mint the `track_token` (TRACK-01) wherever an order is finalized today and return it alongside `invoice_token`: the COD route (`backend/src/api/store/orders/cod/route.ts`) **and** the KHPAY `finalizePaidCart` (`backend/src/api/store/payments/khpay/shared.ts`, the active KHQR rail — the PayWay copy stays dormant) so the link covers whichever KHQR rail is live. Both finalizers already return the internal `order_id`, which already flows to the client via `checkout.ts` → `/order/[id]`, so **no new id plumbing is needed** — only add `track_token` next to the existing `invoice_token`. Carry it through `storefront/src/lib/checkout.ts` (mirror the INTEGRATION-07 invoice-token `?token=` carry) and surface a "Track your order" link on `/order/[id]` (`storefront/src/app/order/[id]/page.tsx`) → `/track?id=<order_id>&token=<track_token>` (the same internal `order_id` the page is already keyed on, and the same id TRACK-02 filters by). The token is only ever forwarded, **never minted client-side**.
- **Dependencies**: TRACK-01 (the `track_token` mint helper it calls), TRACK-02, INTEGRATION-04 (COD carry), INTEGRATION-07 (invoice-token carry precedent), KHPAY-03 (`finalizePaidCart`)
- **Deliverables**: edits to `backend/src/api/store/orders/cod/route.ts`, the KHPAY `finalizePaidCart` (`backend/src/api/store/payments/khpay/shared.ts`), `storefront/src/lib/checkout.ts`, `storefront/src/app/order/[id]/page.tsx`
- **Acceptance Criteria**: A placed COD order and a paid KHQR order each return a `track_token`; the confirmation screen shows a working "Track your order" link; no token is minted client-side; existing invoice-link behavior unchanged.

### TRACK-04: `/track` page + activate footer link

- **Objective**: The customer-facing Track Order page; flip the dead footer link live.
- **Requirements**: `/track` Server Component (`storefront/src/app/track/page.tsx`) reads `id` + `token` from `searchParams`, calls `GET /store/orders/track` through the SDK/proxy, and renders a flat **4-step status timeline** — Placed (`created_at`) → Paid/Confirmed (`payment_collection.payments.captured_at` present for the KHQR rail, or COD `metadata.confirmation_status="pending_confirmation"`) → Shipped (`fulfillments.shipped_at`, optional tracking #) → Delivered (`fulfillments.delivered_at`). Absent/invalid token → a neutral "we couldn't find that order — check your link or message us" state (no enumeration, no order data). `<li>` rows separated by a single `border-hairline` divider; `bg-soft-cloud` where a surface is needed; tokens-only, accent unused, no gradients/shadows/`dark:`; single `<h1>`; verified at 360px. Repoint footer "Track Order" `/` → `/track`, updating `Footer` (and `TopNav` if it carries the same link) together per `design.md`. Reuses the `?token=` carry pattern from `order/[id]/page.tsx`; **no new components or deps**.
- **Dependencies**: TRACK-02, FRONTEND-19 (confirmation `?token=` pattern), FRONTEND-20 (footer)
- **Deliverables**: `storefront/src/app/track/page.tsx`, `storefront/src/components/layout/Footer.tsx` (modified — repoint), `storefront/src/components/layout/TopNav.tsx` (modified if it carries the link)
- **Acceptance Criteria**: Footer "Track Order" opens `/track`; valid `?id=&token=` renders the order's status timeline; absent/invalid token shows the neutral not-found state with no order data; single `h1`; 360px holds with no overflow; tokens-only styling, accent unused, no gradients/shadows/`dark:`.

### TRACK-05: Track end-to-end spec

- **Objective**: Playwright proof for the track chain (TEST-04 / info-pages precedent).
- **Requirements**: `storefront/tests/track.spec.ts`: place/seed an order, mint its `track_token`, then assert — (1) valid `id`+`token` renders the status timeline, cross-checked against an independent admin read of the same order's `payment_status`/`fulfillment_status` (reuse the TEST-05 throwaway-admin pattern if an admin read is needed); (2) wrong/expired token → the generic not-found state (403 underneath); (3) unknown `id` → the generic not-found state (404 underneath, same generic not-found body); (4) the response/DOM carries **no PII** (no phone/address/email). Green solo and in the full parallel suite.
- **Dependencies**: TRACK-03, TRACK-04
- **Deliverables**: `storefront/tests/track.spec.ts`
- **Acceptance Criteria**: Valid token shows status matching the admin read; wrong/expired token and unknown id both show the generic not-found; no PII in the response or DOM; spec passes solo and in the suite.

---

## Phase 9 — ANALYTICS (Admin sales/product analytics dashboard — v2, deferred)

> **Status: DEFERRED to v2 (researched 2026-06-12 via `/search-first`).** Evaluated `@agilo/medusa-analytics-plugin` (GitHub `Agilo/medusa-analytics-plugin`) against `@rsc-labs/medusa-store-analytics-v2`. **Decision = ADOPT `@agilo/medusa-analytics-plugin` as-is (zero custom code)** — an admin-dashboard plugin (Orders + Products tabs with KPI / line / bar / pie charts, list-page widgets for Orders/Products/Customers, date-range presets) that computes its own metrics from Medusa core order/inventory data. **Why it clears the gates that `order-management` failed under Phase 8:** MIT licensed; peer range `@medusajs/* >=2.11.0 <3.0.0` **includes our pinned 2.15.3** (a real range, not an exact pin — so `npm ci` resolves without `--legacy-peer-deps`); 517 downloads/week · 2,583/month (clears the >100-dl/wk rule); past 1.0 (v1.4.0, last published 2026-05-04 — outside the 7–14-day backend-path freshness window); and an **admin-UI-only footprint** — its runtime deps (`recharts`, `luxon`, `date-fns`, `lucide-react`, `react-day-picker`, `@radix-ui/*`, `react-aria-components`, `@tanstack/react-query`, `tailwindcss ^4`, `clsx`/`cva`/`tailwind-merge`) ship into the **Medusa Admin** build only; they never touch the Next.js storefront bundle or its Tailwind-v3 design tokens. **Rejected alternative:** `@rsc-labs/medusa-store-analytics-v2` — also MIT and peer-compatible (`^2.7.1`), but pre-1.0 (v0.1.9), last touched 2025-11-17, with a heavier peer footprint (exact `@mikro-orm/* 6.4.3` + `pg` + its own `@rsc-labs/nocto-plugin-system`) = more integration surface for the same outcome. **✅ Owner-approved 2026-06-12** — the owner approved adding `@agilo/medusa-analytics-plugin` to the stack (it sits outside the original locked set per `Stack.md` / `security.md`; this is the explicit sign-off those rules require). The dependency is cleared for ANALYTICS-01, which still runs the `SETUP-01B` supply-chain pass (`npm audit`/Semgrep/dep skim) before merge. Phase 9 stays **v2-deferred** — nothing installs until v2 work begins. **Overlap note:** the existing `BACKEND-08` (`/admin/reports/sales`) + `BACKEND-08B` (`/admin/reports/stock`) endpoints **stay** — they serve programmatic / period-revenue (PRD §7) and any Telegram/export needs; the plugin owns only the visual admin dashboard and does not replace them.

### ANALYTICS-01: Vet, pin & register the Agilo analytics plugin (owner-approval-gated)

- **Objective**: Add `@agilo/medusa-analytics-plugin` to the Medusa backend, exact-pinned, behind the owner-approval gate.
- **Requirements**: Only after the owner approves the new dependency (banner gate): install `@agilo/medusa-analytics-plugin@1.4.0` **exact** (no `^`/`~`; `.npmrc save-exact=true` already enforces this), commit the lockfile, and use `npm ci` on every install thereafter. Register it in `backend/medusa-config.ts` — `plugins: [{ resolve: "@agilo/medusa-analytics-plugin", options: {} }]`. Run the `SETUP-01B` supply-chain pass before merge: `npm audit --production` (fail on `high`+), Semgrep, and a manual skim of the 15 runtime deps + the transitive lockfile diff. Confirm the plugin registers **no `/store/*` public route** (admin widgets/pages only). Do **not** bump any `@medusajs/*` off the pinned `2.15.3`.
- **Dependencies**: SETUP-01 (Medusa backend), SETUP-01B (supply-chain policy), SETUP-03 (Redis — the plugin's required Caching Module), owner approval (banner gate)
- **Deliverables**: `backend/package.json` (+ exact dep), `backend/package-lock.json` (lockfile), `backend/medusa-config.ts` (register plugin)
- **Acceptance Criteria**: `@agilo/medusa-analytics-plugin@1.4.0` pinned exact; `npm ci` resolves cleanly against pinned `@medusajs/* 2.15.3` and `@medusajs/ui` 4.x with no `--legacy-peer-deps`; `npm audit --production` clean of `high`+; `npx medusa build` succeeds and the admin loads; no new `/store/*` route was introduced.

### ANALYTICS-02: Admin dashboard verification + report cross-check + security posture

- **Objective**: Prove the dashboard renders behind admin MFA and its figures reconcile with our own reports.
- **Requirements**: With the dev backend running and seeded (TEST-phase catalog/order fixtures), open Medusa Admin → Analytics and verify: the **Orders** tab (Total Orders, Total Sales, Orders/Sales-over-time, Top Regions, Status breakdown), the **Products** tab (Top-Selling, Out-of-Stock, Low Stock), and the injected list-page widgets, all with a date range applied. Cross-check Total Sales for a chosen period against an independent `GET /admin/reports/sales?from=&to=` (BACKEND-08) and the low-stock list against `GET /admin/reports/stock` (BACKEND-08B) — figures must reconcile under the USD/KHR multi-currency rule (BACKEND-01). **Security (`security.md`):** confirm the Analytics page + every plugin route is reachable **only** behind Medusa admin auth (MFA) and is rejected when unauthenticated; confirm only aggregates are shown (no customer phone/address); confirm the storefront and its bundle are untouched.
- **Dependencies**: ANALYTICS-01, BACKEND-08, BACKEND-08B, TEST-06 (reports oracle + fixtures)
- **Deliverables**: `docs/analytics-integration-guide.md` (screens checked, reconciliation result, auth check) — no source changes expected
- **Acceptance Criteria**: every tab/widget renders inside an admin-authed session; an unauthenticated request to the Analytics routes is rejected; plugin Total Sales reconciles with BACKEND-08 for the same period/currency; the low-stock list matches BACKEND-08B; the storefront build/bundle is unchanged.

### ANALYTICS-03: Owner UAT sign-off (human-gated)

- **Objective**: Owner accepts the dashboard for daily use and the version is locked (mirrors KHPAY-06 / PAYWAY-08).
- **Requirements**: Walk the owner through the dashboard on the real admin; confirm the metrics they actually use (daily/weekly sales, low stock for reorder) are present and correct. Record the pinned version and an **upgrade policy**: do not auto-upgrade — re-run the `SETUP-01B` supply-chain checks on any version bump. Decide whether any plugin `options` are needed (default `{}`).
- **Dependencies**: ANALYTICS-02
- **Deliverables**: UAT sign-off notes appended to `docs/analytics-integration-guide.md`
- **Acceptance Criteria**: owner signs off; pinned version recorded; the re-vet-before-bump upgrade policy is documented.
