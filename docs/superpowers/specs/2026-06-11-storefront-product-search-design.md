# Storefront Product Search — Design Spec

- **Date:** 2026-06-11
- **Status:** Approved (brainstorming) — ready for implementation plan
- **Surface:** `storefront/` (Next.js 15 App Router, React 19, Tailwind v3)
- **Scope label:** New feature (not in original `ImplementPlan.md` task list). Submit-based
  search only. Explicitly **NOT** "search-as-you-type" (PRD.md §2 defers that to v2).

## Problem

The magnifier icon in `TopNav` is a static placeholder with no `onClick` and no
behavior — there is no `/search` route, no search input, and no backend search
endpoint. Customers expect the icon to let them find products by keyword. This spec
adds a minimal, on-spec product search.

## Goals

- Clicking the nav magnifier reveals a search input that submits a keyword query.
- Submitting shows matching products on a dedicated, shareable results page.
- Reuse existing primitives and the established catalog data/render pattern.
- Stay inside the flat, token-only design system; reserve accent for sale price + KHQR.

## Non-goals (v1)

- Live/instant "search-as-you-type" results (v2-deferred per PRD.md §2 line 53).
- A filter sidebar (size/colour/category) on the results grid — clean fast-follow.
- Wiring the dead Account/User icon (separate out-of-scope item).
- Pagination of results (v1 catalog has none; a single bounded page is consistent).

## User-facing behavior

### Desktop (≥600px)
1. The nav magnifier is an expanding affordance. Closed = just the icon.
2. Click → a `SearchPill` input grows out **to the left** of the icon, autofocused.
3. Type a query + **Enter** → navigate to `/search?q=<query>`.
4. Collapse on: second click of the icon, **Esc**, or click/focus away.

### Mobile (≤599px)
- The 3-element mobile row (hamburger + wordmark + bag) is unchanged (DESIGN.md).
- The hamburger slide-in drawer gains a **"Search"** row linking to `/search`
  (closes the drawer on tap, like the existing category links).

### Results page `/search`
- Renders its own `<TopNav />` and `max-w-8xl` main (mirrors `category/[handle]`).
- A **prefilled `SearchBox`** sits at the top so the query can be refined in place.
- Three states:
  - **Empty/whitespace query** → prompt copy ("Search for products").
  - **Query, 0 results** → empty state: `No products match "<q>"`.
  - **Query, results** → `Results for "<q>"` heading + `ProductGrid` of `ProductCard`s.

## Architecture

Data flows server → client exactly like the existing catalog:
`/search` (Server Component) → `searchProducts(q)` (server action in `lib/medusa.ts`)
→ Medusa `GET /store/products?q=` → normalized `CatalogProduct[]` → `ProductGrid`/`ProductCard`.

The search **entry** (`NavSearch`) is the only new client-interactive piece; it owns
open/closed state and delegates submission to `next/form`, which performs the
client-side navigation to `/search?q=...` (URL-as-state). No `useRouter` hand-rolling,
no new dependency (`next/form` ships with Next 15).

### Units

| Unit | File | Kind | Responsibility | Depends on |
|------|------|------|----------------|------------|
| `searchProducts` | `src/lib/medusa.ts` (modify) | server action | Trim/bound query, resolve region, fetch `/store/products?q=`, map to `CatalogProduct[]` | `sdk`, existing `PRODUCT_FIELDS`, `toCatalogProduct`, `resolveRegionId` |
| `SearchBox` | `src/components/layout/SearchBox.tsx` (new) | Server Component | `next/form` GET form wrapping `SearchPill` (`name="q"`) — the reusable submit form | `next/form`, `SearchPill` |
| `NavSearch` | `src/components/layout/NavSearch.tsx` (new) | Client Component | Expanding magnifier affordance: open/close state, autofocus, Esc/click-away collapse; renders `SearchBox` when open | `SearchBox`, `@medusajs/icons` `MagnifyingGlass` |
| `TopNav` | `src/components/layout/TopNav.tsx` (modify) | Client Component | Desktop: dead `<button>` → `<NavSearch />`. Mobile: add "Search" drawer row → `/search` | `NavSearch`, `next/link` |
| `SearchPage` | `src/app/search/page.tsx` (new) | Server Component (async) | Read `searchParams.q`, render `SearchBox` + state-driven results/empty/prompt | `searchProducts`, `SearchBox`, `TopNav`, `ProductGrid`, `ProductCard` |

