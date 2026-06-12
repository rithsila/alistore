# Analytics Integration Guide — Agilo Analytics Plugin (ANALYTICS-02)

**Plugin:** `@agilo/medusa-analytics-plugin@1.4.0` (exact-pinned, owner-approved 2026-06-12, registered in `backend/medusa-config.ts` under `plugins:` — see ANALYTICS-01).
**Verified:** 2026-06-12, against the dev backend (Medusa v2.15.3, Node 20) on the Proxmox Postgres + Redis (`172.16.18.10`), seeded with the TEST-phase catalog/order fixtures.
**Scope of this task:** verification + documentation only. No source changes. Deliverable is this guide plus the evidence screenshots under `docs/analytics/`.

> **Plugin surface as installed (corrects the ANALYTICS-01 description).** v1.4.0 ships **one admin route page** — "Analytics", listed under **Extensions** in the admin sidebar, at `/app/analytics` — with three tabs: **Orders**, **Products**, **Customers**. Its compiled admin bundle registers **`widgetModule = { widgets: [] }`** — i.e. it injects **no list-page or detail-page widgets**. The "injected list-page widgets for Orders/Products/Customers" mentioned in the ANALYTICS-01 research note do **not** exist in this version; the metrics live entirely on the Analytics page tabs. The Orders list page renders the standard Medusa table with no analytics widget injected (`docs/analytics/03-orders-list-widget.png`). This does not affect the acceptance criteria below — there is simply no widget to render.

---

## 1. Screens checked (behind an admin-authed session)

Logged into Medusa Admin (`/app/login`) as a dev admin, then opened **Analytics**. All three tabs rendered with the date range applied (default preset **This Month**, `2026-06-01 → 2026-06-12`; all seeded orders fall in June 2026, so this preset and an all-time custom range return identical figures).

### Orders tab — `docs/analytics/01-orders-tab.png`
| Widget | Rendered value (This Month) |
|---|---|
| Total Orders (KPI) | **66**  (+100% from previous period) |
| Total Sales (KPI) | **$1,288.50**  (labelled USD, +100% from previous period) |
| Orders Over Time (line) | peak 2026‑06‑10, count 10 |
| Sales Over Time (line, USD) | peak ≈ $1,000 on 2026‑06‑10 |
| Top Regions by Sales (bar) | **Cambodia $1,288.50** |
| Order Status Breakdown (pie) | **100% pending** (66 orders) |

### Products tab — `docs/analytics/02-products-tab.png`
| Widget | Rendered value |
|---|---|
| Top-Selling Products (bar) | Sweatshirt L **20**, Sweatpants S **17**, Sweatpants M **15**, Sweatpants L **13**, Sweatshirt S **10**, T‑Shirt S/Black **1** |
| Out-of-Stock Variants | section present |
| Low Stock Variants | **Medusa Sweatpants XL (SWEATPANTS-XL) = 0** |

### Customers tab — `docs/analytics/04-customers-tab.png`
| Widget | Rendered value |
|---|---|
| Total Customers | 64 |
| New Customers | 64 |
| Returning Customers | 0 |
| Average Sales per Customer | $20.13 |
| New vs. Returning (bar) | present |
| Top Customer Groups by Sales (bar) | No Group ≈ $1,288 |
| Top Customers by Sales (table) | **Name, Email, Order Count, Total Sales, Groups, Last Order** (e.g. `alert-test@example.com` — 2 orders, $48.00, Jun 10 2026) |

---

## 2. Reconciliation against our own reports (BACKEND-08 / 08B)

Both the plugin routes and our report endpoints were called inside the **same** authed admin session over the same window. Our store's default currency is **USD**, so the plugin's currency conversion (see §4) is the identity for these USD orders — the figures match to the cent.

**Total Sales / orders — plugin `/admin/agilo-analytics/orders` vs `GET /admin/reports/sales` (BACKEND-08):**

