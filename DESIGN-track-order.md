# Track Order — Design & Research (v2 design input)

**Status:** Deferred to v2 · **Decision date:** 2026-06-11 · **Owner:** Sila
**Stack:** Medusa v2.15.3 + Next.js 15 · guest-checkout-only (phone identifier, no accounts)

> This is a parked design note, not an active task. The footer "Track Order" link stays
> `href="/"` until a v2 task is opened. Nothing in the repo was changed when this was written.
> Companion docs: `PRD.md` (§3 flows, §4 data model, §7 API), `DESIGN.md` (tokens/components),
> `ImplementPlan.md` (line ~518 parks Track Order: *"v2, needs accounts/lookup"*).

---

## 1. Decision summary

| Question | Decision |
|---|---|
| Build vs. adopt a package | **Build custom — zero new dependencies** (decision matrix → nothing off-the-shelf fits) |
| How a guest proves ownership | **Token magic-link only** (reuse the existing 256-bit order-token pattern) |
| v1 or v2 | **Deferred to v2.** The token approach removes the original "needs accounts" blocker, so it is *buildable* in v1 — but the owner chose to keep it parked. |
| `order-management` Medusa plugin | **NO-MATCH** for this project (see §6). Good design reference only. |

**One-line answer:** the Track Order "system" is a small custom Medusa store route
(`GET /store/orders/track`) guarded by a per-order capability token, plus a flat `/track`
page — reusing the invoice-token primitive already shipped in `backend/src/lib/order-token.ts`.

---

## 2. What already exists in the repo

- **`storefront/src/app/order/[id]/page.tsx`** — the post-checkout **confirmation receipt**
  (FRONTEND-19). It is *not* a lookup; it is reached immediately after paying and reads
  `order_id` + `invoice_token` straight from the COD/KHQR response. It already demonstrates the
  `?token=` carry pattern a `/track` page would mirror.
- **`backend/src/lib/order-token.ts`** — a reviewed capability-token primitive:
  `crypto.randomBytes(32)` (256-bit) base64url, stored on `order.metadata`, 30-day TTL,
  admin-revocable, `timingSafeEqual` compare. Currently mints/verifies the **invoice** token.
- **`backend/src/api/store/orders/[id]/invoice/route.ts`** — the exact route template to copy:
  zod validation, `query.graph` field selection, `timingSafeEqual`, fixed-window `overLimit()`
  rate-limit, `{ error, request_id }` body, `Cache-Control: no-store` + `X-Content-Type-Options: nosniff`.
- **`backend/src/api/store/orders/cod/route.ts`** and **`.../payments/khqr/status/route.ts`** —
  where `order_id` + token are minted and returned to the buyer (where a track-link is also issued).
- **`storefront/src/lib/checkout.ts`** — how `order_id` / `invoice_token` already flow to the client.

---

## 3. The system (locked approach: token magic-link)

**Auth model — possession = proof.** A guest never types credentials. They open a `/track` link
carrying a high-entropy token; the server verifies the token and returns status only.

```
Storefront:  /track?id=<display_id>&token=<256-bit base64url>

Backend:     GET /store/orders/track
               ├─ zod-validate id + token (reject before any service call)
               ├─ query.graph(entity:"order", filters:{ display_id })
               │     fields: status, payment_status, fulfillment_status,
               │             created_at, metadata.confirmation_status,
               │             fulfillments.shipped_at, fulfillments.delivered_at,
               │             fulfillments.labels.tracking_number / tracking_url   ← NO PII
               ├─ timingSafeEqual(token, order.metadata.track_token)
               ├─ rate-limit: per-IP + per-display_id  (existing overLimit() helper)
               └─ 403 (bad/expired token) / 404 (no order) → identical generic body
```

**Token.** Generalize `order-token.ts` rather than invent a new scheme — mint a sibling
`track_token` (or widen the existing capability to be multi-purpose). Same security model the
invoice route already passed review with: 256-bit, `timingSafeEqual`, 30-day TTL, admin-revocable.

