# Bakong KHQR payments

Status: **BACKEND-03 + BACKEND-03B implemented** — KHQR "start" (QR generation)
and "status" (server-side verify → order completion + stock-out). A live
end-to-end "paid" flip requires a configured Bakong proxy (deploy-time secret);
in sandbox without a proxy the status endpoint correctly stays `pending`.

Ali Store's online payment path is **Bakong KHQR** (Individual account, v1),
implemented as a custom Medusa payment provider. Cash-on-Delivery is the second
path (BACKEND-04).

## Architecture

```
Storefront ──POST /store/payments/khqr/start──▶ Medusa backend
                                                  │  (custom payment provider
                                                  │   `pp_bakong_khqr`)
                                                  ├─ build dynamic KHQR (local, vendored)
                                                  ├─ reserve inventory (payment window)
                                                  ├─ payment_collection + payment_session
                                                  └─ deeplink ──HTTPS──▶ in-Cambodia proxy ──▶ Bakong Open API
```

- **Native payment model (PRD §4, locked decision):** `/start` creates a
  `payment_collection` + a Bakong `payment_session` and reserves stock. The
  **order is created at cart completion** after server-side verification
  (BACKEND-03B) — `/start` does **not** create an order.
- **All Bakong traffic goes through the in-Cambodia proxy** (`BAKONG_PROXY_URL`).
  Bakong is never called from the client, and never directly from the backend.
  This is what lets the Medusa backend run anywhere (Proxmox or cloud) while only
  a thin proxy must sit in Cambodia.

## Endpoint contract

### `POST /store/payments/khqr/start`

Generate a dynamic KHQR + deeplink for a cart and hold its stock.

