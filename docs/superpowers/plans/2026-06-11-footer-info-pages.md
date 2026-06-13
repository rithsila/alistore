# Footer Info Pages (FAQ · Delivery · Returns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three dead footer links (FAQ, Delivery Info, Returns) into real static content pages and rewire the footer to them.

**Architecture:** Three static Server Component routes (`/faq`, `/delivery`, `/returns`) share one new presentational frame component, `InfoPageLayout`, which renders `TopNav` + a reading column. The site `Footer` is already mounted globally in the root layout (`app/layout.tsx:26`), so it is NOT rendered by the pages — this matches the cart/checkout pages, which render only `TopNav` per page. Delivery pricing constants are extracted from `cart`/`checkout` into one shared module so all surfaces read the same numbers. No backend changes.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (strict), Tailwind v3.4.19 (design tokens in `tailwind.config.js`), Playwright (`@playwright/test`, run with `npm test`).

**Design constraints (`.claude/rules/design.md`):** tokens only (`text-ink`, `text-mute`, `bg-canvas`, `border-hairline`); **no accent color** (reserved for sale price + KHQR CTA); Inter 400/500 only; no shadows/gradients; light-mode only; 8px spacing grid; mobile-first, verified at 360px.

**Spec:** `docs/superpowers/specs/2026-06-11-footer-info-pages-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `storefront/src/lib/delivery.ts` | Create | Single source for `DELIVERY_FEE` / `FREE_DELIVERY_THRESHOLD` |
| `storefront/src/app/cart/page.tsx` | Modify | Import the two constants instead of redeclaring (lines 51-53) |
| `storefront/src/app/checkout/page.tsx` | Modify | Import the two constants instead of redeclaring (lines 61-63) |
| `storefront/src/components/layout/InfoPageLayout.tsx` | Create | Shared frame: `TopNav` + reading column (Footer is global, from root layout) |
| `storefront/src/app/faq/page.tsx` | Create | FAQ content (native `<details>` accordion) |
| `storefront/src/app/delivery/page.tsx` | Create | Delivery coverage / timing / fee |
| `storefront/src/app/returns/page.tsx` | Create | Returns & exchange policy |
| `storefront/src/components/layout/Footer.tsx` | Modify | Rewire 3 `href="/"` → `/faq` `/delivery` `/returns` |
| `storefront/tests/info-pages.spec.ts` | Create | Playwright coverage for all of the above |

**Prerequisite for the Playwright steps:** storefront dev server running on `:8000` (`cd storefront && npm run dev`). The backend (`:9000`) is recommended but not required by these specs — the pages fetch no data. Run all `npm test` / `npx playwright` commands from inside `storefront/`.

---

## Task 1: Shared delivery constants + DRY refactor

**Files:**
- Create: `storefront/src/lib/delivery.ts`
- Modify: `storefront/src/app/cart/page.tsx:51-53`
- Modify: `storefront/src/app/checkout/page.tsx:61-63`

- [ ] **Step 1: Create the constants module**

Create `storefront/src/lib/delivery.ts`:

```ts
/**
 * Delivery pricing constants (CLARIFY-04, locked).
 *
 * Single source of truth for the storefront's delivery rule — a flat USD fee,
 * free once the subtotal reaches the threshold. Previously duplicated in
 * `app/cart/page.tsx` and `app/checkout/page.tsx`; both now import from here, as
 * does the `/delivery` info page (FRONTEND-23), so the displayed rule can never
 * drift between surfaces.
 *
 * USD major units (1.5 = $1.50). KHR display is derived at render time via the
 * shared `@lib/price` formatter; these values stay in USD.
 *
 * NOTE: server-side enforcement of the free-over-threshold rule lives in the
 * Medusa shipping option (backend), which is currently a flat fee — see
 * `backend/src/scripts/seed-shipping.ts`. These constants drive storefront
 * *display* only.
 */

/** Flat delivery fee in USD. */
export const DELIVERY_FEE = 1.5