**Entry points (no email infra needed).** The track link is issued the same way the invoice link
already flows — appended to the COD (`POST /store/orders/cod`) and KHQR (`khqr/status`)
confirmation responses, surfaced on the existing `/order/[id]` confirmation screen, and
**re-sendable to the customer over Telegram/Facebook** (the shop's real support channel). This is
exactly what dissolves the original v2 blocker: no accounts, no passwords, no SMS/email gateway.

**Response is status-only.** Never return phone, full address, or email. Return only what a status
card needs. Unknown order and bad token return the **same** generic body so `display_id`s can't be
enumerated.

---

## 4. Status model the UI maps (real Medusa v2 enums)

- **`fulfillment_status`**: `not_fulfilled → fulfilled → (partially_)shipped → (partially_)delivered | canceled`
- **`payment_status`**: `not_paid | awaiting | authorized | captured | partially_captured | refunded | canceled | requires_action`
- **`order.status`**: `pending | completed | draft | archived | canceled | requires_action`
- **COD nuance:** stays `payment_status: not_paid` + custom `metadata.confirmation_status: "pending_confirmation"`
  until the operator captures cash on delivery.
- **KHQR:** reaches `captured` (or `authorized`) after the server-side Bakong verify.
- **Progress signal for a manual shop:** `fulfillments.shipped_at` / `delivered_at` timestamps are
  the most reliable cue. Tracking lives on **Fulfillment → FulfillmentLabel**
  (`tracking_number`, `tracking_url`) — free-text the operator can type in Admin even with no
  carrier; optional, readable via the Store API with nested field selection.

**Customer-facing timeline (4 steps), flat Tailwind, no stepper library:**

```
●  Placed            <created_at>
●  Paid / Pending    payment_status=captured  ·  or COD "pending_confirmation"
○  Shipped           fulfillments.shipped_at  (+ optional tracking #)
○  Delivered         fulfillments.delivered_at
```

Render as `<li>` rows separated by a single `border-hairline` divider. No shadows, gradients,
or stepper dependency — on-brand with `DESIGN.md`'s flat system.

---

## 5. Off-the-shelf evaluation (why "build custom")

| Candidate | Weekly dl | Verdict | Reason |
|---|---|---|---|
| `ts-tracking-number` | ~14k | NO | Parses **carrier** tracking numbers — you have no carrier (manual local delivery). |
| `aftership` / `@aftership/tracking-sdk` | ~8k / ~6.6k | NO | Paid SaaS aggregator; nothing to aggregate; new dep. |
| `@easypost/api` / `shippo` | ~78k / ~45k | NO | Carrier label/shipping SDKs (US). Overkill, irrelevant. |
| `@cw-parcelpanel/headless-react` | ~71 ⚠ | NO | Shopify-only (`*.myshopify.com`). Wrong platform; <100 dl. |
| `@mindinventory/order-tracking` | ~16 ⚠ | NO | React **Native** widget; not web; unmaintained; <100 dl. |
| `react-step-progress-bar` | ~20k | NO | Stale (2022); a 4-step timeline is trivial markup — gold-plating. |
| `order-management` (Medusa v2 guest-OTP) | ~21 ⚠ | NO-MATCH | Closest in concept; see §6 for the full teardown. |

**Decision-matrix outcome:** no Adopt, no Extend → **Build-custom-but-informed (Compose existing
primitives).** Every shipment SDK solves a carrier problem you don't have; every UI component is
wrong-platform or unmaintained; the one on-target plugin fails the project's gates.

---

## 6. `order-management` plugin — deep comparison (requested)

The single most on-topic artifact found: an npm package (bare name **`order-management`**) that
adds a Medusa v2 **guest order portal** with an OTP flow
(`POST /store/otp/request` → `/store/otp/verify` → guest-JWT-scoped `GET /store/guest-orders/:id`),
plus a whole returns/exchanges/refunds suite and admin UI. Investigated by unpacking the published
tarball (v0.0.79) — there is **no public source repo** to review.

### Profile (hard facts)

| Field | Value |
|---|---|
| Latest version | `0.0.79` (2026-05-08) — **79 releases, never reached 0.1.0** |
| License | MIT · Unpacked ~1.03 MB, 98 files |
| Maintainer | single individual (`pradip1995`); `author: "Medusa"` is **boilerplate** from the plugin template — **not** an official MedusaJS package |
| Public repo | **None** — no `repository`/`homepage`/`bugs`/issues/changelog. Only auditable by unpacking the tarball. |
| Weekly downloads | ~21 (single-digit/day externally) |
| Medusa peer deps | **all `@medusajs/* = 2.11.2` exact** (older than our pinned 2.15.3; not a range) |
| Description | literally **"A starter for Medusa plugins."** (unmodified template string) |

### Three independent blockers (each sufficient)

1. **OTP is email-only and email-keyed.** The OTP request route **requires an HTML email template**
   and `sendNotification(... channel:"email")` is **hardcoded**; identity is resolved by
   **customer email** (`has_account:false`). It accepts a `phone` field but still renders/sends the
   **email** channel — **there is no SMS or Telegram path in the OTP flow**. Making it work for a
   **phone-identifier, Telegram-only** shop requires standing up email infra you don't run, **or
   forking** to swap the channel + rewrite the identity model. That defeats the purpose.

2. **Medusa version conflict.** Peers pin **`2.11.2`** exactly vs. our pinned **`2.15.3`**.
   `npm ci` peer resolution fails; you'd need `--legacy-peer-deps`/overrides (**violates the
   "exact pins, `npm ci`" policy**) and run a plugin that leans on core order/return/exchange
   workflows against an **untested newer** framework minor — real drift risk.