- **Auth:** guest checkout — the non-guessable `cart_id` is the capability
  (same model as Medusa's native `/store/carts/:id`).
- **Body:** `{ "cart_id": string, "currency": "USD" | "KHR" }` (zod-validated).
- **200:** `{ "qr": string, "deeplink": string | null, "reference": string, "expires_at": string }`
  - `qr` — full EMVCo KHQR string (render as a QR code).
  - `deeplink` — Bakong short link; `null` in sandbox when the proxy is not
    configured (the QR alone is enough to scan).
  - `reference` — `md5(qr)`, the status-check / idempotency key (BACKEND-03B).
  - `expires_at` — ISO timestamp; aligns with the 20-min reservation TTL.
- **Errors** (`{ "error": string, "request_id": string }`):
  - `409 out_of_stock` — a managed-inventory line item can't be satisfied.
  - `502 payment_gateway_unavailable` — proxy/Bakong configured but unreachable.
  - `404 cart_not_found`, `400 empty_cart` / `invalid_cart_total`,
    `429 rate_limited`.
- **Idempotency:** repeated `/start` for the same cart reuse the existing,
  non-expired Bakong session (same `qr`/`reference`) instead of reserving stock
  and creating a new session — a double-tapped "Pay" can't stack reservations.
- **Rate limits:** 5/min per client IP **and** 20/hour per cart (the guest
  "session"), cache-module fixed window. The client IP is taken from a trusted
  hop only — `X-Forwarded-For` is ignored unless `TRUSTED_PROXY_COUNT` is set to
  the number of reverse proxies in front of the backend (default 0 = socket IP),
  so a spoofed header can't evade the limiter.

### `GET /store/payments/khqr/status?reference=` — **BACKEND-03B**

Confirm a KHQR payment and finalize the order. The storefront polls this while
the customer pays.

- **Auth:** guest checkout — the (non-guessable) `reference` is the capability.
  `/start` records a server-side `reference → cart` mapping (in the cache) that
  this endpoint reads; it then re-confirms the reference belongs to a Bakong
  session on that cart.
- **Query:** `?reference=<md5>` — 32 lowercase hex chars (zod-validated).
- **200:** `{ "status": "pending" | "paid" | "expired" }` (plus `order_id` when
  `paid`).
  - `pending` — not yet confirmed by Bakong (keep polling).
  - `paid` — verified; the order has been created and the payment captured.
  - `expired` — the QR window elapsed before payment; the `/start` reservation
    is released and the client should stop polling.
- **Errors** (`{ "error": string, "request_id": string }`):
  - `502 payment_gateway_unavailable` — proxy configured but unreachable / SSRF-blocked.
  - `404 reference_not_found`, `400 invalid_reference`, `429 rate_limited`.
- **Verification (server-side only):** the status is decided by a proxy call to
  Bakong's `check_transaction_by_md5` keyed on the `reference` — a
  client-reported status is never trusted (security.md "Payments"). The result
  is cached ≥3s server-side. In sandbox (no proxy configured) the endpoint
  cannot confirm and stays `pending` — it never fabricates `paid`.
- **On `paid` (order finalization, PRD §4 — order created at completion):**
  1. release the reservation `/start` created for the cart's line items;
  2. run `completeCartWorkflow` → creates the order and **re-reserves +
     authorizes/captures** the payment (the Bakong provider's `authorizePayment`
     re-verifies via the proxy as the authorization gate, so the order is never
     placed without a live server-side confirmation);
  3. write one idempotent `stock_movement(type=out)` per line item
     (`order_id`, `created_by="system"`).
- **Reservation reconciliation:** the `/start` reservation is released **before**
  `completeCartWorkflow` runs, because completion creates its own order
  reservations — releasing first avoids double-holding (and overselling) stock.
- **Idempotency:** an existing `order_cart` link short-circuits to `paid`;
  `completeCartWorkflow` is idempotent; the stock-out write skips if `out` rows
  already exist for the order.
- **Rate limits:** 60/min + 120/hour per `reference`, plus a 60/min per-IP
  backstop (cache-module fixed window). Client IP uses the same trusted-hop rule
  as `/start`.

## Vendored KHQR generation

Per `.claude/rules/security.md`, we **do not depend on the `bakong-khqr`
package**. The EMVCo Merchant-Presented-Mode + NBC KHQR logic is vendored in
`backend/src/modules/bakong-payment/lib/khqr.ts`:

- TLV encoding `ID(2) + LEN(2) + VALUE`; individual account in **tag 29**
  (sub-00 = `BAKONG_ACCOUNT`), currency **tag 53** (`840` USD / `116` KHR),
  amount tag 54, country `KH`, merchant name/city (tags 59/60), bill number in
  tag 62-01, KHQR timestamp in tag 99 (creation + expiry, epoch ms).
- **CRC-16/CCITT-FALSE** (poly `0x1021`, init `0xFFFF`, no reflection) over the
  payload incl. the literal `6304` prefix.
- **`reference` = `md5(qr)`** (lowercase hex).

The module is pure/local — it makes **no** network call. The only outbound
Bakong call in `/start` is the deeplink lookup (`lib/proxy.ts`).

> ⚠️ **Before go-live:** generate one QR with the real `BAKONG_ACCOUNT`, scan it
> in the Bakong app, and confirm a sandbox payment is found by md5. The tag-29
> single-subtag shape and tag-99 timestamp are the most profile-specific pieces
> and a live scan is the authoritative validation.

## Proxy & SSRF

`lib/proxy.ts` calls the proxy's `generate_deeplink_by_qr` path with a Bearer
token. SSRF guard (`security.md`):

- proxy URL comes from env only (never request input); must be `https://`, no
  embedded credentials;
- the URL is validated **at boot** (`assertSafeProxyUrl` in `medusa-config.ts`)
  so a misconfigured proxy fails startup, not mid-checkout;
- host must be on `BAKONG_PROXY_ALLOWED_HOSTS` when that allowlist is set — and
  the allowlist is **mandatory in production** (boot fails if `BAKONG_PROXY_URL`
  is set but the allowlist is empty);
- host must not resolve to a private/loopback/link-local address (re-checked at
  call time — DNS-rebind defense);
- redirects are rejected (no 3xx following).

The QR string, token, and `reference` are **never logged**. Proxy failures and
blocked-SSRF attempts are logged server-side by `request_id` only (no QR / token
/ reference), and surface to the client as a generic `502`.

## Environment variables

| Var | Required | Notes |
|-----|----------|-------|
| `BAKONG_ACCOUNT` | prod | Individual account `name@bank` (tag 29-00). Secret. |
| `BAKONG_TOKEN` | prod | Bakong bearer token. Secret. Never logged. |
| `BAKONG_PROXY_URL` | prod | In-Cambodia proxy base (mirrors Bakong `/v1`). |
| `BAKONG_PROXY_ALLOWED_HOSTS` | recommended | Comma-separated proxy host allowlist (SSRF). |
| `BAKONG_MERCHANT_NAME` | optional | Tag 59; default `Ali Store`. |
| `BAKONG_MERCHANT_CITY` | optional | Tag 60; default `Phnom Penh`. |
| `BAKONG_QR_EXPIRES_MINUTES` | optional | QR/reservation window; default `20`. |

In dev/sandbox these can be empty: the QR + reference are still generated, the
deeplink is `null`, and the endpoint stays usable.

## Provider registration

Registered under the Payment Module in `medusa-config.ts` with `id: "khqr"` and
provider identifier `bakong` → resolved provider id **`pp_bakong_khqr`**.

## Follow-ups (other tasks)

- **BACKEND-07** — replace BACKEND-03B's inline `stock_movement(out)` write with
  the shared stock-out service method (and add the admin stock-in endpoint).
- **BACKEND-10** — expiry job: release reservations + cancel sessions/orders
  still unpaid past `expires_at`.
- **INTEGRATION-05 / -08** — storefront wiring + currency-through-checkout.
- Error responses currently use `{ error, request_id }` for controlled cases;
  a global error handler to normalize framework errors is out of scope here.