| Metric | Plugin (Analytics → Orders) | BACKEND-08 `/admin/reports/sales` | Match |
|---|---|---|---|
| Order count | `total_orders` = 66 | `orders` = 66 | ✅ |
| Total sales | `total_sales` = 1288.5 (`currency_code` USD) | `revenue.usd` = 1288.5 | ✅ |
| Region total | Cambodia = 1288.5 | (single region) | ✅ |
| Top seller #1 | Sweatshirt L = 20 | `top_variants[0]` = 20 | ✅ |
| Top sellers (full) | 20 / 17 / 15 / 13 / 10 / 1 | identical ranking & quantities | ✅ |

**Low stock — plugin `/admin/agilo-analytics/products` vs `GET /admin/reports/stock` (BACKEND-08B):**

| Metric | Plugin (Analytics → Products) | BACKEND-08B `/admin/reports/stock` | Match |
|---|---|---|---|
| Low-stock list | `lowStockVariants` = [`SWEATPANTS-XL`, qty 0] | `low_stock` = [Sweatpants XL, qty 0] | ✅ |

> **Currency note (BACKEND-01 multi-currency rule).** BACKEND-08 reports revenue **per currency with no conversion** (`revenue: { usd: 1288.5 }`). The plugin converts every order into the **store default currency** and reports one scalar `total_sales`. They reconcile here because every seeded order is USD and USD is the store default (conversion factor 1.0). **If KHR orders are ever present, the plugin's single `total_sales` will be an FX-converted blend, while BACKEND-08 keeps USD and KHR separate** — compare per-currency against BACKEND-08, not against the plugin's blended scalar.

---

## 3. Security posture (`security.md`)

### Auth — every analytics route is admin-only; unauthenticated requests are rejected
The plugin ships **no `middlewares.ts`**, so its routes inherit Medusa's default `/admin/*` authentication — the same admin-session gate (MFA-enforced in production per `security.md`) that protects our own reports endpoints. Verified live:

| Route | Unauthenticated | Authenticated (admin) |
|---|---|---|
| `GET /admin/agilo-analytics/orders` | **401** | 200 |
| `GET /admin/agilo-analytics/products` | **401** | 200 |
| `GET /admin/agilo-analytics/customers` | **401** | 200 |
| `GET /admin/reports/sales` (BACKEND-08) | **401** | 200 |
| `GET /admin/reports/stock` (BACKEND-08B) | **401** | 200 |

The Analytics **page** itself (`/app/analytics`) is reachable only after admin login — the browser is redirected to `/app/login` when unauthenticated (`docs/analytics/03-orders-list-widget.png` was captured mid-restart and shows the login wall).

### No public route
The plugin's entire backend footprint is exactly three routes, all under `/admin/agilo-analytics/*`. **No `/store/*` route** is registered (static-checked against the shipped bundle). Confirms the ANALYTICS-01 finding.

### Storefront bundle untouched
`@agilo/medusa-analytics-plugin` is a **backend-only** dependency. It is **not referenced anywhere in `storefront/package.json` or `storefront/package-lock.json`**, and its admin-UI runtime deps (recharts, luxon, radix, etc.) compile into the Medusa Admin build only. The Next.js storefront bundle and its Tailwind‑v3 design tokens are unaffected.

