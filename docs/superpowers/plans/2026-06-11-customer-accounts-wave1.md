# Customer Accounts — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers sign in with Facebook/Google, land in a working account area (home + profile), and sign out — turning the dead account icon into a real entry point.

**Architecture:** Server-Component guard (Approach A from the design spec). Each `/account/*` page resolves the current customer from a unified session-aware read and redirects guests away; no auth logic in `middleware.ts`. The nav popover learns signed-in state through a server action. The OAuth callbacks gain a server-side allowlisted return target so login-from-nav returns to `/account`.

**Tech Stack:** Next.js 15 (App Router, Server Components), React 19, TypeScript strict, Medusa JS SDK, Playwright E2E. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-11-customer-account-design.md`

**Scope of this plan (Wave 1):** session unification, OAuth return-intent, account shell + guard, nav popover, account home, profile (name/phone), logout. **Deferred to Wave 2 (separate plan):** order history, saved addresses, guest `/track` lookup.

**Assigned ImplementPlan.md IDs:** FRONTEND-25 (Task 1 — session reads), BACKEND-11 (Task 2 — OAuth return-intent, ✅ done), FRONTEND-26 (Task 3 — nav popover + logout), FRONTEND-27 (Task 4 — account shell + home), FRONTEND-28 (Task 5 — profile), TEST-12 (Task 6 — account E2E). The storefront work (originally sketched under one ID) was split into FRONTEND-25→28 when folded into `ImplementPlan.md`.

---

## Repo testing convention (read first)

This repo has **no unit-test runner** in the storefront — every `storefront/tests/*.spec.ts` is a Playwright E2E run via `npm test`, and backend truth is checked with `npx medusa exec` scripts. So this plan is **E2E-anchored**: foundational tasks are verified by `npm run build` (type safety) plus the trailing account E2E (Task 6), which is the behavioural gate — mirroring how `TEST-08`/`TEST-08B` already work. Each task still commits independently.

**Dev stack must be running for the E2E (per `playwright.config.ts`):**
- backend: `npx medusa develop` (http://localhost:9000)
- storefront: `npm run dev` (http://localhost:8000)
- fixtures: `npx medusa exec ./src/scripts/dev-seed-catalog-fixtures.ts`
- the Google dev-mock seam block in `backend/.env` (see Task 6), backend restarted after editing `.env`.

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `storefront/src/lib/data/session-headers.ts` (new) | Shared session-aware auth headers (JWT **and** `connect.sid`) | 1 |
| `storefront/src/lib/auth.ts` (modify) | Reuse the shared header builder instead of its private copy | 1 |
| `storefront/src/lib/data/customer.ts` (modify) | `retrieveCustomer`/`updateCustomer` session-aware + `no-store` (Task 1); add `logout` (Task 3, its first consumer) | 1, 3 |
| `backend/src/api/store/auth/{facebook,google}/route.ts` (modify) | Accept `?intent=`, store allowlisted `return_to` in the state entry | 2 |
| `backend/src/api/store/auth/{facebook,google}/callback/route.ts` (modify) | Redirect to the stored, re-validated `return_to` | 2 |
| `storefront/src/lib/account.ts` (new) | `getAccountMenuState()` server action for the nav | 3 |
| `storefront/src/components/layout/AccountMenu.tsx` (new) | Nav popover: providers (signed out) / account links (signed in) | 3 |
| `storefront/src/components/layout/TopNav.tsx` (modify) | Mount `AccountMenu` on desktop + in the mobile drawer | 3 |
| `storefront/src/app/account/layout.tsx` (new) | Session guard + account chrome | 4 |
| `storefront/src/app/account/page.tsx` (new) | Account home | 4 |
| `storefront/src/components/account/AccountNav.tsx` (new) | In-account section nav + logout | 4 |
| `storefront/src/lib/validation/phone.ts` (new) | Cambodia phone validator (PRD regex) | 5 |
| `storefront/src/components/account/ProfileForm.tsx` (new) | Edit name + phone | 5 |
| `storefront/src/app/account/profile/page.tsx` (new) | Profile page | 5 |
| `storefront/tests/account.spec.ts` (new) | Account E2E (login → popover, guard, home, profile, logout, intent) | 6 |

---

## Task 1: Unified session-aware customer reads

**Why first:** social login yields a `connect.sid` session and **no JWT**, so the current JWT-only `retrieveCustomer()` returns `null` for exactly our users. Extract the dual-credential header builder (today private in `lib/auth.ts:42-85`) into a shared module and route the customer reads through it.

**Files:**
- Create: `storefront/src/lib/data/session-headers.ts`
- Modify: `storefront/src/lib/auth.ts`
- Modify: `storefront/src/lib/data/customer.ts`

- [ ] **Step 1: Create the shared session-header module**

Create `storefront/src/lib/data/session-headers.ts` (faithful extraction of `lib/auth.ts:42-85` — note it reads the **raw** Cookie header, never `cookies().get()`, so the signed `connect.sid` is forwarded without re-encoding):

```ts
import "server-only"
import { headers as nextHeaders } from "next/headers"
import { getAuthHeaders } from "./cookies"

/** Medusa's session cookie (express-session) set by the OAuth callbacks. */
export const SESSION_COOKIE_NAME = "connect.sid"

