# Footer Info Pages — FAQ · Delivery · Returns

**Date:** 2026-06-11
**Status:** Design approved — ready for implementation plan
**Scope:** Storefront only (`storefront/`). No backend changes.

## Problem

The site footer (`components/layout/Footer.tsx`) renders five links whose `href` is the
placeholder `"/"`, so they silently reload the homepage:

| Column | Link | Current `href` |
|--------|------|----------------|
| Help | FAQ | `/` |
| Help | Size Guide | `/` |
| Delivery | Delivery Info | `/` |
| Delivery | Track Order | `/` |
| Delivery | Returns | `/` |

On a shop where customers are about to pay, dead links read as broken and erode trust.

`FRONTEND-20` (Footer) only required four *columns* (Help, Delivery, Telegram, Facebook) +
"links"; the specific labels were placeholders invented at implementation time and are not
bound by any spec. We are free to decide what each becomes.

## Scope of this work

In scope: **FAQ**, **Delivery Info**, **Returns** become real pages.

Out of scope (unchanged, still point to `/`): **Size Guide**, **Track Order**. These were
not part of the request. A cheap future stopgap is to repoint both to Telegram; building a
real Track Order page is impossible in v1 (no customer accounts / order lookup — `PRD §2`)
and a Size Guide is its own content task.

## Backend findings (why Returns is a static page, not a flow)

- There are **no custom return/refund/RMA endpoints** in `backend/src/api`. The only
  "return" reference is `is_return: "false"` on the outbound shipping option
  (`seed-shipping.ts:244`) — the system has **no return shipping option at all**.
- Medusa v2.15.3 core includes a full returns/refund/RMA system, but it is **Admin-driven**.
  There is no storefront-facing trigger; building one (return shipping option +
  ownership-scoped `POST /store/returns` + admin handling) is net-new work.
- `PRD §2` explicitly cuts it: *"Returns/refunds workflow — fully manual / out-of-app for v1."*

Therefore Returns is a **static policy page** describing the manual process (customer
messages Telegram/Facebook; operator processes the return inside Medusa Admin). A
self-service return flow is a v2 task.

## Delivery numbers — source of truth

The free-over-$50 rule is the locked **CLARIFY-04** business rule and is **already shown to
customers** in cart and checkout via hardcoded constants:

- `cart/page.tsx:51-53` — `DELIVERY_FEE = 1.5`, `FREE_DELIVERY_THRESHOLD = 50`
- `checkout/page.tsx:61-62` — same two constants

So a Delivery Info page stating "flat $1.50, free over $50" is **consistent with the existing
checkout experience**. No backend endpoint is needed.

**DRY fix (in scope):** these constants are duplicated in two files and the Delivery page
would be a third copy. Extract them once into `lib/delivery.ts`; cart, checkout, and the new
Delivery page all import from there.

> Pre-existing gap, intentionally left alone: the seeded shipping option is always flat $1.50
> and does not encode the $50-free rule server-side (already noted in `seed-shipping.ts` and
> the cart/checkout comments). These pages do not introduce or worsen that gap.

## Architecture

Three static **Server Components** (zero client JS) sharing one new layout component.

### New files

- **`components/layout/InfoPageLayout.tsx`** — shared presentational frame. Renders
  `TopNav`, a centered reading column (`<main>` with `h1` title, optional intro paragraph,
  and `children`), and `Footer`. Props:
  ```ts
  interface InfoPageLayoutProps {
    title: string
    intro?: string
    children: React.ReactNode
  }
  ```
  Tokens only; no accent. The three pages become pure content.
- **`lib/delivery.ts`** — exports `DELIVERY_FEE` (1.5) and `FREE_DELIVERY_THRESHOLD` (50),
  with the CLARIFY-04 provenance comment. Single source of truth.
- **`app/faq/page.tsx`** — FAQ Q&A content (native `<details>/<summary>` accordion).
- **`app/delivery/page.tsx`** — delivery coverage, timing, fee.
- **`app/returns/page.tsx`** — returns/exchange policy.

Each page file exports Next `metadata` (`title`, `description`) for SEO.

### Modified files

- **`components/layout/Footer.tsx`** — rewire the three placeholder `href="/"` entries:
  FAQ → `/faq`, Delivery Info → `/delivery`, Returns → `/returns`. (Footer-only change; no
  TopNav edit — `design.md`'s "update TopNav + Footer together" rule applies to *nav*
  entries, not footer links.)