3. **Pre-1.0, unreviewable, security-weak.** Single-author, no public repo, ~21 dl/wk — **fails the
   project rule against deps under ~100 weekly downloads without source review** (and there's no
   repo to review). The OTP core uses **`Math.random()`** (not crypto-secure), an **in-memory `Map`**
   store (breaks multi-instance / on restart), and **no rate limiting** — exactly what `security.md`
   forbids; you'd rewrite the core anyway. (Aside, not relevant to KHQR/COD but a judgment signal:
   its `payment_detail` model stores **raw card PAN + CVV** in a plain JSON column — a PCI violation.)

### When would adopting it ever beat the custom route?

Only in the near-opposite project: an **email-identified** storefront on Medusa **~2.11.x** that
**already runs an email notification provider** and wants the **entire** post-purchase suite
(customer + guest **returns, exchanges/swaps, refund-payment mapping**) with **ready-made admin UI**
— not just "track my order." There, it saves weeks. For a phone-only, Telegram-only, KHQR "track
order" page on pinned 2.15.3, the custom token route is **less code, no version conflict, no new
dependency, no email infra, and directly `security.md`-compliant.**

**Verdict: NO-MATCH.** Reference its OTP-portal design if guest accounts/returns ever land in v2+;
do not adopt it for Track Order.

---

## 7. v2 task shape (when picked up)

- **BACKEND-XX** — `GET /store/orders/track` route. Template: copy
  `backend/src/api/store/orders/[id]/invoice/route.ts` verbatim (zod, `query.graph` status-only
  fields, `timingSafeEqual`, `overLimit`, `{ error, request_id }`, `no-store` / `nosniff`).
- **BACKEND-XX** — generalize `order-token.ts` to mint/verify a `track_token`.
- **INTEGRATION-XX** — issue the track link in the COD + KHQR confirmation responses
  (extend `storefront/src/lib/checkout.ts`, mirroring the invoice-token carry).
- **FRONTEND-XX** — `/track` page: flat 4-step timeline, reuses the `?token=` carry pattern from
  `order/[id]/page.tsx`. Use named `DESIGN.md` tokens only; test at 360px.
- **TEST-XX** — `track.spec.ts`: valid token shows status; wrong/expired token → generic 403;
  unknown id → generic 404; response carries no PII.
- **Footer** — flip "Track Order" `/` → `/track`, updating `TopNav` + `Footer` together (design.md).

**Security checklist for the task** (from `.claude/rules/security.md`): zod-validate every input;
storefront uses publishable key only; rate-limit `GET /store/orders/track` per-IP + per-reference;
generic non-revealing errors; never log phone/address; token ≥128-bit + `timingSafeEqual`;
`Cache-Control: no-store`.

---

## 8. Sources

- Medusa v2 Store API + source: `orders/middlewares.ts` (`GET /store/orders/:id` unauthenticated;
  `GET /store/orders` customer-only), `[id]/route.ts` (`// TODO: auth?`), `core/types order/common.ts`
  (the status enums), FulfillmentLabel model (`tracking_number`/`tracking_url`).
- `medusajs/nextjs-starter-medusa` `src/lib/data/orders.ts` — `retrieveOrder`/`listOrders` use
  `getAuthHeaders()`; no guest track page.
- Medusa discussion #4437 (guest lookup intent), PR #13695 (order-detail ownership filter unreliable).
- `order-management` npm metadata + unpacked tarball v0.0.79 (`package.json`, `services/otp-service.js`,
  `api/store/otp/*`, `workflows/steps/send-notification-step.js`, `api/store/guest-orders/*`,
  `modules/payment-detail/models/payment-detail.js`); npm downloads API.
- npm registry health data for the candidates in §5.