/**
 * Pull a single cookie's *raw* (still URL-encoded) value out of the incoming
 * Cookie header so it can be forwarded to the backend verbatim — re-encoding a
 * value `next/headers` already decoded would corrupt the signed `connect.sid`.
 */
export function extractCookie(
  rawCookieHeader: string,
  name: string
): string | undefined {
  for (const part of rawCookieHeader.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim()
    }
  }
  return undefined
}

/**
 * Build auth headers carrying the starter's JWT (if a token session exists) AND
 * the forwarded `connect.sid` (if a social session exists). Either is enough for
 * the backend to authenticate the customer.
 */
export async function buildSessionHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...(await getAuthHeaders()) }

  let rawCookie = ""
  try {
    rawCookie = (await nextHeaders()).get("cookie") ?? ""
  } catch {
    rawCookie = ""
  }

  const sid = extractCookie(rawCookie, SESSION_COOKIE_NAME)
  if (sid) {
    headers["cookie"] = `${SESSION_COOKIE_NAME}=${sid}`
  }

  return headers
}
```

- [ ] **Step 2: Point `lib/auth.ts` at the shared module**

In `storefront/src/lib/auth.ts`, delete the private `SESSION_COOKIE_NAME`, `extractCookie`, and `buildSessionHeaders` definitions (lines ~42-85) and import them instead. Replace the imports/helpers block so the top reads:

```ts
import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { buildSessionHeaders } from "@lib/data/session-headers"
```

Leave `retrieveSessionCustomer()` and `getSocialLoginPrefillName()` unchanged — they already call `buildSessionHeaders()`.

- [ ] **Step 3: Make `retrieveCustomer` + `updateCustomer` session-aware**

In `storefront/src/lib/data/customer.ts`, add the import and replace the two functions' header sourcing. New `retrieveCustomer` (note: `no-store` — a `connect.sid`-scoped read must never be cached across users):

```ts
import { buildSessionHeaders } from "./session-headers"

export const retrieveCustomer =
  async (): Promise<HttpTypes.StoreCustomer | null> => {
    const headers = await buildSessionHeaders()

    // No credential at all → guest; skip the round-trip.
    if (!headers["authorization"] && !headers["cookie"]) {
      return null
    }

    return await sdk.client
      .fetch<{ customer: HttpTypes.StoreCustomer }>(`/store/customers/me`, {
        method: "GET",
        query: { fields: "*orders" },
        headers,
        cache: "no-store",
      })
      .then(({ customer }) => customer)
      .catch(() => null)
  }
```

In `updateCustomer`, replace `const headers = { ...(await getAuthHeaders()) }` with `const headers = await buildSessionHeaders()`.

- [ ] **Step 4: Type-check**

Run: `cd storefront && npm run build`
Expected: build succeeds (no type errors). If `getAuthHeaders` is now unused in `customer.ts`, remove it from the import on line 9-16.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/lib/data/session-headers.ts storefront/src/lib/auth.ts storefront/src/lib/data/customer.ts
git commit -m "refactor: unify session-aware customer reads (connect.sid + JWT)"
```

---

## Task 2: OAuth return-intent (Facebook + Google) — ✅ DONE