- **`app/cart/page.tsx`** — import `DELIVERY_FEE` / `FREE_DELIVERY_THRESHOLD` from
  `lib/delivery` instead of redeclaring.
- **`app/checkout/page.tsx`** — same import change.

## Content

### `/faq` — Frequently Asked Questions

Rendered as native `<details>/<summary>` items (collapsible, accessible, zero JS):

1. **How do I order?** — Browse the catalog, add items to your bag, and check out with your
   phone number and delivery address. Pay by KHQR or Cash on Delivery.
2. **What payment methods do you accept?** — Bakong KHQR (scan to pay from any Cambodian
   banking app) or Cash on Delivery.
3. **Can I pay in USD or Riel?** — Prices are shown in USD; switch to KHR with the currency
   toggle in the top bar. KHQR can be paid in either currency.
4. **Where do you deliver and how much?** — Phnom Penh and the provinces. Flat $1.50, free
   over $50. (link → `/delivery`)
5. **Can I exchange an item?** — Yes — size-swaps and exchanges within 3 days. (link →
   `/returns`)
6. **How do I contact you?** — Message us on Telegram or Facebook (links in the footer).

### `/delivery` — Delivery Information

- **Coverage:** Phnom Penh and all provinces.
- **Timing:** Phnom Penh 1–2 business days; provinces 2–4 business days via local courier.
- **Fee:** flat **$1.50**; **free** when your order subtotal is **$50 or more** (rendered
  from `lib/delivery` constants).
- **Cash on Delivery** is available.

### `/returns` — Returns & Exchanges

- **Exchange / size-swap only** (no cash refund), within **3 days** of delivery.
- Item must be **unworn, unwashed, with original tags attached**.
- **To start a return:** message us on Telegram or Facebook with your order details; we'll
  arrange the swap.
- **Return delivery cost:** paid by the customer for size-swaps; free if the item is
  defective or we sent the wrong item.

## Design compliance (`design.md` / `DESIGN.md`)

- Colors: `text-ink`, `text-mute`, `bg-canvas`, `border-hairline` only. **No accent color**
  (reserved for sale price + "Pay with KHQR" CTA). No gradients, shadows, blur. Light-mode
  only.
- Typography: Inter 400/500 only. `h1` page title in `font-medium` (not Bebas — these are
  utility pages, not campaign headlines). `h2` section headings match the footer convention
  (`text-base font-medium text-ink`). Body in `text-mute` with `leading-normal`. Body text
  ≥ 12px.
- Spacing on the 8px grid; section rhythm via existing `py-section` (as Footer uses).
- Semantic HTML first: `<main>`, `<h1>`, `<section>`, `<details>/<summary>`, `<dl>` where
  apt. Links keep visible hover/focus states.
- Reuse existing primitives for any CTA (e.g. an ink `PillButton` "Back to shop") — no new
  buttons invented.
- Mobile-first; verified at 360px width.

## Testing (`web/testing.md`)

A Playwright spec (`@playwright/test`, run via `npm test`) covering:

- Each route (`/faq`, `/delivery`, `/returns`) renders its `h1`.
- Footer links navigate to the correct routes (no more `/` placeholders for these three).
- 360px viewport: no horizontal overflow.
- Basic a11y: single `h1` per page, link names present, color contrast within tokens.

## Tasks

Proposed single task entry, to be appended to `ImplementPlan.md` **only when explicitly
requested** (per `Workflow.md`):

> **FRONTEND-23: Static info pages (FAQ / Delivery / Returns)**
> - Objective: Real footer content pages; remove dead `/` links.
> - Deliverables: `components/layout/InfoPageLayout.tsx`, `lib/delivery.ts`,
>   `app/faq/page.tsx`, `app/delivery/page.tsx`, `app/returns/page.tsx`; footer rewire;
>   cart/checkout import the shared constants.
> - Acceptance: the three footer links open their pages; copy matches this spec; pages pass
>   the Playwright spec at 360px with tokens-only styling.

## Open follow-ups (not this work)

- Size Guide and Track Order footer links remain `/`. Cheap stopgap: repoint both to
  Telegram. Real pages are separate future tasks (Track Order needs v2 accounts/lookup).
- Server-side enforcement of the $50-free-delivery rule (the seeded shipping option is flat
  $1.50) — a pre-existing backend follow-up.