/** Order subtotal (USD) at or above which delivery is free. */
export const FREE_DELIVERY_THRESHOLD = 50
```

- [ ] **Step 2: Point the cart page at the shared module**

In `storefront/src/app/cart/page.tsx`, delete the local declaration (lines 51-53):

```tsx
// CLARIFY-04 (locked): flat delivery fee $1.50, free once subtotal ≥ $50.
const DELIVERY_FEE = 1.5
const FREE_DELIVERY_THRESHOLD = 50
```

Add the import alongside the other `@lib` imports near the top of the file (after the existing `import { useCurrency } from "@lib/currency-context"` line):

```tsx
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@lib/delivery"
```

- [ ] **Step 3: Point the checkout page at the shared module**

In `storefront/src/app/checkout/page.tsx`, delete the identical local declaration (lines 61-63):

```tsx
// CLARIFY-04 (locked): flat delivery fee $1.50, free once subtotal ≥ $50.
const DELIVERY_FEE = 1.5
const FREE_DELIVERY_THRESHOLD = 50
```

Add the same import alongside the file's other `@lib` imports:

```tsx
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@lib/delivery"
```

- [ ] **Step 4: Type-check to verify the refactor is behavior-preserving**

Run (from `storefront/`): `npx tsc --noEmit`
Expected: PASS (no errors). If `tsc` reports unrelated pre-existing errors, instead run `npm run lint` and confirm no new errors reference `cart/page.tsx`, `checkout/page.tsx`, or `lib/delivery.ts`.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/lib/delivery.ts storefront/src/app/cart/page.tsx storefront/src/app/checkout/page.tsx
git commit -m "refactor: extract delivery fee constants into shared lib/delivery"
```

---

## Task 2: InfoPageLayout + FAQ page

**Files:**
- Create: `storefront/src/components/layout/InfoPageLayout.tsx`
- Create: `storefront/src/app/faq/page.tsx`
- Test: `storefront/tests/info-pages.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `storefront/tests/info-pages.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

/**
 * FRONTEND-23 — static footer info pages (FAQ / Delivery / Returns).
 *
 * Runs against the storefront dev server (:8000). The pages fetch no data, so
 * the backend is optional. Viewports are set per-test where a breakpoint matters
 * (DESIGN.md: mobile baseline is 360px).
 */