> ✅ **Completed** as BACKEND-11 (commit `ac4ae4a`, branch `feat/footer-info-pages`; backend `npm run build` green). The code below is **as-shipped** — it hardens the original sketch: an `as const` map + literal-key type guard (`isReturnIntent`) keeps the lookup prototype-pollution-safe, and the callback derives its allowlist via `new Set(Object.values(RETURN_PATHS))` (DRY) instead of a hand-listed set. Backward compatible: state entries without `return_to`, and logins with no `intent`, resolve to the unchanged `/checkout` default.

**Why:** the callbacks hard-redirect to `/checkout` (`facebook/callback/route.ts:51,309`; google `:127,548`). Login from the account popover must return to `/account`, but `security.md` forbids echoing a client redirect target. Resolve the destination server-side from an allowlisted `?intent=` and carry it in the existing single-use Redis state entry.

**Files:**
- Modify: `backend/src/api/store/auth/facebook/route.ts`
- Modify: `backend/src/api/store/auth/facebook/callback/route.ts`
- Modify: `backend/src/api/store/auth/google/route.ts`
- Modify: `backend/src/api/store/auth/google/callback/route.ts`

- [x] **Step 1: Add the intent allowlist to the Facebook start route**

In `backend/src/api/store/auth/facebook/route.ts`, add near the other constants (after `STATE_COOKIE`):

```ts
/**
 * Optional `?intent=` → post-login return path. security.md: redirect targets
 * come from a hard-coded allowlist, never echoed client input. The `as const`
 * map + literal-key type guard keep the lookup prototype-pollution-safe.
 * Unknown/absent intent → /checkout (the pre-account default, unchanged).
 */
const RETURN_PATHS = { checkout: "/checkout", account: "/account" } as const
type ReturnIntent = keyof typeof RETURN_PATHS
const DEFAULT_RETURN_INTENT: ReturnIntent = "checkout"

/** Narrow an arbitrary query value to a known intent key. */
function isReturnIntent(value: unknown): value is ReturnIntent {
  return value === "checkout" || value === "account"
}

/** Resolve the optional intent query to its hard-coded return path. */
function resolveReturnTo(intent: unknown): string {
  return RETURN_PATHS[isReturnIntent(intent) ? intent : DEFAULT_RETURN_INTENT]
}
```

Then, in `GET`, where the state is stored (line ~206), capture and persist the resolved target:

```ts
  const state = randomBytes(32).toString("base64url")
  const returnTo = resolveReturnTo(req.query.intent)
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  await cache.set(
    stateKey(state),
    { issued_at: Date.now(), return_to: returnTo },
    STATE_TTL_SECONDS
  )
```

- [x] **Step 2: Honor the stored target in the Facebook callback**

In `backend/src/api/store/auth/facebook/callback/route.ts`:

Replace the `STOREFRONT_RETURN_PATH` constant (line ~51) with the allowlist + resolver (mirrors the start route's `RETURN_PATHS`; the allowlist is derived, not hand-listed):

```ts
/**
 * Allowlisted post-login destinations (mirror the start route's RETURN_PATHS).
 * The callback re-validates the stored target as defense in depth; anything
 * else falls back to /checkout.
 */
const RETURN_PATHS = { checkout: "/checkout", account: "/account" } as const
const DEFAULT_RETURN_PATH = RETURN_PATHS.checkout
const ALLOWED_RETURN_PATHS: ReadonlySet<string> = new Set(
  Object.values(RETURN_PATHS)
)

/** Re-validate the state-stored return path against the hard-coded allowlist. */
function resolveReturnPath(stored: unknown): string {
  return typeof stored === "string" && ALLOWED_RETURN_PATHS.has(stored)
    ? stored
    : DEFAULT_RETURN_PATH
}
```

Type the state read so `return_to` is visible and resolve it immediately after the CSRF triple-check passes (line ~191) — never before, so a forged value can't influence anything pre-validation:

```ts
  const cookieState = readCookie(req, STATE_COOKIE)
  const storedState = await cache.get<{ return_to?: unknown }>(stateKey(state))
  if (!cookieState || cookieState !== state || storedState === null) {
    return fail(res, 401, "invalid_state", requestId)
  }
  // Post-login return path the start route stashed in the (now verified) state.
  const returnTo = resolveReturnPath(storedState.return_to)
```

Finally, replace the terminal `res.redirect(302, STOREFRONT_RETURN_PATH)` (line ~309) with:

```ts
  res.redirect(302, returnTo)
```

- [x] **Step 3: Mirror both changes in the Google routes**

Apply Step 1 verbatim to `backend/src/api/store/auth/google/route.ts` (same constants; same `return_to` capture at its `cache.set` on line ~208).

Apply Step 2 verbatim to `backend/src/api/store/auth/google/callback/route.ts` (replace `STOREFRONT_RETURN_PATH` at line ~127, type the `storedState` read at line ~396, replace the terminal redirect at line ~548).

- [x] **Step 4: Type-check the backend**

Run: `cd backend && npm run build`
Expected: build succeeds. ✅ Verified green (backend 6.42s, frontend 24.04s).

- [x] **Step 5: Commit**

Shipped as (4 auth files only):

```bash
git add backend/src/api/store/auth/facebook backend/src/api/store/auth/google
git commit -m "feat: add intent-based post-login redirect to social auth (BACKEND-11)"
```

Behavioural proof arrives in Task 6 (login with `?intent=account` lands on `/account`; the existing `google-login.spec.ts`/`fb-login.spec.ts` still land on `/checkout`, proving the default is unchanged).

---

## Task 3: Nav popover (`AccountMenu`)

**Files:**
- Modify: `storefront/src/lib/data/customer.ts` (add `logout` — moved here from the old Task 4 so it is defined at its first consumer)
- Create: `storefront/src/lib/account.ts`
- Create: `storefront/src/components/layout/AccountMenu.tsx`
- Modify: `storefront/src/components/layout/TopNav.tsx`

- [ ] **Step 1: Logout server action**

Defined here (not in Task 4) because the popover below imports it; committing Task 3 now includes `customer.ts`, so the build never carries a dangling import. In `storefront/src/lib/data/customer.ts`, add `nextCookies` to the top imports and a `logout` action. This replaces the starter's broken `signout` (it redirects to `/${countryCode}/account`, a 404 here):

```ts
import { cookies as nextCookies } from "next/headers"

/**
 * Sign the customer out. Clears the starter JWT and expires the social
 * `connect.sid` session cookie on this origin, then revalidates the customer
 * cache and returns home.
 *
 * Known limitation (Wave 2 hardening): the backend express-session record
 * lingers until its TTL; expiring the cookie makes it unreachable from the
 * browser, which is sufficient for v1. A proxied server-side session destroy is
 * a follow-up.
 */
export async function logout() {
  try {
    await sdk.auth.logout()
  } catch {
    // No JWT session (social login) — nothing to revoke server-side here.
  }

  await removeAuthToken()

  const cookieStore = await nextCookies()
  cookieStore.set("connect.sid", "", { maxAge: -1, path: "/" })

  const customerCacheTag = await getCacheTag("customers")
  revalidateTag(customerCacheTag)

  await removeCartId()

  redirect("/")
}
```

(`removeAuthToken`, `removeCartId`, `getCacheTag`, `revalidateTag`, `redirect`, `sdk` are already imported in this file. Leave the old `signout` in place if other code references it, or delete it if not — check `grep -rn "signout" storefront/src` first.)

- [ ] **Step 2: Server action for menu state**

Create `storefront/src/lib/account.ts`:

```ts
"use server"

import { retrieveCustomer } from "@lib/data/customer"

export interface AccountMenuState {
  /** Display name for the signed-in greeting (never any other PII). */
  name: string
}

/**
 * Resolve the signed-in customer's display name for the nav, or `null` for a
 * guest. Mirrors the `getSocialLoginPrefillName` pattern (mount-time read from a
 * client component) but returns only the name — no phone/email crosses to the
 * client.
 */
export async function getAccountMenuState(): Promise<AccountMenuState | null> {
  const customer = await retrieveCustomer()
  if (!customer) return null

  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return { name: name || "Account" }
}
```

- [ ] **Step 3: The popover component**

Create `storefront/src/components/layout/AccountMenu.tsx`:

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { User } from "@medusajs/icons"

import { getAccountMenuState } from "@lib/account"
import { logout } from "@lib/data/customer"

/**
 * Account affordance in the primary nav (replaces the former dead button).
 * Signed out → a popover offering the two social providers (login-from-nav uses
 * `?intent=account` so the OAuth callback returns to /account). Signed in →
 * account links + logout. State is read once on mount via the
 * `getAccountMenuState` server action, the `FacebookLogin` precedent.
 *
 * design.md: ink only (no accent — accent is reserved for sale price + KHQR),
 * single hairline border, no shadow. Provider links are relative/same-origin so
 * the `/store/auth/*` proxy injects the publishable key and keeps the cookies on
 * this origin.
 */

const ICON_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70"

const MENU_LINK =
  "block px-4 py-3 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-70"

const PROVIDERS: readonly { label: string; href: string }[] = [
  { label: "Continue with Facebook", href: "/store/auth/facebook?intent=account" },
  { label: "Continue with Google", href: "/store/auth/google?intent=account" },
]

export default function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ name: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Mount-only: reflects the session present when the nav loaded.
  useEffect(() => {
    let active = true
    void (async () => {
      const next = await getAccountMenuState()
      if (active) setState(next)
    })()
    return () => {
      active = false
    }
  }, [])

  // Close on Escape / outside click while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={ICON_BUTTON}
      >
        <User className="h-6 w-6" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 border border-hairline bg-canvas py-2"
        >
          {state ? (
            <>
              <p className="px-4 py-2 text-xs font-medium leading-normal text-mute">
                Signed in as {state.name}
              </p>
              <Link href="/account" role="menuitem" className={MENU_LINK}>
                Account
              </Link>
              <Link
                href="/account/profile"
                role="menuitem"
                className={MENU_LINK}
              >
                Profile
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  role="menuitem"
                  className={`${MENU_LINK} w-full text-left`}
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col gap-1 px-2">
              {PROVIDERS.map((p) => (
                <a key={p.href} href={p.href} role="menuitem" className={MENU_LINK}>
                  {p.label}
                </a>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Mount it in `TopNav`**

In `storefront/src/components/layout/TopNav.tsx`:

Add the import after the `NavSearch` import (line 14):

```tsx
import AccountMenu from "./AccountMenu"
```

Replace the dead desktop button (lines 177-179):

```tsx
          <AccountMenu />
```

In the mobile drawer, add account entries after the `Search` link (after line 230, inside the `flex flex-col px-4 py-xl` block, before the `<ul>`). Because the drawer is server-rendered markup inside a client component, reuse the same providers/links as plain anchors so the drawer needs no extra state:

```tsx
            <a
              href="/account"
              onClick={closeDrawer}
              className="flex items-center gap-2 py-3 text-base font-medium leading-normal text-ink"
            >
              <User className="h-5 w-5" />
              Account
            </a>
```

(`User` is already imported in `TopNav.tsx:7`.) The `/account` guard (Task 4) sends guests who tap this back to `/`, so one entry serves both states without duplicating the popover in the drawer.

- [ ] **Step 5: Type-check**

Run: `cd storefront && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add storefront/src/lib/data/customer.ts storefront/src/lib/account.ts storefront/src/components/layout/AccountMenu.tsx storefront/src/components/layout/TopNav.tsx
git commit -m "feat: account nav popover + logout (social sign-in / account links)"
```

---

## Task 4: Account shell (guard + home)

**Files:**
- Create: `storefront/src/components/account/AccountNav.tsx`
- Create: `storefront/src/app/account/layout.tsx`
- Create: `storefront/src/app/account/page.tsx`

(`logout` is defined in Task 3; `AccountNav` below imports it from `@lib/data/customer` — do not redefine it here.)

- [ ] **Step 1: In-account nav + logout control**

Create `storefront/src/components/account/AccountNav.tsx`:

```tsx
import Link from "next/link"

import { logout } from "@lib/data/customer"

/**
 * Section navigation inside the account area. Wave 1 surfaces Home + Profile;
 * Orders + Addresses are added in Wave 2. Ink only (design.md).
 */

const LINKS: readonly { label: string; href: string }[] = [
  { label: "Account", href: "/account" },
  { label: "Profile", href: "/account/profile" },
]

export default function AccountNav() {
  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="py-2 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-70"
        >
          {link.label}
        </Link>
      ))}
      <form action={logout}>
        <button
          type="submit"
          className="py-2 text-left text-base font-medium leading-normal text-mute transition-opacity hover:opacity-70"
        >
          Log out
        </button>
      </form>
    </nav>
  )
}
```

- [ ] **Step 2: Guarded layout**

Create `storefront/src/app/account/layout.tsx`:

```tsx
import { redirect } from "next/navigation"

import TopNav from "../../components/layout/TopNav"
import AccountNav from "../../components/account/AccountNav"
import { retrieveCustomer } from "@lib/data/customer"

/**
 * Account-area shell + guard (Approach A). Resolves the current customer from
 * the request session; guests are redirected home (the nav popover, not this
 * route, is where sign-in happens). Every child page is therefore guaranteed an
 * authenticated customer. Server Component (no interactivity here).
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const customer = await retrieveCustomer()
  if (!customer) {
    redirect("/")
  }

  return (
    <>
      <TopNav />
      <main className="mx-auto flex max-w-5xl flex-col gap-section px-4 py-section min-[600px]:flex-row min-[600px]:px-6">
        <aside className="min-[600px]:w-48 min-[600px]:shrink-0">
          <AccountNav />
        </aside>
        <section className="flex-1">{children}</section>
      </main>
    </>
  )
}
```

- [ ] **Step 3: Account home**

Create `storefront/src/app/account/page.tsx`:

```tsx
import { retrieveCustomer } from "@lib/data/customer"

/**
 * Account home. The layout guard guarantees a customer, but we read it again
 * for the greeting (cheap, `no-store`, session-scoped).
 */
export default async function AccountHomePage() {
  const customer = await retrieveCustomer()
  const name =
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim() ||
    "there"

  return (
    <div>
      <h1 className="text-3xl font-medium uppercase text-ink">My account</h1>
      <p className="mt-4 text-base font-medium leading-normal text-mute">
        Hello {name}. Manage your profile and review your details here.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `cd storefront && npm run build`
Expected: build succeeds; `/account` appears in the route list.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/components/account/AccountNav.tsx storefront/src/app/account/layout.tsx storefront/src/app/account/page.tsx
git commit -m "feat: guarded account shell with home"
```

---

## Task 5: Profile page (name + phone)

**Files:**
- Create: `storefront/src/lib/validation/phone.ts`
- Create: `storefront/src/components/account/ProfileForm.tsx`
- Create: `storefront/src/app/account/profile/page.tsx`

- [ ] **Step 1: Phone validator (PRD regex)**

Create `storefront/src/lib/validation/phone.ts`:

```ts
/**
 * Cambodia phone validation — the single regex from security.md / PRD, used at
 * every entry point: `^(\+855|0)[1-9]\d{7,8}$`.
 */
export const CAMBODIA_PHONE_REGEX = /^(\+855|0)[1-9]\d{7,8}$/

export function isValidCambodiaPhone(value: string): boolean {
  return CAMBODIA_PHONE_REGEX.test(value.trim())
}
```

- [ ] **Step 2: Profile form**

Create `storefront/src/components/account/ProfileForm.tsx`:

```tsx
"use client"

import { useState } from "react"

import { updateCustomer } from "@lib/data/customer"
import { isValidCambodiaPhone } from "@lib/validation/phone"

interface ProfileFormProps {
  firstName: string
  lastName: string
  phone: string
  email: string
}

const INPUT =
  "h-12 w-full rounded-pill border border-hairline bg-canvas px-6 text-base font-medium leading-normal text-ink"
const LABEL = "text-xs font-medium leading-normal text-mute"
const SUBMIT =
  "inline-flex h-12 items-center justify-center rounded-pill border border-ink bg-ink px-6 text-base font-medium leading-normal text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"

export default function ProfileForm({
  firstName,
  lastName,
  phone,
  email,
}: ProfileFormProps) {
  const [form, setForm] = useState({ firstName, lastName, phone })
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  )
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (form.phone && !isValidCambodiaPhone(form.phone)) {
      setError("Enter a valid Cambodia phone number.")
      setStatus("error")
      return
    }

    setStatus("saving")
    try {
      await updateCustomer({
        first_name: form.firstName,
        last_name: form.lastName,
        phone: form.phone,
      })
      setStatus("saved")
    } catch {
      setError("Could not save. Please try again.")
      setStatus("error")
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="first_name">
          First name
        </label>
        <input
          id="first_name"
          className={INPUT}
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="last_name">
          Last name
        </label>
        <input
          id="last_name"
          className={INPUT}
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="phone">
          Phone
        </label>
        <input
          id="phone"
          inputMode="tel"
          className={INPUT}
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="email">
          Email
        </label>
        <input id="email" className={INPUT} value={email} disabled readOnly />
      </div>

      {error ? (
        <p className="text-base font-medium leading-normal text-ink">{error}</p>
      ) : null}
      {status === "saved" ? (
        <p className="text-base font-medium leading-normal text-mute">Saved.</p>
      ) : null}

      <button type="submit" className={SUBMIT} disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Save changes"}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Profile page**

Create `storefront/src/app/account/profile/page.tsx`:

```tsx
import { retrieveCustomer } from "@lib/data/customer"
import ProfileForm from "../../../components/account/ProfileForm"

export default async function ProfilePage() {
  const customer = await retrieveCustomer()

  return (
    <div>
      <h1 className="text-3xl font-medium uppercase text-ink">Profile</h1>
      <p className="mt-4 mb-section text-base font-medium leading-normal text-mute">
        Update the name and phone we use for your orders.
      </p>
      <ProfileForm
        firstName={customer?.first_name ?? ""}
        lastName={customer?.last_name ?? ""}
        phone={customer?.phone ?? ""}
        email={customer?.email ?? ""}
      />
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

Run: `cd storefront && npm run build`
Expected: build succeeds; `/account/profile` in the route list.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/lib/validation/phone.ts storefront/src/components/account/ProfileForm.tsx storefront/src/app/account/profile/page.tsx
git commit -m "feat: account profile page (edit name + phone)"
```

---

## Task 6: Account E2E spec (behavioural gate)

Drives a real login through the Google dev-mock seam (same mechanism as `tests/google-login.spec.ts`), then exercises the popover, the guard, the home + profile pages, logout, and the `intent=account` return.

**Files:**
- Create: `storefront/tests/account.spec.ts`

**Seam note (important):** this spec reuses the **same** Google dev-mock seam and port (`4282`) as `google-login.spec.ts`, so it requires the same `backend/.env` block and a backend restart, and must **not** run concurrently with `google-login.spec.ts` (both bind port 4282). Run it targeted: `npx playwright test account.spec.ts`. This matches how the social specs already operate (their headers document per-spec env + restart).

- [ ] **Step 1: Write the spec**

Create `storefront/tests/account.spec.ts`. Copy the boilerplate from `tests/google-login.spec.ts` **verbatim** for these pieces (they are identical infrastructure): the imports, `BACKEND_URL`/`BACKEND_DIR`/`MOCK_TOKEN_PORT`/`MOCK_CLIENT_ID`/`MOCK_CLIENT_SECRET`/`EXPECTED_REDIRECT_URI`/`GOOGLE_DIALOG_URL` constants, the per-run `RUN_TAG`/user constants, the `mockHits`/`mockToken` state, `b64url`, `mintIdToken`, `startMockToken`, the `beforeAll`/`afterAll`, `readStorefrontEnv`, `publishableKeyHeaders`, and `SEAM_HINT`. Then add the account-specific body below.

Change one line in the copied helper to drive the `intent=account` return, and turn it into a reusable login that asserts the landing page. Replace the copied `completeGoogleLogin` body's **start request and landing assertion** with:

```ts
  // 1) OAuth start WITH intent=account so the callback returns to /account.
  const startRes = await context.request.get(
    "/store/auth/google?intent=account",
    { maxRedirects: 0 }
  )
```

and, after the callback navigation, assert `/account` instead of `/checkout`:

```ts
  if (!new URL(page.url()).pathname.startsWith("/account")) {
    const body = (await response?.text().catch(() => "")) ?? ""
    throw new Error(
      `Callback did not land on /account (got ${page.url()}; body: ` +
        `${body.slice(0, 200)}; mock token hits: ${JSON.stringify(mockHits)}). ` +
        SEAM_HINT
    )
  }
```

(Keep the rest of the helper — start-302 assertions, state cookie check, `connect.sid` presence — unchanged. The helper can return `void` here; we assert via the UI.)

Then the tests:

```ts
test.describe.configure({ mode: "serial" })

test.describe("Account area (TEST-12)", () => {
  test("signed-out account icon offers both social providers", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Account" }).click()
    await expect(
      page.getByRole("menuitem", { name: "Continue with Facebook" })
    ).toBeVisible()
    const google = page.getByRole("menuitem", { name: "Continue with Google" })
    await expect(google).toBeVisible()
    // Login-from-nav carries the account intent.
    await expect(google).toHaveAttribute("href", /intent=account/)
  })

  test("guest hitting /account is redirected home", async ({ page }) => {
    await page.goto("/account")
    await expect(page).toHaveURL(/\/$/)
  })

  test("completed login lands on /account and renders the customer", async ({
    page,
  }) => {
    test.setTimeout(420_000)
    await completeGoogleLogin(page) // lands on /account (asserted in helper)

    await expect(
      page.getByRole("heading", { name: "My account" })
    ).toBeVisible()

    // Profile is prefilled from the session.
    await page.goto("/account/profile")
    await expect(page.locator("#first_name")).toHaveValue(GOOGLE_USER_NAME)
    await expect(page.locator("#email")).toHaveValue(GOOGLE_USER_EMAIL)
  })

  test("logout clears the session and restores the signed-out menu", async ({
    page,
  }) => {
    test.setTimeout(420_000)
    await completeGoogleLogin(page)

    await page.goto("/account")
    await page.getByRole("button", { name: "Log out" }).click()
    await expect(page).toHaveURL(/\/$/)

    // Session gone: the menu offers providers again, and /account re-guards.
    await page.getByRole("button", { name: "Account" }).click()
    await expect(
      page.getByRole("menuitem", { name: "Continue with Google" })
    ).toBeVisible()
    await page.goto("/account")
    await expect(page).toHaveURL(/\/$/)
  })
})
```

Note: `mintIdToken` in the copied boilerplate sets `first_name` via the `name` claim (`GOOGLE_USER_NAME`); the profile assertion uses `#first_name`, which the customer's `first_name` populates (created from `name` by `createCustomerAccountWorkflow`, per the callback).

- [ ] **Step 2: Run the spec**

Ensure both servers are up, the Google dev-mock block is in `backend/.env`, and the backend was restarted. Then:

Run: `cd storefront && npx playwright test account.spec.ts`
Expected: 4 passed.

If the first test can't find the menu, confirm Task 3 mounted `AccountMenu`. If login doesn't land on `/account`, confirm Task 2's intent change and that `backend/.env` has the seam (the `SEAM_HINT` message will say so).

- [ ] **Step 3: Commit**

```bash
git add storefront/tests/account.spec.ts
git commit -m "test: account E2E (sign-in, guard, home, profile, logout, intent)"
```

---

## Self-review (completed during authoring)

- **Spec coverage:** §6 architecture → Tasks 1,4. §7 session unification → Task 1. §8 popover + drawer parity → Task 3. §9 OAuth intent → Task 2. §10 home/profile → Tasks 4,5 (orders/addresses are Wave 2, explicitly deferred). §12 logout → Task 3 (defined at its first consumer; Task 4's `AccountNav` imports it). §14 testing → Task 6. §15 security (no-store, allowlist, no client ids, phone regex) → Tasks 1,2,5. Guest `/track` (§11) and order/address surfaces are out of this plan by design (Wave 2).
- **Type consistency:** `buildSessionHeaders`, `retrieveCustomer`, `getAccountMenuState`, `logout`, `isValidCambodiaPhone`, `updateCustomer` referenced with consistent signatures across tasks. `connect.sid`, `?intent=account`, and the `/checkout`↔`/account` allowlist match between start and callback routes.
- **No placeholders:** every code step shows complete code; the E2E reuses a named existing file (`google-login.spec.ts`) for identical boilerplate with the exact deltas spelled out.

## Wave 2 (separate plan, after this ships)

Order history (`/account/orders` → existing `/order/[id]`), saved addresses (CRUD via the existing helpers, session-aware), and guest order lookup (`/track` + `POST /store/orders/lookup`, ULID-keyed + phone, rate-limited) — plus extending the popover/`AccountNav` with Orders + Addresses and wiring the Footer's "Track Order". Mapped to FRONTEND-29+, BACKEND-12, TEST-13 (FRONTEND-26→28 are taken by Wave 1).
