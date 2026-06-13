# Customer Accounts — Design Spec

- **Date:** 2026-06-11
- **Status:** Approved design (pre-implementation)
- **Scope:** v2 expansion of Ali Store storefront. `PRD.md §2` lists customer
  accounts as out of scope for v1; this spec deliberately expands that scope and
  is gated on explicit operator approval (granted).
- **Author handoff:** next step is an implementation plan (`writing-plans`),
  which will append `BACKEND-/FRONTEND-/INTEGRATION-/TEST-` tasks to
  `ImplementPlan.md`.

---

## 1. Problem

The storefront header renders an account icon (`TopNav.tsx:177`) that is a bare
`<button>` with no handler and no link — clicking it does nothing. It is dead
because v1 has no account concept (`PRD.md:29`, `PRD.md:49` — "guest + phone
only"). The Footer's "Track Order" link is the same kind of placeholder
(`Footer.tsx:57` → `/`, commented "v2 — needs account/order lookup").

This spec turns the account icon into a working sign-in + account experience and
gives guests a way to look up an order.

## 2. Goals

- Signed-in customers can: sign in, see an account home, view their order
  history, edit profile (name + phone), and manage saved addresses.
- The account icon works: a popover that offers social sign-in when signed out
  and account navigation when signed in.
- Guests can look up an order by reference + phone (`/track`), fixing the
  Footer link.

## 3. Non-goals (explicit out of scope)

- Email/password (emailpass) accounts — contradicts `PRD.md` "no passwords
  stored". The starter's dormant emailpass helpers are NOT revived.
- Phone OTP sign-in — no SMS/OTP provider exists in the locked stack.
- TikTok login (deferred to a later phase per `PRD.md:46`).
- Addresses outside Cambodia.
- Retroactively merging pre-login guest orders into an account.
- Self-service order cancellation / returns.

## 4. Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Auth model | **Social login only** (Facebook + Google). No passwords. |
| 2 | Account surfaces | Home + Logout, Order history, Profile (name/phone), Saved addresses. |
| 3 | Guest order lookup | **In scope** — `/track` page + `POST /store/orders/lookup`. |
| 4 | Sign-in entry | Account icon opens an **in-nav popover** with the two providers (no `/login` route). |
| 5 | Architecture | **Server-Component guard + unified session-aware customer read** (no middleware auth gate). |

## 5. Existing building blocks (reused, not rebuilt)

- **Medusa core** customer / auth / address / order entities.
- **Facebook OAuth** — `backend/src/api/store/auth/facebook/{route,callback}.ts`
  (BACKEND-05/05B). Creates a customer + `connect.sid` session, writes a
  `customer_social_identity` row, redirects to `/checkout`.
- **Google OAuth** — `backend/src/api/store/auth/google/...` (BACKEND-05C/05D).
- **`customer_social_identity`** module — `backend/src/modules/social-identity/`.
- **Session-aware customer read** — `storefront/src/lib/auth.ts`
  (`buildSessionHeaders` forwards both `connect.sid` and JWT;
  `getSocialLoginPrefillName` proves a logged-in customer is readable
  server-side).
- **Customer/address data layer** — `storefront/src/lib/data/customer.ts`
  (`retrieveCustomer` with `*orders`, `updateCustomer`, address CRUD). Currently
  JWT-only; see §7.
- **Same-origin proxy** — `storefront/src/middleware.ts` rewrites `/store/auth/*`
  (and the invoice route) to the backend with the publishable key injected.
- **Order confirmation** — `storefront/src/app/order/[id]/page.tsx`.
- **Login buttons** — `storefront/src/components/checkout/{FacebookLogin,GoogleLogin}.tsx`.
- **Currency wiring** — `CurrencyProvider` + `ui/Price` (USD/KHR toggle).
- **Dev-mock OAuth seams** — `FB_GRAPH_DEV_BASE_URL`, `GOOGLE_TOKEN_DEV_BASE_URL`
  (used by `fb-oauth`/social specs) for end-to-end login in tests.

## 6. Architecture (Approach A)

`/account/*` pages are Server Components. A shared `app/account/layout.tsx`
resolves the current customer from the request session and `redirect("/")` when
there is none; every child page is therefore guaranteed an authenticated
customer. No authentication logic lives in `middleware.ts` (it stays a
proxy-only shim). The nav popover, a Client Component, learns signed-in state
through a small server action so it can render the right menu without shipping
any customer data it doesn't need.

Rejected alternatives: a middleware auth gate (can only cheaply check cookie
*presence*, not validity, and bloats the deliberately-minimal middleware); a
client-side account shell (flashes unauthenticated content, loses SSR, diverges
from the repo's "Server Components by default" rule).

## 7. Session unification (prerequisite)

There are two customer reads today and they disagree:

- `lib/data/customer.ts → retrieveCustomer()` uses `getAuthHeaders()` — **JWT
  only**.
- `lib/auth.ts → retrieveSessionCustomer()` uses `buildSessionHeaders()` — **JWT
  *or* `connect.sid`**.

Social login yields a `connect.sid` session and **no JWT**, so `retrieveCustomer()`
returns `null` for exactly our users. Fix:

1. Extract the session-aware header builder (`buildSessionHeaders`) into a shared
   helper importable by both `lib/auth.ts` and `lib/data/customer.ts`.
2. `retrieveCustomer()` uses it, keeps the `*orders` field expansion, and reads
   with `cache: "no-store"` (a `connect.sid`-scoped read must never be cached
   across users — the current `force-cache` is unsafe for shared session reads).
3. `updateCustomer` and the address CRUD helpers switch to the same session-aware
   headers.

## 8. Components

### 8.1 Nav popover — `components/layout/AccountMenu.tsx`

Replaces the dead button at `TopNav.tsx:177`. Client Component. State comes from
a new server action `lib/account.ts → getAccountMenuState()` returning
`{ name } | null` (display name only — no phone/PII crosses to the client).

- **Signed out:** popover with `Continue with Facebook` / `Continue with Google`
  → `/store/auth/facebook?intent=account` and `/store/auth/google?intent=account`
  (same-origin; middleware-proxied so the OAuth `state` + `connect.sid` cookies
  land on the storefront origin). Reuses the pill geometry of the checkout login
  buttons; ink, never accent (`design.md`).
- **Signed in:** greeting + links — Account, Orders, Profile, Addresses, Log out.
- **A11y:** `aria-haspopup="menu"`, `aria-expanded`, Escape-to-close,
  click-outside-to-close, focus returns to the trigger on close (mirrors the
  existing drawer logic in `TopNav`).
- **Mobile drawer parity:** the drawer (`TopNav.tsx:222`) currently has no
  account entry; add the same signed-in/signed-out entries there so the two nav
  surfaces stay consistent.

### 8.2 Account section nav — `components/account/AccountNav.tsx`

In-account navigation between Home / Orders / Profile / Addresses, rendered by
`app/account/layout.tsx`.

### 8.3 Forms

- `components/account/ProfileForm.tsx` — client form; zod-validated.
- `components/account/{AddressList,AddressForm}.tsx` — reuse `DeliveryForm` field
  patterns; no new UI primitives.
- `components/track/TrackForm.tsx` — client form for guest lookup.

## 9. Backend change — OAuth return intent

The callbacks hard-redirect to `/checkout` (`facebook/callback/route.ts:51,309`;
Google equivalent). `security.md` forbids echoing a client-supplied redirect
target, so the return path is resolved server-side:

1. Start routes accept optional `?intent=`, resolved against a hard-coded map
   `{ checkout: "/checkout", account: "/account" }` (default `checkout`).
2. The resolved path is stored in the **existing single-use Redis state entry**
   (`cache.set(stateKey(state), { issued_at, return_to }, ttl)` —
   `facebook/route.ts:206`), which is already browser-bound and consumed once.
3. The callback (which already loads that entry at `facebook/callback/route.ts:191`)
   reads `return_to`, re-validates it against the same hard-coded allowlist
   (defense in depth, default `/checkout`), and redirects there.

Tamper-proof (the target rides the server-side, single-use state, never a
client-readable param). Touches four files: Facebook + Google × start + callback.
Pre-existing `/checkout` behavior is unchanged when no `intent` is supplied.

## 10. Account pages

- **`/account` (home)** — greeting by name; cards/links to Orders, Profile,
  Addresses; Logout.
- **`/account/orders`** — lists the customer's orders (reference, date, total,
  status); each row links to the existing `/order/[id]`. Totals render through
  the currency wiring (`CurrencyProvider` / `ui/Price`), USD/KHR per the toggle.
- **`/account/profile`** — edit first/last name + phone (`updateCustomer`). Phone
  validated with the PRD regex `^(\+855|0)[1-9]\d{7,8}$` on client and server.
  Email is provider-supplied and shown read-only.
- **`/account/addresses`** — list + add/edit/delete via the existing
  `addCustomerAddress` / `updateCustomerAddress` / `deleteCustomerAddress`
  (session-aware headers). Country fixed to Cambodia.

All four are Server Components behind the `layout.tsx` guard.

## 11. Guest order lookup

- **`/track`** — form (order reference + phone) → server action → `POST
  /store/orders/lookup`.
- **`POST /store/orders/lookup`** (new custom store route, `zod`-validated):
  - Input `{ reference, phone }`; `phone` matches the PRD regex.
  - **Matches on the order ULID `id`** (`order_…` — the same non-guessable id
    `/order/[id]` already uses) **plus** a phone match against the order's stored
    phone. The sequential `display_id` is deliberately **not** the lookup key
    (guessable).
  - On match: returns minimal order status + the invoice link (carrying the
    order's invoice token). On any miss: a generic `not_found` (no separate
    signal for wrong-ref vs wrong-phone → no enumeration).
  - Rate limits: 10/min/IP and 20/hour/phone. Phone is never logged (redaction
    at the logger boundary). Error shape `{ error, request_id }`.
- **Footer** — `Track Order` href `/` → `/track` (`Footer.tsx:57`).

### Security note (accepted risk)

Phone is a weak second factor and is not OTP-verified. The mitigations are: the
lookup key is a non-sequential ULID (not the sequential display id), the phone
must additionally match, errors are non-enumerable, and limits are strict. Only
non-sensitive order *status* + the already-issued invoice token are returned.
This matches the v1 trust model (phone is the identifier; no OTP infra).

## 12. Logout

Server action: destroy the `connect.sid` session via the backend (through the
same-origin proxy), clear any `_medusa_jwt` cookie, revalidate the customer cache
tag, then `redirect("/")`. This replaces the starter's `signout()`, whose
`/${countryCode}/account` redirect (`customer.ts:143`) is a 404 in this
flat-routed storefront.

**Known-unknown (resolve at implementation):** confirm Medusa v2's exact
session-destroy endpoint for the `connect.sid` session established by the OAuth
callback (the callback sets `req.session.auth_context`). Fallback if no direct
endpoint fits: expire the `connect.sid` cookie on the storefront origin and clear
server-side auth context. This is a mechanism detail, not a design fork.

## 13. Known limitation (documented behavior)

**Order history contains only orders placed while signed in.** Checkout is
guest-first and social login is optional, so a customer who signs in *after* a
guest purchase will not see that order under `/account/orders`. This is exactly
why `/track` exists. Stated here so it is expected behavior, not a defect.

## 14. Testing

- **E2E (Playwright, `storefront`, `npm test`)** using the dev-mock OAuth seams:
  - signed-out icon → popover shows both providers;
  - full mocked login → `/account` renders the name; orders list renders; profile
    edit persists; address add/edit/delete works;
  - direct `/account` hit while signed out → redirect to `/`;
  - `/track` happy path; wrong-phone → generic not-found; rate-limit triggers.
- **Unit:** phone-regex validation; lookup match logic; the shared session header
  builder.

## 15. Security checklist (consolidated, from `security.md`)

- All `/account` reads are session-scoped — no client-supplied ids; ownership is
  the session.
- Session reads are `no-store` (no cross-user cache bleed).
- OAuth return target is a server-side hard-coded allowlist — no open redirect.
- Lookup: strict rate limits, non-enumerable errors, ULID-keyed, phone never
  logged.
- Provider links are same-origin (proxied) to preserve `state` + `connect.sid`.
- No token/session in `localStorage`/`sessionStorage`.
- Phone validated with the PRD regex at every entry point; PII (phone/address)
  kept out of logs.

## 16. Proposed task breakdown (finalized in the plan)

- **BACKEND** — OAuth return-intent (FB + Google start/callback); `POST
  /store/orders/lookup`.
- **FRONTEND** — session-aware customer read; account layout + guard; `AccountMenu`
  popover + drawer parity + logout; account home; orders; profile; addresses;
  `/track` + Footer wiring.
- **INTEGRATION** — end-to-end wiring + dev-mock E2E.
- **TEST** — Playwright + unit.

Exact IDs (next-free `BACKEND-/FRONTEND-/INTEGRATION-/TEST-` numbers) are assigned
when the implementation plan is written against `ImplementPlan.md`.