test.describe("footer info pages (FRONTEND-23)", () => {
  test("FAQ page renders its heading and questions", async ({ page }) => {
    await page.goto("/faq", { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("heading", { level: 1, name: "Frequently Asked Questions" })
    ).toBeVisible()
    await expect(page.getByText("How do I order?")).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `storefront/`): `npx playwright test info-pages -g "FAQ page renders"`
Expected: FAIL — `/faq` returns Next's 404, so the `h1` is not found.

- [ ] **Step 3: Create the shared layout component**

Create `storefront/src/components/layout/InfoPageLayout.tsx`:

```tsx
import type { ReactNode } from "react"
import TopNav from "./TopNav"

/**
 * Shared frame for the static info pages (FAQ / Delivery / Returns — FRONTEND-23).
 *
 * Renders the top nav and a centered reading column for page content passed as
 * `children`. The site Footer is mounted once globally in the root layout
 * (`app/layout.tsx`), so this layout deliberately does NOT render it — matching
 * the cart/checkout pages, which also render only `TopNav` per page.
 *
 * A Server Component: it has no interactivity of its own and only composes the
 * existing nav (TopNav is a Client Component — a Server Component may render it)
 * with page content.
 *
 * Tokens only (design.md): ink heading, mute body, canvas surface. No accent
 * (reserved for sale price + the KHQR CTA), no shadows/gradients. Inter 400/500.
 * Reading column caps at `max-w-3xl` for comfortable line length; section rhythm
 * uses the 8px-grid `section` (48px) token, matching the Footer.
 */
interface InfoPageLayoutProps {
  title: string
  intro?: string
  children: ReactNode
}

export default function InfoPageLayout({
  title,
  intro,
  children,
}: InfoPageLayoutProps) {
  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium leading-tight text-ink">{title}</h1>
        {intro ? (
          <p className="mt-4 text-base font-normal leading-normal text-mute">
            {intro}
          </p>
        ) : null}
        <div className="mt-xl flex flex-col gap-xl">{children}</div>
      </main>
    </>
  )
}
```

- [ ] **Step 4: Create the FAQ page**

Create `storefront/src/app/faq/page.tsx`:

```tsx
import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import InfoPageLayout from "../../components/layout/InfoPageLayout"

export const metadata: Metadata = {
  title: "FAQ — Ali Store",
  description:
    "Answers to common questions about ordering, payment, delivery, and exchanges at Ali Store.",
}

interface FaqItem {
  question: string
  answer: ReactNode
}

/** Inline link style for answers — ink underline, no accent (design.md). */
const FAQ_LINK =
  "text-ink underline underline-offset-2 transition-opacity hover:opacity-70"

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "How do I order?",
    answer:
      "Browse the catalog, add items to your bag, and check out with your phone number and delivery address. Pay by KHQR or Cash on Delivery.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "Bakong KHQR — scan to pay from any Cambodian banking app — or Cash on Delivery.",
  },
  {
    question: "Can I pay in US Dollars or Riel?",
    answer:
      "Prices are shown in USD; switch to KHR with the currency toggle in the top bar. KHQR can be paid in either currency.",
  },
  {
    question: "Where do you deliver and how much does it cost?",
    answer: (
      <>
        We deliver across Phnom Penh and the provinces. Delivery is a flat $1.50,
        free on orders over $50. See{" "}
        <Link href="/delivery" className={FAQ_LINK}>
          Delivery Info
        </Link>{" "}
        for details.
      </>
    ),
  },
  {
    question: "Can I exchange or return an item?",
    answer: (
      <>
        Yes — size-swaps and exchanges within 3 days. See our{" "}
        <Link href="/returns" className={FAQ_LINK}>
          Returns &amp; Exchanges
        </Link>{" "}
        policy.
      </>
    ),
  },
  {
    question: "How do I contact you?",
    answer:
      "Message us on Telegram or Facebook — the links are in the footer below.",
  },
]

export default function FaqPage() {
  return (
    <InfoPageLayout
      title="Frequently Asked Questions"
      intro="Everything you need to know about ordering, paying, and delivery."
    >
      <div className="flex flex-col">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.question}
            className="group border-b border-hairline py-4"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink transition-opacity hover:opacity-70 [&::-webkit-details-marker]:hidden">
              {item.question}
              <span
                aria-hidden="true"
                className="text-mute transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <div className="mt-2 text-sm font-normal leading-normal text-mute">
              {item.answer}
            </div>
          </details>
        ))}
      </div>
    </InfoPageLayout>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run (from `storefront/`): `npx playwright test info-pages -g "FAQ page renders"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add storefront/src/components/layout/InfoPageLayout.tsx storefront/src/app/faq/page.tsx storefront/tests/info-pages.spec.ts
git commit -m "feat: add FAQ page + shared InfoPageLayout"
```

---

## Task 3: Delivery Info page

**Files:**
- Create: `storefront/src/app/delivery/page.tsx`
- Test: `storefront/tests/info-pages.spec.ts` (add a test)

- [ ] **Step 1: Add the failing test**

Append inside the `test.describe` block in `storefront/tests/info-pages.spec.ts`:

```ts
  test("Delivery page shows the fee and the free-over-threshold", async ({
    page,
  }) => {
    await page.goto("/delivery", { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("heading", { level: 1, name: "Delivery Information" })
    ).toBeVisible()
    // Flat $1.50, free over $50 — the locked CLARIFY-04 rule.
    await expect(page.getByText("$1.50")).toBeVisible()
    await expect(page.getByText(/\$50/)).toBeVisible()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `storefront/`): `npx playwright test info-pages -g "Delivery page shows"`
Expected: FAIL — `/delivery` 404s, heading not found.

- [ ] **Step 3: Create the Delivery page**

Create `storefront/src/app/delivery/page.tsx`:

```tsx
import type { Metadata } from "next"
import InfoPageLayout from "../../components/layout/InfoPageLayout"
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@lib/delivery"

export const metadata: Metadata = {
  title: "Delivery Info — Ali Store",
  description:
    "Delivery coverage, timing, and fees for Ali Store orders across Cambodia.",
}

/** USD labels from the shared constants — single source of truth (@lib/delivery). */
const FEE_LABEL = `$${DELIVERY_FEE.toFixed(2)}`
const FREE_LABEL = `$${FREE_DELIVERY_THRESHOLD}`

interface InfoRow {
  term: string
  detail: string
}

const DELIVERY_ROWS: readonly InfoRow[] = [
  { term: "Coverage", detail: "Phnom Penh and all provinces across Cambodia." },
  { term: "Phnom Penh", detail: "1–2 business days." },
  { term: "Provinces", detail: "2–4 business days via local courier." },
  {
    term: "Delivery fee",
    detail: `Flat ${FEE_LABEL} — free on orders of ${FREE_LABEL} or more.`,
  },
  {
    term: "Cash on Delivery",
    detail: "Available — pay in cash when your order arrives.",
  },
]

export default function DeliveryPage() {
  return (
    <InfoPageLayout
      title="Delivery Information"
      intro="How and when your order reaches you, and what delivery costs."
    >
      <dl className="flex flex-col gap-4">
        {DELIVERY_ROWS.map((row) => (
          <div
            key={row.term}
            className="flex flex-col gap-1 border-b border-hairline pb-4 min-[600px]:flex-row min-[600px]:gap-6"
          >
            <dt className="text-base font-medium text-ink min-[600px]:w-48 min-[600px]:shrink-0">
              {row.term}
            </dt>
            <dd className="text-sm font-normal leading-normal text-mute">
              {row.detail}
            </dd>
          </div>
        ))}
      </dl>
    </InfoPageLayout>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `storefront/`): `npx playwright test info-pages -g "Delivery page shows"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/app/delivery/page.tsx storefront/tests/info-pages.spec.ts
git commit -m "feat: add Delivery Info page"
```

---

## Task 4: Returns page

**Files:**
- Create: `storefront/src/app/returns/page.tsx`
- Test: `storefront/tests/info-pages.spec.ts` (add a test)

- [ ] **Step 1: Add the failing test**

Append inside the `test.describe` block in `storefront/tests/info-pages.spec.ts`:

```ts
  test("Returns page states the 3-day exchange policy", async ({ page }) => {
    await page.goto("/returns", { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("heading", { level: 1, name: "Returns & Exchanges" })
    ).toBeVisible()
    await expect(page.getByText(/within 3 days/)).toBeVisible()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `storefront/`): `npx playwright test info-pages -g "Returns page states"`
Expected: FAIL — `/returns` 404s, heading not found.

- [ ] **Step 3: Create the Returns page**

Create `storefront/src/app/returns/page.tsx`:

```tsx
import type { Metadata } from "next"
import InfoPageLayout from "../../components/layout/InfoPageLayout"

export const metadata: Metadata = {
  title: "Returns & Exchanges — Ali Store",
  description:
    "Ali Store's exchange and size-swap policy, and how to start a return.",
}

interface PolicyPoint {
  heading: string
  body: string
}

const POLICY: readonly PolicyPoint[] = [
  {
    heading: "Exchanges & size-swaps only",
    body: "We offer exchanges or size-swaps within 3 days of delivery. We don't process cash refunds.",
  },
  {
    heading: "Item condition",
    body: "Items must be unworn, unwashed, and have their original tags attached.",
  },
  {
    heading: "How to start a return",
    body: "Message us on Telegram or Facebook (links in the footer) with your order details, and we'll arrange the swap.",
  },
  {
    heading: "Return delivery cost",
    body: "Return delivery for a size-swap is paid by the customer. If an item is defective or we sent the wrong one, we cover it.",
  },
]

export default function ReturnsPage() {
  return (
    <InfoPageLayout
      title="Returns & Exchanges"
      intro="Our exchange policy — simple, fast, and handled personally."
    >
      <div className="flex flex-col gap-xl">
        {POLICY.map((point) => (
          <section key={point.heading} className="flex flex-col gap-2">
            <h2 className="text-base font-medium text-ink">{point.heading}</h2>
            <p className="text-sm font-normal leading-normal text-mute">
              {point.body}
            </p>
          </section>
        ))}
      </div>
    </InfoPageLayout>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `storefront/`): `npx playwright test info-pages -g "Returns page states"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/app/returns/page.tsx storefront/tests/info-pages.spec.ts
git commit -m "feat: add Returns & Exchanges page"
```

---

## Task 5: Rewire the footer + responsive guard

**Files:**
- Modify: `storefront/src/components/layout/Footer.tsx:47,55,57`
- Test: `storefront/tests/info-pages.spec.ts` (add two tests)

- [ ] **Step 1: Add the failing tests**

Append inside the `test.describe` block in `storefront/tests/info-pages.spec.ts`:

```ts
  test("footer links navigate to the info pages", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
    const footer = page.locator("footer")
    await expect(footer.getByRole("link", { name: "FAQ" })).toHaveAttribute(
      "href",
      "/faq"
    )
    await expect(
      footer.getByRole("link", { name: "Delivery Info" })
    ).toHaveAttribute("href", "/delivery")
    await expect(footer.getByRole("link", { name: "Returns" })).toHaveAttribute(
      "href",
      "/returns"
    )
  })

  test("info pages have no horizontal overflow at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const path of ["/faq", "/delivery", "/returns"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" })
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      )
      expect(overflows, `${path} should not overflow at 360px`).toBe(false)
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `storefront/`): `npx playwright test info-pages -g "footer links navigate"`
Expected: FAIL — the footer FAQ link's `href` is still `/`, not `/faq`.

- [ ] **Step 3: Rewire the three footer hrefs**

In `storefront/src/components/layout/Footer.tsx`, update the `FOOTER_COLUMNS` entries. Change the FAQ link (line 47):

```tsx
      { label: "FAQ", href: "/faq" },
```

Change the Delivery Info and Returns links (lines 55 and 57) — the Delivery column becomes:

```tsx
  {
    heading: "Delivery",
    links: [
      { label: "Delivery Info", href: "/delivery" },
      { label: "Track Order", href: "/" },
      { label: "Returns", href: "/returns" },
    ],
  },
```

Leave `Size Guide` and `Track Order` on `href: "/"` — they are out of scope for this work (see spec "Open follow-ups").

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `storefront/`): `npx playwright test info-pages -g "footer links navigate"`
Expected: PASS.

Then run the overflow test: `npx playwright test info-pages -g "no horizontal overflow"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/components/layout/Footer.tsx storefront/tests/info-pages.spec.ts
git commit -m "feat: wire footer FAQ/Delivery/Returns links to their pages"
```

---

## Task 6: Full-suite verification

- [ ] **Step 1: Run the whole info-pages spec**

Run (from `storefront/`): `npx playwright test info-pages`
Expected: all tests PASS (FAQ, Delivery, Returns, footer links, 360px overflow).

- [ ] **Step 2: Confirm no regression in cart/checkout delivery display**

Run (from `storefront/`): `npx playwright test cart`
Expected: PASS — the Task 1 constant extraction did not change cart behavior. (If `cart.spec.ts` has unrelated dev-stack prerequisites that fail, fall back to `npx tsc --noEmit` and confirm clean.)

- [ ] **Step 3: Manual design self-check (spec "Design compliance")**

Open `/faq`, `/delivery`, `/returns` in the browser and confirm: no accent color anywhere; only Inter 400/500; hairline dividers only (no shadows/gradients); FAQ accordion opens/closes via keyboard (Tab + Enter); layout is clean at 360px.

---

## Optional Task 7: Record the task in ImplementPlan.md

> Only do this if you want the work tracked in the project's task list. Per `.claude/rules/Workflow.md`, `ImplementPlan.md` is updated only when explicitly requested.

- [ ] Append a `FRONTEND-23: Static info pages (FAQ / Delivery / Returns)` entry under the FRONTEND section of `ImplementPlan.md`, mirroring the format of neighbouring tasks (Objective / Requirements / Dependencies / Deliverables / Acceptance Criteria), then commit with `docs: add FRONTEND-23 to ImplementPlan`.

---

## Notes for the implementer

- **Run location:** all `npx playwright` / `npm test` / `npx tsc` commands run from `storefront/`, not the repo root.
- **`@lib` alias:** resolves to `storefront/src/lib` (see existing `@lib/price`, `@lib/cart` imports). `@lib/delivery` is the new module from Task 1.
- **Server vs Client:** the three pages and `InfoPageLayout` are Server Components (no `"use client"`). They render `TopNav` (a Client Component) — that direction is allowed. Do not add `"use client"` to any new file in this plan.
- **No new dependencies.** Everything uses Next/React/Tailwind already in `package.json`. The `<details>` accordion is native HTML — no JS, no library.
- **Tokens only.** If you reach for a color that is not `ink` / `mute` / `canvas` / `soft-cloud` / `hairline`, stop — accent is forbidden here.
