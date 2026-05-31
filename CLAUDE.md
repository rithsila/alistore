# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ali Store is a mobile-first online clothing storefront for a single-operator shop in Phnom Penh, Cambodia. Customers discover products via Facebook/Telegram links, browse variants (size + color), and pay via Bakong KHQR or Cash-on-Delivery. The system tracks per-variant inventory with stock movement logging.

## Working in this repo

This is a **spec-driven** project. The Medusa backend is scaffolded at `backend/`; the storefront is not yet scaffolded. Before writing any code:

- Read `PRD.md`, `DESIGN.md`, and `ImplementPlan.md`, then implement one task by its ID (`SETUP-XX` / `BACKEND-XX` / `FRONTEND-XX` / `INTEGRATION-XX` / `TEST-XX`) — only what that task's Requirements/Deliverables list, nothing extra.
- Hard constraints live in `.claude/rules/` (`Stack.md`, `Workflow.md`, `design.md`, `security.md`) and load automatically each session. `.agents/rules/` is a mirror for other agent tools — keep the two in sync.
- On any ambiguity around payments, auth, or schema: stop and ask. Never guess.

## Architecture

Two separate repos:

- **`backend/`** — Medusa v2.15.3 (admin MFA enabled), Node 20 LTS, TypeScript. Runs on a Proxmox VM in Cambodia. Hosts the Medusa Admin (built-in).
- **`ali-store-storefront/`** — Next.js 15 (App Router), React 19, Tailwind CSS v4. Deployed on Vercel. Started from the official Medusa Next.js Starter.

```
Customer phone → shop.<domain> (Vercel/Next.js) → Medusa backend (Proxmox VM)
                                                    ├── PostgreSQL (Proxmox VM — UAT/dev + prod)
                                                    ├── Redis (Proxmox prod / in-memory dev)
                                                    ├── Cloudflare R2 (images via img.<domain>)
                                                    ├── Bakong KHQR (via in-Cambodia proxy)
                                                    ├── Telegram Bot API (order alerts)
                                                    └── Facebook OAuth (optional login)
```

## Tech Stack Pinning

All `@medusajs/*` dependencies pinned to exact `2.15.3` (MFA-capable patch). All deps use exact versions (no `^`/`~`). Install with `npm ci`, never `npm install` in deploy. `.npmrc` must have `save-exact=true`.

## Planned Build/Dev Commands

**Backend** (`backend/`):
```bash
npx medusa develop          # start dev server + admin at /app
npx medusa db:migrate       # run database migrations
npx medusa db:generate <Name>  # generate migration for custom modules
```

**Storefront** (`ali-store-storefront/`):
```bash
npm run dev                 # Next.js dev server
```

## Custom Data Models (beyond Medusa core)

- **`stock_movement`** — `id, variant_id, type(in|out|adjust), quantity, reason, order_id?, created_by, created_at`. Tracks all inventory changes.
- **`customer_social_identity`** — `id, customer_id, provider(facebook), provider_user_id, created_at`. Links Facebook logins to customers.

## Custom API Endpoints

Store (public):
- `POST /store/payments/khqr/start` — generate dynamic KHQR + deeplink
- `GET /store/payments/khqr/status?reference=` — poll payment status
- `POST /store/orders/cod` — place COD order
- `GET /store/auth/facebook` + `/callback` — Facebook OAuth flow
- `GET /store/orders/:id/invoice` — printable VAT-ready HTML invoice

Admin:
- `POST /admin/stock-movements` — manual stock-in/adjust
- `GET /admin/reports/sales?from=&to=` — period revenue summary
- `GET /admin/reports/stock?low_threshold=5` — current stock + low-stock list

## Design Tokens

Nike-inspired design with coral accent substitution. Key tokens defined in `DESIGN.md`:

- **Accent/sale color:** coral `#C0461F` (replaces Nike's `#d30005`)
- **Ink:** `#111111`, **Canvas:** `#ffffff`, **Soft-cloud:** `#f5f5f5`
- **Fonts:** Inter (400/500 for UI) + Bebas Neue (96px uppercase campaign headlines)
- **Spacing:** 8px grid base, section rhythm 48px
- **Pill radius:** `999px` for all CTAs
- **Product images:** 1:1 ratio on `#f5f5f5` background, no border-radius

## Key Business Rules

- **Multi-currency:** USD + KHR. Exchange rate from `USD_KHR_RATE` env var. KHR rounds to whole riel (no decimals).
- **Guest checkout only (v1):** phone number is the identifier, no passwords stored.
- **Payment verification:** server-side only via Bakong proxy. Never trust client-reported "paid".
- **Stock reservations:** expire if KHQR unpaid; cancelled orders release reserved stock.
- **Delivery fee:** flat fee with free-delivery threshold, both from env vars.
- **VAT:** invoice is VAT-ready (10% Cambodia standard) but tax is off in v1.
- **English-first v1:** no Khmer font or Khmer UI labels until v2.

## Environment Variables

All secrets via env, never in repo. Key vars: `DATABASE_URL`, `REDIS_URL`, `BAKONG_TOKEN`, `BAKONG_PROXY_URL`, `BAKONG_ACCOUNT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FB_APP_ID`, `FB_APP_SECRET`, `USD_KHR_RATE`, `LOW_STOCK_THRESHOLD` (default 5), `DELIVERY_FEE`, `FREE_DELIVERY_THRESHOLD`.

## Planning Documents

- `PRD.md` — full product requirements, user flows, data model, API design, NFRs
- `ImplementPlan.md` — phased task breakdown (SETUP → BACKEND → FRONTEND → INTEGRATION → TEST)
- `DESIGN.md` — complete design system spec with color tokens, typography, components, responsive behavior
