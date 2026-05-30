# PRD — Ali Store (Online Clothing Store, v1)

**Owner:** Sila · **Status:** Draft for build · **Stack lead-in:** Medusa v2 + Next.js 15
**Last updated:** 2026-05-27 (rev 2 — open questions resolved)

---

## 1. Problem & Goal

**Who:** A single-operator clothing shop in Phnom Penh whose customers already discover and message via Facebook and Telegram, and increasingly want a real "tap to buy" web storefront instead of DM-only ordering.

**Problem:** Today selling happens in Facebook/Telegram DMs — no catalog, no stock truth, manual price quoting, manual payment confirmation, no record of what sold. RedBox-style hosted storefronts solve the front-end but you own nothing and can't extend them (no real stock-in/out, no invoice, no reports, no control of the payment flow).

**Goal:** A self-owned, mobile-first storefront where a customer browses clothing by category, picks a size/color variant, and either pays online via **Bakong KHQR** or places a **Cash-on-Delivery** order that the team confirms over Telegram/Facebook — with accurate per-variant stock and a simple admin for fulfilment.

**Success criteria (v1):**
- A customer can go from a shared product link → variant → paid (KHQR) or COD-placed order on a phone in under 2 minutes.
- Stock is correct per variant: a sold variant decrements; out-of-stock variants can't be bought.
- Every order is visible in admin with payment status; COD orders trigger a Telegram alert to the team.
- You can answer "what sold this week" and "what's low in stock" without a spreadsheet.

---

## 2. Scope

### In scope (v1)
- Catalog: products with **size + color variants**, organized by **category** (Khmer/English labels).
- Product detail with variant picker and live stock state.
- Cart + guest checkout (no account required).
- **Multi-currency USD + KHR**: customer toggles display currency; KHQR is generated in the selected currency.
- **Phone number required** at checkout; **optional Facebook login** to prefill identity.
- Payment path A: **Bakong KHQR** (dynamic QR + deeplink, poll for confirmation) via in-Cambodia proxy. **Individual KHQR for v1** (account type is config-driven → upgrade to Merchant later).
- Payment path B: **Cash on Delivery** → order placed as *pending confirmation* → Telegram alert to team + on-screen links to Facebook page / Telegram support.
- **Delivery fee**: configurable flat fee, with **free delivery over an order-value threshold** (amounts TBD by you).
- **Per-variant inventory** with manual "stock in" (receiving) in admin; auto "stock out" on order.
- **Stock movement log** (in/out/adjust) for a basic stock report.
- **VAT-ready printable HTML invoice** (optional VAT line + TIN field; 0% / hidden in v1).
- Basic **reports**: sales summary (period revenue/orders) + current stock & low-stock list (default threshold 5, configurable).
- Admin = **Medusa Admin** (built-in), used as-is for products, orders, fulfilment.
- **CSV product/variant import** for bulk catalog loading.
- Fast images via Cloudflare R2 + CDN + Next.js `<Image>`.
- Custom domain on Cloudflare DNS.

