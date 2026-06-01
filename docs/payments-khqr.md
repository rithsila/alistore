# Bakong KHQR payments

Status: **BACKEND-03 implemented** (KHQR "start" / QR generation). Verification
(`/khqr/status`), capture, and stock-out are **BACKEND-03B** (not yet built).

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
- **Rate limits:** 5/min and 20/hour per IP (cache-module fixed window).

### `GET /store/payments/khqr/status?reference=` — **BACKEND-03B (pending)**

Server-side verification by `reference`/md5 via the proxy. Until it ships the
payment session stays `pending`; the provider never reports a payment as
captured without a server verify.

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
- host must be on `BAKONG_PROXY_ALLOWED_HOSTS` when that allowlist is set;
- host must not resolve to a private/loopback/link-local address (re-checked at
  call time — DNS-rebind defense);
- redirects are rejected (no 3xx following).

The QR string, token, and `reference` are **never logged**.

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

- **BACKEND-03B** — `/khqr/status` verify by md5 via proxy; on `paid`: capture,
  complete cart → order, write `stock_movement(out)`. Must **reconcile the
  reservation** created at `/start` (avoid double-reserve at completion).
- **BACKEND-10** — expiry job: release reservations + cancel sessions/orders
  still unpaid past `expires_at`.
- **INTEGRATION-05 / -08** — storefront wiring + currency-through-checkout.
- Error responses currently use `{ error, request_id }` for controlled cases;
  a global error handler to normalize framework errors is out of scope here.