### `searchProducts` shape

```ts
const SEARCH_PRODUCT_LIMIT = 50
const MAX_QUERY_LENGTH = 100

export async function searchProducts(
  query: string,
  limit: number = SEARCH_PRODUCT_LIMIT
): Promise<CatalogProduct[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH)
  if (!trimmed) return []

  const regionId = await resolveRegionId()
  if (!regionId) return []

  const { products } = await sdk.client.fetch<{ products: HttpTypes.StoreProduct[] }>(
    "/store/products",
    { method: "GET", query: { q: trimmed, limit, region_id: regionId, fields: PRODUCT_FIELDS } }
  )

  return (products ?? []).map(toCatalogProduct).filter(isCatalogProduct)
}
```

## Data flow / error handling

- **No region resolvable** → `searchProducts` returns `[]`; page shows the 0-results state.
  (Same defensive posture as `getCatalogProducts`.)
- **Backend fetch throws** → bubbles to the route's error boundary (Next default);
  no bespoke handling in v1, consistent with the other catalog reads.
- **Products without a calculated price** → dropped by `toCatalogProduct`/`isCatalogProduct`
  (every tile renders a real price), identical to the catalog grid.

## Security (security.md applied)

- **Input:** `q` is user-controlled. Trimmed and length-capped (`MAX_QUERY_LENGTH`)
  before use. Passed as a query param via the Medusa SDK (encoded, parameterized) —
  no string interpolation, no SQL concatenation. Medusa handles `q` server-side.
- **XSS:** `q` is echoed in the heading, empty-state, and as `SearchPill` `defaultValue`.
  All are React-escaped by default. No `dangerouslySetInnerHTML`.
- **Endpoint/limits:** reuses the **stock** `/store/products` list (publishable key,
  existing `sdk`). No new custom route, so no new rate-limit surface to define; it
  inherits existing storefront/Medusa limits. (Documented deviation from adding a
  named limit, justified because no new endpoint is introduced.)
- **Secrets:** none added; no new `NEXT_PUBLIC_*`.

## Design compliance (design.md self-check)

- Reuses `SearchPill`, `ProductGrid`, `ProductCard`, `Chip`-free; no new primitive.
- Named tokens only (`text-ink`, `text-mute`, `bg-soft-cloud`, `rounded-pill`, 8px-grid
  spacing). No arbitrary hex, no accent (accent reserved for sale price + KHQR CTA).
- No gradients/shadows/blur; single hairline dividers; outline icon set (`@medusajs/icons`).
- Light-mode only, no `dark:`. English-only.
- Expand reveal is subtle and compositor-friendly (no flashy `width` animation).
- Mobile-first; verified at 360px before done.
- Product images remain 1:1 via `ProductCard` (`next/image`), untouched.

## Testing

- **Component (failing-first):**
  - `SearchBox` renders a form whose action targets `/search` with an input `name="q"`;
    `defaultValue` prefills.
- **Route/branch logic:** `/search` renders prompt when `q` empty, 0-results copy when
  no matches, and a grid when matches exist (drive via `searchProducts` seam / fixtures).
- **E2E (if harness supports, per test-phase notes):** open nav search → type a seeded
  term → land on `/search?q=` → assert matching `ProductCard`s; gibberish → 0-results copy.
- Coverage target per repo testing rules; visual check at 320/375/768/1440.

## Acceptance criteria

1. Clicking the desktop nav magnifier expands an autofocused search input to its left;
   Esc / click-away / second click collapses it.
2. Typing a query + Enter navigates to `/search?q=<query>`.
3. `/search?q=<term>` lists products matching the term in the existing grid; the query
   is shown and the field is prefilled for refining.
4. `/search` with no/empty `q` shows the prompt; a non-matching `q` shows the 0-results
   copy.
5. Mobile hamburger drawer has a "Search" row linking to `/search`; the 3-element mobile
   top row is unchanged.
6. No new color tokens, no accent misuse, no shadows/gradients/`dark:`; layout holds at 360px.
7. The Account/User icon is left unchanged (out of scope).

## Out of scope / fast-follow

- Filter sidebar on results, pagination, search-as-you-type, recent/suggested searches,
  wiring the Account icon. All deferred.
