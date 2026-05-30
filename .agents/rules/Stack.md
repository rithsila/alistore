# Stack Conventions

## Tech stack (locked)

* **Backend** : Medusa **v2.15.3** (pinned exact; MFA-capable patch; still outside the post-v2.13.6 migration-bug window), Node  **20 LTS** , TypeScript (strict)
* **Storefront** : Next.js **15** (App Router), React 19, TypeScript (strict)
* **Styling** : Tailwind CSS **v4** (CSS-based `@theme` tokens from `DESIGN.md`)
* **Database** : Postgres — Supabase free tier (dev) / Postgres on Proxmox VM (prod). Single `DATABASE_URL` per environment.
* **Cache/events** : Redis (Medusa event bus + workflow engine)
* **File storage** : Cloudflare **R2** via Medusa S3 file provider; served through Cloudflare CDN on `img.<domain>`
* **Payments (v1)** : Bakong KHQR (Individual) via **vendored** `src/modules/bakong-payment/`, called through an in-Cambodia HTTP proxy. No card data. COD as second path.
* **Auth** : Medusa Admin auth with **MFA required** (admin); guest checkout + optional Facebook OAuth (customer)
* **Notifications** : Telegram Bot API (HTTP)
* **DNS/CDN** : Cloudflare
* **Hosting** : Backend on Proxmox VM (Cambodia); storefront on Vercel
* **Language (v1)** : English-first. Fonts: Inter (UI 400/500) + Bebas Neue (campaign 96px). Khmer + Khmer font = v2.

## Repos

* `backend/` — Medusa
* `ali-store-storefront/` — Next.js

## Backend file organization (`backend/src/`)

* `api/store/...` — public storefront routes (file-based, `route.ts`)
* `api/admin/...` — admin routes (require admin auth)
* `api/hooks/...` — internal event endpoints (not public)
* `modules/<name>/` — Medusa modules: `models/`, `service.ts`, `index.ts`, `migrations/`
* `subscribers/` — event subscribers (e.g. `order-placed.ts` for Telegram alerts)
* `jobs/` — scheduled jobs (e.g. `expire-reservations.ts`)
* `workflows/` — Medusa workflows
* `scripts/` — seed and one-off scripts
* `lib/` — shared backend helpers (`settings.ts`, `invoice-template.ts`)

Custom modules in v1: `bakong-payment`, `stock-movement`, `social-identity`.

## Storefront file organization (`ali-store-storefront/src/`)

* `app/` — Next.js App Router routes (`page.tsx`, `layout.tsx`, route handlers)
* `components/ui/` — primitives (`PillButton`, `SearchPill`, `Chip`)
* `components/product/` — `ProductCard`, `ProductGrid`, `VariantPicker`, `FilterSidebar`, `Gallery`, `BuyBox`, `CategoryTabs`
* `components/layout/` — `TopNav`, `Footer`, `Hero`, `BottomBar`
* `components/checkout/` — `DeliveryForm`, `FacebookLogin`
* `lib/` — client helpers (`medusa.ts`, `cart.ts`, `checkout.ts`, `price.ts`, `auth.ts`, `fonts.ts`)
* `styles/globals.css` — Tailwind v4 `@theme` design tokens

## Conventions

* **Server Components by default** in Next.js; only `"use client"` when interactivity demands it (forms, variant picker, KHQR polling).
* **Data fetching** : storefront uses the Medusa JS SDK with the publishable key. Never call the admin API from the storefront.
* **Forms** : submit via server actions or Next route handlers — never POST directly from the client to admin endpoints.
* **Tailwind tokens** : use the named tokens from `DESIGN.md` (`bg-ink`, `text-mute`, `bg-soft-cloud`, `text-accent`, `rounded-pill`). No ad-hoc hex values.
* **Medusa modules** : data model in `models/`, business logic in `service.ts`, registration in `index.ts`. Generate migrations with `npx medusa db:generate <Module>`.
* **Migrations** : Medusa emits timestamped migration files. Never run `db:migrate` against prod from the agent — file generation only; humans apply to prod.
* **Validation** : every custom route handler validates input with **zod** before touching the service layer.
* **Errors** : log server-side with correlation id; return a generic shape to the client.
* **Dependencies** : pin exact (no `^`/`~`), commit lockfiles, install with `npm ci`. Vendor security-critical small packages (`bakong-khqr` logic lives in our own module).
* **No new dependencies** without explicit approval; the locked stack above is the allowed set.

## Environment variables

Defined in `.env.example` (no values committed).

* Backend: `DATABASE_URL`, `REDIS_URL`, `BAKONG_TOKEN`, `BAKONG_PROXY_URL`, `BAKONG_ACCOUNT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `FB_APP_ID`, `FB_APP_SECRET`, `USD_KHR_RATE`, `LOW_STOCK_THRESHOLD`, `DELIVERY_FEE`, `FREE_DELIVERY_THRESHOLD`, R2 keys (`S3_*`).
* Storefront: `MEDUSA_BACKEND_URL`, `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`.

## Commands

* Backend dev: `npx medusa develop`
* Backend build: `npx medusa build`
* Generate migration: `npx medusa db:generate <ModuleName>`
* Run migration (dev only): `npx medusa db:migrate`
* Seed (dev only): `npx medusa exec ./src/scripts/seed.ts`
* Storefront dev: `npm run dev`
* Storefront build: `npm run build`
* Lint: `npm run lint`
* Test: `npm test`
* Install (CI + deploy): `npm ci` — never `npm install` in those paths