### Out of scope (defer to v2) — *cut aggressively*
- 🔴 **ABA PayWay** integration (you chose KHQR for v1) — defer.
- 🔴 **TikTok login** (app review + weak tooling; fights "ASAP") — defer.
- **Merchant KHQR upgrade** — v1 ships on Individual KHQR; merchant facility is a fast-follow (needed when VAT/limits demand it).
- **Charging VAT** — invoice is VAT-ready but tax is off in v1.
- Customer **accounts / order history / saved addresses** — guest + phone only in v1.
- **Staff logins & roles** (you said staff don't update stock now) — single admin in v1.
- **PDF invoices, branded invoice templates** — printable HTML only in v1.
- **Returns/refunds workflow** — fully manual / out-of-app for v1.
- **Discount codes, promotions, bundles, wishlists, reviews, search-as-you-type.**
- **Multi-language admin / CMS-managed translations** — hardcode Khmer/EN strings.
- **Telegram bot ordering / mini-app**, automated dispatch, delivery-partner integration.
- **Custom-built admin dashboard** — use Medusa Admin; build custom report pages only if Medusa widgets aren't enough.

---

## 3. User Flows

> **Flow conventions:** the browse→variant→cart→checkout→confirm skeleton is standard for any clothing store and should not be "fixed." The deliberately localized steps are (a) KHQR scan-and-poll instead of a card form, and (b) COD that routes to a human confirmation via Telegram/Facebook. Keep those as-is.

### 3.1 Browse → buy with Bakong KHQR (primary)
1. Customer opens a shared product link (from FB/Telegram) on their phone.
2. Sees product, selects **color**, then **size**; UI shows in-stock state per variant; out-of-stock variants disabled. Currency toggle (USD/KHR) shows price in chosen currency.
3. Adds to cart → opens cart → taps **Checkout**.
4. Optional: taps **Continue with Facebook** (prefills name); otherwise stays guest.
5. Enters **phone (required)**, full name, delivery address, optional note.
6. Selects **Bakong KHQR** → taps **Place order**.
7. Backend reserves stock, creates order (`pending payment`), calls Bakong (via proxy) to generate a **dynamic KHQR + deeplink** in the selected currency.
8. Customer scans QR in any banking app (or taps deeplink) and pays.
9. Confirmation screen **polls** backend every ~3s; backend checks Bakong (via proxy) by md5/reference.
10. On success → order `paid`, stock reservation committed, invoice link shown, Telegram alert sent. On timeout/expiry → QR expired screen with "regenerate" option.

### 3.2 Browse → buy with Cash on Delivery
1. Steps 1–5 as above.
2. Selects **Cash on Delivery** → taps **Place order**.
3. Backend reserves stock, creates order (`pending confirmation`, unpaid).
4. Confirmation screen shows: "Our team will contact you to confirm" + buttons to **Facebook page** and **Telegram support**.
5. **Telegram alert** with order details posted to the team chat.
6. Team calls/messages the customer to confirm; in Medusa Admin they mark the order **confirmed** (or cancel → stock released).

### 3.3 Admin: stock in (receiving)
1. Owner opens Medusa Admin → product → variant.
2. Updates the inventory level (stock in); a **stock movement (type=in)** record is written with quantity + note.
3. Storefront immediately reflects new availability.

### 3.4 Admin: fulfil an order
1. Owner opens order in Medusa Admin → sees items, variants, payment status, delivery info.
2. Marks fulfilled/shipped; for COD marks paid on delivery.
3. Opens **invoice** (printable HTML) if needed.

### 3.5 Admin: weekly check
1. Owner opens **Reports**: sales summary for a date range (orders, revenue, top variants).
2. Opens **stock report**: current quantity per variant + low-stock list (below threshold).

---

## 4. Data Model

Most of this is **Medusa v2 core** (don't rebuild it). Only `stock_movement` and the social-identity link are custom.

**Core (provided by Medusa):**
- `product` — title, handle, status, category, images
- `product_category` — Khmer/English name (the storefront tabs)
- `product_option` / `option_value` — Size {S,M,L,XL}, Color {Beige,Black,…}
- `product_variant` — one per size×color combo; SKU, price (USD + KHR)
- `inventory_item` + `inventory_level` — stocked qty per variant per location (the stock truth)
- `cart` / `line_item`
- `order` — `payment_status`, `fulfillment_status`, custom status for COD confirmation
- `customer` — guest allowed; **phone** captured
- `region` / `currency` — USD + KHR
- `payment_collection` / `payment_session` / `payment` — Bakong via **custom payment provider**

**Custom (you add):**
- `stock_movement` — `id, variant_id, type(in|out|adjust), quantity, reason, order_id?, created_by, created_at`
- `customer_social_identity` — `id, customer_id, provider(facebook), provider_user_id, created_at`

```
product_category 1───* product 1───* product_variant 1───1 inventory_item 1───* inventory_level
                                            │
                                            │ 1
                                            ▼ *
                                      stock_movement *───? order
                                                              │ *
                                                              ▼ 1
                                                          customer 1───* customer_social_identity
                                                              │
                                                       order 1───1 payment_collection 1───* payment
                                          (cart ─── line_item ─── product_variant)
```

---

## 5. Tech Stack — *locked, prefer what you know*

> Pin every dependency to an **exact** version (no `^`/`~`) and commit lockfiles; install with `npm ci`. Backend is on Medusa **v2.15.3** (current stable; adds Multi-Factor Authentication primitives for the admin; still avoids the post-v2.13.6 migration-bug window). See ImplementPlan SETUP-01B for supply-chain hardening.

- **Backend:** Medusa **v2.15.3** (pinned stable, MFA-capable), Node **20 LTS**, TypeScript — runs in a **Proxmox VM in Cambodia** (you have this).
- **Storefront:** Next.js **15** (App Router), React **19**, Tailwind CSS **v4** on **Vercel** — start from the official **Medusa Next.js Starter** and restyle.
- **Admin:** Medusa Admin (built-in, free, unlimited users) — no custom admin in v1.
- **Database:** PostgreSQL (**Supabase-hosted**; Medusa owns the schema). *Option:* self-host Postgres on the same Proxmox if you prefer keeping data in-country (see Open Qs).
- **Cache/events:** Redis on the Proxmox VM in prod; Medusa in-memory in dev.
- **Images:** **Cloudflare R2** (S3-compatible, no egress) via Medusa S3 file provider; served through **Cloudflare CDN**; rendered with Next.js `<Image>`.
- **DNS/CDN:** Cloudflare (custom domain, bought after build).
- **Payments:** `bakong-khqr` (+ `@types/bakong-khqr`) in a custom Medusa payment provider, calling Bakong **through your in-Cambodia proxy on Proxmox**. Account type (Individual v1) is config.
- **Currency:** Medusa multi-currency store, USD + KHR.
- **Notifications:** Telegram Bot API (HTTP) for team order alerts.
- **Social login:** Facebook Login (OAuth) only in v1.
- **Dev tooling:** Claude Code + Medusa MCP — **staging/sandbox only** (see §9).

---

## 6. Architecture Overview

```
                       ┌────────────────────── Cloudflare (DNS + CDN) ──────────────────────┐
        Customer phone │                                                                    │
   (FB / Telegram link)│   shop.<domain>  (Vercel)        img.<domain> (R2 + CDN)           │
            │          │            │                              ▲                         │
            ▼          ▼            ▼                              │ images                  │
   ┌──────────────────────┐   ┌───────────────────────────┐  ┌──────────────┐               │
   │ Next.js 15 Storefront │──▶│  Medusa v2 backend+Admin   │─▶│ Cloudflare R2 │              │
   │ (Vercel)              │◀──│  + Bakong proxy            │  └──────────────┘               │
   └──────────────────────┘   │  (Proxmox VM, in Cambodia) │                                 │
                              └──────┬───────┬──────┬───────┘                                 │
                          Postgres   │       │Redis │ proxy                                   │
                        (Supabase) ◀─┘       ▼      └──▶ Bakong Open API (KHQR gen + check)    │
                                          ┌───────┐                                           │
                                          │ events│         ── Telegram Bot API ──▶ team chat │
                                          └───────┘         ── Facebook OAuth ──▶ FB login     │
                                                                                              ┘
```

**External integrations:** Bakong KHQR (via in-KH proxy), Facebook OAuth, Telegram Bot API, Cloudflare R2/CDN.

**Auth strategy:**
- **Admin:** Medusa Admin auth (you only), with **Multi-Factor Authentication** required (Medusa v2.15.3 MFA primitives — TOTP or email-code second factor).
- **Customer:** guest by default; **phone is the identifier**. Optional Facebook OAuth → `customer_social_identity`. No passwords stored.

**Data flow — KHQR order (main action):**
`Storefront places order → Medusa reserves inventory + creates order(pending) → payment provider calls Bakong via proxy → returns QR/deeplink → storefront shows QR + polls → provider polls Bakong via proxy → on PAID: order=paid, reservation committed, stock_movement(out), Telegram alert, invoice available.`

---

## 7. API Design *(custom endpoints only — Medusa's Store/Admin APIs are reused as-is; if this overflows one page, v1 is too big)*

**Payments — Bakong** *(store)*
- `POST /store/payments/khqr/start` · auth: cart/session · body `{cart_id, currency}` · → `{qr, deeplink, reference, expires_at}` · err 409 out-of-stock, 502 proxy/Bakong down · → **BACKEND-03**
- `GET /store/payments/khqr/status?reference=` · auth: session · → `{status: pending|paid|expired}` · err 404 · → **BACKEND-03**

**Orders — COD** *(store)*
- `POST /store/orders/cod` · auth: session · body `{cart_id, phone, name, address, note}` · → `{order_id, status:"pending_confirmation"}` · err 409 out-of-stock · → **BACKEND-04**

**Auth — social** *(store)*
- `GET /store/auth/facebook` · auth: none · → redirect to FB · → **BACKEND-05**
- `GET /store/auth/facebook/callback` · auth: none · query `{code}` · → session + `{customer}` · err 401 · → **BACKEND-05**

**Invoice** *(store)*
- `GET /store/orders/:id/invoice` · auth: order-token · → printable HTML (VAT-ready) · err 403/404 · → **BACKEND-06**

**Inventory & reports** *(admin)*
- `POST /admin/stock-movements` · auth: admin · body `{variant_id, type, quantity, reason}` · → `{movement}` · → **BACKEND-07**
- `GET /admin/reports/sales?from=&to=` · auth: admin · → `{orders, revenue, top_variants[]}` · → **BACKEND-08**
- `GET /admin/reports/stock?low_threshold=5` · auth: admin · → `{levels[], low_stock[]}` · → **BACKEND-08**

**Webhook (internal)**
- `POST /hooks/order-placed` *(internal event handler, not public)* → sends Telegram alert · → **BACKEND-09**

*Catalog load uses Medusa Admin's built-in CSV product import → **BACKEND-02** (template + import run), not a custom endpoint.*

---

## 8. UI/UX Requirements

**Style direction:** Mobile-first, fast, uncluttered — match the Ali Store reference: white background, coral/red accent, rounded product cards in a 2-up grid, big tap targets, Khmer + English labels, strike-through original price + sale price, USD/KHR toggle. Optimized for **in-app browsers** (Facebook/Telegram) on mid-range Android.

**Key pages:**
- **Home / Catalog** — category tabs + product grid; the share-friendly landing.
- **Category** — filtered product grid.
- **Product detail** — image gallery, color then size picker, live stock state, currency toggle, add-to-cart.
- **Cart** — line items with variant, qty steppers, subtotal, delivery-fee/free-over-threshold note.
- **Checkout** — payment choice (KHQR / COD), delivery info, phone required, optional FB login.
- **KHQR pay** — QR + deeplink + countdown + auto-poll status.
- **Order confirmation** — paid receipt **or** COD "we'll call you" + FB/Telegram links + invoice link.
- **Admin (Medusa)** — products/variants, orders, stock-in, CSV import; **Reports** page (sales + stock).

---

## 9. Non-Functional Requirements

- **Performance:** First product view LCP < 2.5s on 4G; responsive `<Image>` lazy-load + R2/CDN caching. Many images is the main risk — enforce sized, compressed (WebP/AVIF) uploads.
- **Multi-currency:** USD + KHR. Use a single configured exchange rate for display + KHQR amount; round KHR to whole riel (no decimals). Settlement currency follows the customer's selected pay currency.
- **Security:** **No card data ever** (KHQR + COD only) → minimal PCI scope. Secrets (Bakong token, proxy URL, FB app secret, Telegram token) in env, never in repo/storefront. Proxy reachable only from the backend; backend validates `BAKONG_PROXY_URL` against an allowlist and refuses private/loopback addresses (SSRF guard). Verify Bakong responses (md5/reference) server-side; never trust client-reported "paid". **Admin MFA is mandatory** — a single-factor admin login is not acceptable for an account that controls inventory, orders, and payments. Full ruleset in `.claude/rules/security.md`.
- **Authorization (RLS note):** Medusa enforces authz at its **API layer**, not Postgres RLS — Supabase RLS does **not** govern Medusa tables. Apply RLS only to tables you create directly in Supabase outside Medusa (if any).
- **Browsers/mobile:** Latest mobile Chrome/Safari **and** Facebook/Telegram in-app browsers; test OAuth + polling inside in-app browsers specifically.
- **Accessibility:** Adequate contrast, labeled inputs, keyboard-usable forms; verify Khmer font rendering and line-breaking.
- **Reliability:** Stock reservations expire if KHQR unpaid; idempotent payment-status checks; order alerts retried if Telegram send fails.

---

## 10. Open Questions

### Resolved (this revision)
- **Currency:** USD + KHR (display toggle; pay in selected currency).
- **Proxy + backend:** both on your **Proxmox VM in Cambodia**.
- **Hosting split:** storefront on **Vercel**, backend/admin on Proxmox.
- **Social login:** Facebook in v1; **TikTok deferred to v2**.
- **Returns/refunds:** fully manual / out-of-app for v1.
- **Bakong account type:** **Individual KHQR for v1** (config-driven); upgrade to Merchant as a fast-follow when VAT/limits require.
- **Low-stock threshold:** default **5**, configurable (per-variant override later).
- **Product import:** **CSV import** via Medusa Admin (one row per variant).
- **Invoice/VAT:** **VAT-ready** invoice (optional VAT line + TIN), tax **off** in v1.

### Still needed from you (will provide later)
1. **Domain name** (and OK with `shop.` + `img.` subdomains?).
2. **Delivery fee amount** and the **free-delivery order-value threshold**.
3. **Telegram chat/group ID** for alerts + which fields the alert must include.
4. **Bakong credentials:** confirm Individual, your `bank_account` (`name@bank`), and dev/production token readiness.
5. **USD↔KHR exchange rate:** confirm the fixed rate to use (e.g. 4100), and whether it's admin-editable.
6. **Database location:** keep Postgres on Supabase, or self-host on Proxmox (in-country)?
7. **When VAT turns on:** confirm 10% standard rate + your TIN for the invoice.
8. **Product data:** what format is your current stock list, so we can map it to the CSV import template?
