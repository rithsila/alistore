# Ali Store

Mobile-first online clothing storefront for a single-operator shop in Phnom Penh. Customers arrive from Facebook or Telegram links, pick size and color variants, and pay via Bakong KHQR or Cash on Delivery. The operator runs fulfilment and stock from the Medusa Admin.

Status: pre-scaffold. Only specs and rules live in this repo so far. Code lives in two sibling repos that have not been created yet.

## Stack

Backend is Medusa v2.15.3 (with MFA primitives for the admin) on Node 20 LTS with TypeScript strict, running in a Proxmox VM in Cambodia, backed by Postgres (Supabase free tier in dev, self-hosted on Proxmox in prod) and Redis (Proxmox in prod, in-memory in dev). Storefront is Next.js 15 (App Router) with React 19 and Tailwind CSS v4, deployed on Vercel and started from the official Medusa Next.js Starter. Images use Cloudflare R2 via Medusa's S3 file provider, served through Cloudflare CDN on `img.<domain>`. Payments are Bakong KHQR (Individual account, v1) via a vendored `bakong-payment` module that calls Bakong through an in-Cambodia HTTP proxy on the Proxmox host; Cash on Delivery is the second path. Auth is Medusa Admin auth for the operator, guest checkout plus optional Facebook OAuth for customers. Telegram Bot API sends order alerts. DNS sits on Cloudflare. v1 is English-only; Khmer copy and Khmer font ship in v2.

## Repo layout

```
AliStore/
├── PRD.md                  product requirements, scope, data model, API contracts
├── DESIGN.md               design tokens, components, responsive grid
├── ImplementPlan.md        SETUP / BACKEND / FRONTEND / INTEGRATION / TEST task list
├── CLAUDE.md               instructions loaded by Claude Code
├── .claude/rules/          Stack.md, Workflow.md, security.md
└── docs/                   mockup PNGs
```

Two sibling repos will be created during SETUP-01 and SETUP-10:

```
backend/          Medusa v2 + Admin
└── src/
    ├── api/{store,admin,hooks}/
    ├── modules/{bakong-payment,stock-movement,social-identity}/
    ├── subscribers/  jobs/  workflows/  scripts/  lib/

storefront/       Next.js 15 App Router
└── src/
    ├── app/
    ├── components/{ui,product,layout,checkout}/
    ├── lib/
    └── styles/globals.css
```

## Local setup

Nothing to install yet — the scaffold tasks below have not been run. Once the two repos exist, the loop per repo is:

```bash
# in backend/
cp .env.example .env        # fill the values from the env table below
npm ci
npx medusa db:migrate       # dev only — never run against prod from here
npx medusa exec ./src/scripts/seed.ts   # seed categories
npx medusa develop          # http://localhost:9000, admin at /app

# in storefront/
cp .env.example .env.local
npm ci
npm run dev                 # http://localhost:8000
```

Install with `npm ci`, not `npm install`. `.npmrc` must have `save-exact=true`. All `@medusajs/*` deps are pinned to exact `2.15.3` (the MFA-capable patch); the post-v2.13.6 migration-bug window is the reason `2.15.x` is the floor.

## Environment variables

Filled in `.env` for each repo. Nothing committed.

### Backend (`backend/.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Supabase dev / Proxmox prod) |
| `REDIS_URL` | Redis for events and workflows |
| `BAKONG_TOKEN` | Bakong Open API token |
| `BAKONG_PROXY_URL` | In-Cambodia HTTP proxy for Bakong |
| `BAKONG_ACCOUNT` | KHQR account string (`name@bank`) |
| `TELEGRAM_BOT_TOKEN` | Bot token for order alerts |
| `TELEGRAM_CHAT_ID` | Team chat that receives alerts |
| `FB_APP_ID` | Facebook OAuth app id |
| `FB_APP_SECRET` | Facebook OAuth app secret |
| `USD_KHR_RATE` | Display + KHQR exchange rate |
| `LOW_STOCK_THRESHOLD` | Default 5 |
| `DELIVERY_FEE` | Flat delivery fee |
| `FREE_DELIVERY_THRESHOLD` | Order value for free delivery |
| `S3_*` | Cloudflare R2 keys for file provider |

### Storefront (`storefront/.env.local`)

| Var | Purpose |
|---|---|
| `MEDUSA_BACKEND_URL` | URL of the backend |
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Publishable key — never admin key |

## Common commands

```bash
# backend
npx medusa develop                    # dev server + admin
npx medusa build                      # production build
npx medusa db:generate <ModuleName>   # generate migration for a custom module
npx medusa db:migrate                 # dev only

# storefront
npm run dev
npm run build
npm run lint
npm test
```

## Deployment

Nothing is deployed yet. Target topology is storefront on Vercel (`shop.<domain>`) and backend plus Bakong proxy on a single Proxmox VM in Cambodia (`api.<domain>`), with Postgres and Redis on the same VM in prod. Images go through Cloudflare R2 + CDN on `img.<domain>`. Domain is not yet purchased — see `PRD.md §10` "Still needed from you".

Production migrations are run by a human after review. The agent generates migration files but does not apply them to non-dev databases.

## Specs

- `PRD.md` — what we're building and why: scope, user flows, data model, API contracts, non-functional requirements, locked decisions.
- `DESIGN.md` — Nike-inspired design system with coral `#C0461F` accent: color tokens, Inter + Bebas Neue typography, 8px spacing grid, pill CTAs, product card and filter sidebar specs.
- `ImplementPlan.md` — task-by-task build order across SETUP, BACKEND, FRONTEND, INTEGRATION, and TEST phases. Pick a task by ID and follow its `Requirements` and `Deliverables`.
- `.claude/rules/Stack.md` — locked tech stack, file organization, naming conventions, command list.
- `.claude/rules/security.md` — authz, payment, secrets, and dependency rules that override task wording on conflict.
- `.claude/rules/Workflow.md` — spec-driven development workflow used by Claude Code on this repo.