### Aggregates vs PII
- **Orders** and **Products** routes return pure aggregates — totals, counts, region names, variant titles, quantities. **No customer PII.**
- **Customers** route/tab is **not aggregate-only**: its "Top Customers by Sales" table exposes per-customer **first/last name + email** alongside sales/order-count (screenshot-confirmed). It does **not** expose **phone or address** (so the task's "no phone/address" criterion holds), but operators should be aware the Customers tab shows customer name + email. This is admin-only (single-operator shop). v1 uses guest checkout (phone is the identifier), so production customer records are sparse; the emails seen here are from test fixtures.

### ⚠️ External egress — third-party FX API (note for owner UAT / production)
The **Orders** and **Customers** routes call **`https://api.frankfurter.dev/v1/latest`** at request time to fetch a currency-rate table (Redis-cached with a daily TTL; the Products route makes no external call). Implications:
- This is an outbound call to a third party **not on any allowlist** and **without the SSRF guard** we apply to Bakong/PayWay/KHPAY. It is a hard-coded vendor URL inside the plugin (not user-controllable), so the SSRF risk is low, but it is an availability dependency: if `frankfurter.dev` is unreachable, the Orders/Customers tabs depend on the cached rate (or the first uncached load can fail).
- For a USD-default single-currency shop the converted value equals the raw value, so the dependency carries no functional benefit today.
- **Recommendation (defer to ANALYTICS-03 / v2):** if the production CSP/egress policy blocks arbitrary outbound hosts, allow `api.frankfurter.dev` for the backend, or treat the Customers/Orders FX path as best-effort. Re-evaluate on any plugin version bump.

---

## 4. How to reproduce this verification

1. Backend env reachable: dev Postgres + Redis at `172.16.18.10` (Redis is the plugin's required Caching Module).
2. Seed fixtures: `npx medusa exec ./src/scripts/seed.ts` + the TEST-phase catalog/order fixtures (`dev-seed-catalog-fixtures.ts`).
3. Start dev server: `npm run dev` (admin at `http://localhost:9000/app`).
4. Admin session: a dev admin user (`npx medusa user -e <email> -p <pw>`); log in at `/app/login`, open **Analytics** under Extensions.
5. API cross-check (Bearer token from `POST /auth/user/emailpass`):
   - `GET /admin/agilo-analytics/orders?preset=custom&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`
   - `GET /admin/agilo-analytics/products?preset=custom&date_from=…&date_to=…`
   - `GET /admin/reports/sales?from=…&to=…` and `GET /admin/reports/stock`
   - Confirm 401 with no `Authorization` header on each.

> Verification artifacts: `docs/analytics/01-orders-tab.png`, `02-products-tab.png`, `03-orders-list-widget.png`, `04-customers-tab.png`. The dev admin `analytics-verify@dev.local` was created in the dev DB solely for this check (MFA not configured on it — in production the same route gate sits behind the MFA-required admin login per `security.md`).

---

## 5. Acceptance criteria — result

| Criterion (verbatim) | Result |
|---|---|
| every tab/widget renders inside an admin-authed session | **Yes** — Orders, Products, Customers tabs all render (screenshots 01/02/04). The plugin ships **no widgets** (`widgetModule.widgets = []`), so there is no list-page widget to render. |
| an unauthenticated request to the Analytics routes is rejected | **Yes** — 401 on all three `/admin/agilo-analytics/*` routes (and on BACKEND-08/08B) with no auth; the `/app/analytics` page redirects to `/app/login`. |
| plugin Total Sales reconciles with BACKEND-08 for the same period/currency | **Yes** — plugin `total_sales` = $1,288.50 USD = BACKEND-08 `revenue.usd` = 1288.5 over the same window (66 orders both sides). Currency caveat in §2. |
| the low-stock list matches BACKEND-08B | **Yes** — both report exactly one low-stock variant: Sweatpants XL (`SWEATPANTS-XL`) = 0. |
| the storefront build/bundle is unchanged | **Yes** — plugin is backend-only; no reference in `storefront/package.json`/lockfile; admin-UI deps never reach the storefront bundle. |

**Open items carried to ANALYTICS-03 (owner UAT):** (a) the Customers tab surfaces customer name + email — confirm acceptable for the operator; (b) the Orders/Customers tabs' external FX call to `api.frankfurter.dev` — confirm production egress/CSP policy; (c) confirm the metrics the owner actually uses (daily/weekly sales, low stock for reorder) and record the re-vet-before-bump upgrade policy.
