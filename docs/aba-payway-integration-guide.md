# ABA PayWay Integration Guide — Ali Store

*Researched: 2026-06-10 · Sources: official PayWay Developer Suite + cross-verified community SDKs · Confidence: High (hash spec verified against two independent sources and proven by the local sandbox harness)*

This guide covers everything needed to add ABA PayWay as a payment provider:
how to request an account, the API contract, a review of where our codebase
stands today, the integration blueprint, and the test sandbox.

---

## 1. What ABA PayWay is (and why it fits us)

PayWay is ABA Bank's hosted payment gateway. One integration gives the
customer **ABA KHQR, ABA Pay, Visa/Mastercard, WeChat Pay, Alipay and Google
Pay**. Two properties matter for Ali Store:

- **`payment_option: "abapay_khqr_deeplink"` returns a raw `qr_string` + ABA
  deeplink as JSON** — exactly the shape our existing KHQR pay screen
  (`storefront/src/app/checkout/khqr/page.tsx`) already renders. We can keep
  our poll-based UX and swap the QR source.
- **Settlement goes to your ABA business account**, and merchant onboarding is
  done by ABA's PayWay team — an alternative path now that direct Bakong
  merchant registration is blocked (see `docs/bakong-khqr-setup.md`).

Trade-offs vs. our current direct-Bakong module: PayWay charges merchant fees
(negotiated at onboarding, typically ~0.5% KHQR / ~2-3% cards), requires a
**registered business** with an ABA business account, and requires
domain/IP whitelisting before API calls work.

---

## 2. How to request ABA PayWay

### 2.1 Sandbox (do this today — free, self-service)

1. Register at **<https://sandbox.payway.com.kh/>** (PayWay sandbox portal).
2. You receive a **sandbox `merchant_id` and `api_key` by email**.
3. Give the PayWay integration team one **domain or IP to whitelist** —
   API calls from non-whitelisted origins fail with `status.code 6: wrong domain`.
4. Test against `https://checkout-sandbox.payway.com.kh/` using the harness in
   `sandbox/aba-payway/` (see §7).

### 2.2 Production merchant account

Prerequisites (hard requirements, per ABA):

1. **Company registered with the Ministry of Commerce** (sole proprietorship
   works; PayWay's full suite is for business accounts, not individual ones).
2. **ABA business bank account** — open this at a branch first.
3. Apply for PayWay: via <https://merchant.payway.com.kh/self-register/>, the
   [ABA PayWay business page](https://www.ababank.com/business/aba-payway/),
   or email **paywaysales@ababank.com**.
4. Onboarding: ~US$100 one-time fee, typically **a few weeks**, no monthly fee
   (ABA reserves the right to charge merchants with <5 transactions/month).
5. After sandbox testing passes, the same sales contact issues **production
   credentials** for `https://checkout.payway.com.kh/`.

> ⚠️ Items to confirm with the PayWay sales contact during onboarding (not
> published): exact KHQR/card fee rates, settlement timing (T+1 vs T+2), and
> whether your production server IP (Proxmox VM) and `shop.<domain>` both need
> whitelisting.

---

## 3. API contract (the two endpoints we need)

Base URLs — **sandbox:** `https://checkout-sandbox.payway.com.kh` ·
**production:** `https://checkout.payway.com.kh`. All endpoints are `POST`.

### 3.1 Authentication = HMAC hash on every request

There is no bearer token. Every request carries a `hash`:

```
hash = base64( HMAC-SHA512( concatenated_fields, api_key ) )
```

The concatenation order is **fixed per endpoint** and the hash must be
computed over the **exact strings sent** (never hash a number then send a
formatted string). Optional fields you don't send contribute nothing
(equivalently: empty string).

### 3.2 Purchase — create a transaction

`POST /api/payment-gateway/v1/payments/purchase` · `multipart/form-data`

Key fields (full list in [the official Purchase doc](https://developer.payway.com.kh/purchase-14530820e0)):

| Field | Required | Notes |
|---|---|---|
| `req_time` | ✅ | UTC `YYYYMMDDHHmmss` |
| `merchant_id` | ✅ | from ABA |
| `tran_id` | ✅ | **your** unique id, ≤20 chars — this is the idempotency/verify key |
| `amount` | ✅ | e.g. `"1.00"` |
| `hash` | ✅ | see §3.1 |
| `currency` | — | `USD` or `KHR` (defaults to merchant profile) |
| `payment_option` | — | `cards`, `abapay_khqr`, **`abapay_khqr_deeplink`**, `alipay`, `wechat`, `google_pay`; omit → customer chooses |
| `items` | — | base64 JSON `[{name, quantity, price}]`, display-only |
| `return_url` | — | **server callback (pushback)** URL, base64-encoded |
| `continue_success_url` | — | browser redirect after success |
| `cancel_url` | — | browser redirect on cancel |
| `lifetime` | — | minutes, 3–43200, default 30 days — **set 20 to match our reservation TTL** |
| `firstname/lastname/email/phone` | — | buyer info |

**Purchase hash field order (24 fields):**

```
req_time + merchant_id + tran_id + amount + items + shipping + firstname
+ lastname + email + phone + type + payment_option + return_url + cancel_url
+ continue_success_url + return_deeplink + currency + custom_fields
+ return_params + payout + lifetime + additional_params + google_pay_token
+ skip_success_page
```

`view_type` and `payment_gate` are posted but **never hashed** — the #1
integration bug in the wild.

**Response for `abapay_khqr_deeplink`** (JSON — other options return a hosted
HTML checkout page):

```json
{
  "status": { "code": "00", "message": "Success!", "tran_id": "..." },
  "qr_string": "00020101021230510016abaakhppxxx...",
  "abapay_deeplink": "abamobilebank://ababank.com?type=payway&qrcode=...",
  "checkout_qr_url": "https://checkout.payway.com.kh/..."
}
```

### 3.3 Check Transaction — server-side verification

`POST /api/payment-gateway/v1/payments/check-transaction-2` · `application/json`
· rate limit 600 req/s

Request: `{ req_time, merchant_id, tran_id, hash }` with
**hash input = `req_time + merchant_id + tran_id`**.

Response `data`: `payment_status` (`APPROVED` / `PENDING` / `DECLINED` /
`REFUNDED` / `CANCELLED` / `PRE-AUTH`), `payment_status_code` (`0` approved,
`2` pending, `3` declined, `4` refunded, `7` cancelled), `total_amount`,
`payment_amount`, `payment_currency`, `apv` (approval code),
`transaction_date`.

> **Rule (same as Bakong):** an order is *paid* only when
> `check-transaction-2` returns `payment_status_code: 0` from **our backend**.
> Never from the browser, never from the pushback body alone.

### 3.4 Pushback (server callback) to `return_url`

After payment, PayWay `POST`s JSON to your base64-decoded `return_url`:

```json
{ "tran_id": "...", "apv": "...", "status": 0, "return_params": "..." }
```

**The pushback is NOT signed.** Official guidance is "secure this URL so only
PayWay has access". Treat it purely as a *wake-up signal*: on receipt, call
check-transaction-2 and only act on that result. (Our poll loop makes the
pushback optional — nice-to-have, not load-bearing.)

### 3.5 Error codes worth handling

Purchase: `1` wrong hash · `4` duplicate `tran_id` · `6` wrong domain (not
whitelisted) · `23` payment option not enabled · `45` zero amount · `429`
rate-limited. Check: `5` invalid hash · `6` transaction not found · `8` wrong
merchant profile.

### 3.6 Sandbox test cards

| Outcome | Card | Exp | CVV | 3DS |
|---|---|---|---|---|
| Approved | MC 5156 8399 3770 6777 | 01/30 | 993 | No |
| Approved | Visa 4286 0900 0000 0206 | 04/30 | 777 | Yes (OTP to registered email) |
| Declined | MC 5156 8302 7256 1029 | 04/30 | 777 | Yes |
| Declined | Visa 4156 8399 3770 6777 | 01/30 | 993 | No |

---

## 4. Current project review — gaps and findings

Reviewed against the architecture map of `backend/` + `storefront/`
(Bakong/COD payment paths, checkout flow, jobs, subscribers).

### Good news: no bugs found in the existing payment path

The Bakong module is in strong shape and most of it is directly reusable as a
pattern: server-side-only verification with a second independent verify inside
`authorizePayment`, SSRF guards with a dev loopback escape, fixed-window rate
limits, idempotent `/start` (session reuse) and `/status` (order_cart
short-circuit), reservation release wired to expiry.

### Gaps for adding PayWay (each maps to a blueprint step in §5)

| # | Gap | Where | Severity |
|---|---|---|---|
| G1 | No webhook entry point exists — `getWebhookActionAndData()` is a stub and there's no callback route. PayWay's pushback needs one (unsigned → verify-on-receipt). | `backend/src/modules/bakong-payment/service.ts:248` | High |
| G2 | Payment method list, `PaymentMethod` union, and `handlePlaceOrder` branching are hardcoded to `khqr`/`cod` — a third method is additive edits in three places. | `storefront/src/app/checkout/page.tsx:66,74-85,163` | Medium |
| G3 | `resolvePaymentMethod()` in the Telegram subscriber falls through to `"Unknown"` for any new provider id. | `backend/src/subscribers/order-placed.ts:143` | Medium |
| G4 | `expire-reservations` job only recognizes Bakong sessions — PayWay sessions holding reservations would never be cleaned up. | `backend/src/jobs/expire-reservations.ts` | High |
| G5 | SSRF guard utilities live inside the Bakong module — extract to `backend/src/lib/proxy-guard.ts` before a second consumer copies them. | `backend/src/modules/bakong-payment/lib/proxy.ts` | Low |
| G6 | **No `.env.example` exists in the repo** although `Stack.md` says env vars are "defined in `.env.example`". New PayWay vars will make this worse. | repo root / `backend/` | Low |
| G7 | PayWay's `tran_id` is capped at **20 chars** — Medusa cart/order ids (`cart_01H...`) don't fit. We must mint a short id and map it (cache key `aba:cart:<tran_id>`, mirroring `khqr:cart:<reference>`). | new code | High (design constraint) |
| G8 | Whitelisting is part of PayWay's security model — our backend's egress IP (Proxmox VM) must be registered with PayWay; calls from dev machines with unregistered IPs will fail with code 6. Plan for it in UAT. | ops | Medium |

---

## 5. Integration blueprint (when you green-light implementation)

No production code has been changed yet — this is the plan, mapped to real
files, following the existing Bakong patterns.

### Backend

1. **`backend/src/modules/aba-payway/`** — new Medusa payment provider:
   - `lib/client.ts` — vendored PayWay client (port of
     `sandbox/aba-payway/lib/payway-client.mjs`; no npm `aba-payway`/`payway-js`
     dependency, per our vendoring rule for payment code).
   - `service.ts` — `AbstractPaymentProvider`, `static identifier = "payway"`;
     `initiatePayment` → Purchase (`abapay_khqr_deeplink`, `lifetime: 20`);
     `authorizePayment` → check-transaction-2, return `captured` only on
     `payment_status_code === 0`; `getWebhookActionAndData` → parse pushback,
     re-verify, never trust the body (fixes G1).
   - `index.ts` — export `ABA_PROVIDER_ID = "pp_payway_..."` like
     `BAKONG_PROVIDER_ID`.
2. **Routes** `backend/src/api/store/payments/payway/`:
   - `start/route.ts` — clone of KHQR start: zod, rate limits (5/min/IP,
     20/hr/cart), reservation, session; mint short `tran_id` (G7) and cache
     `aba:cart:<tran_id>` → cart id.
   - `status/route.ts` — poll path: verify via check-transaction-2 (3s verify
     cache), release reservation, `completeCartWorkflow`, stock-out ledger,
     invoice token — same sequence as KHQR status.
   - pushback route — accept PayWay's POST, validate shape with zod, then run
     the same verified-complete path; respond 200 fast (G1). **Implemented at
     `backend/src/api/hooks/payway/pushback/route.ts` (`/hooks/payway/pushback`)**
     because Medusa requires the publishable key on `/store/*` routes and
     ABA's callback cannot send one.
3. **`medusa-config.ts`** — add provider entry, conditional on
   `PAYWAY_MERCHANT_ID`/`PAYWAY_API_KEY` being set (same pattern as the auth
   providers); reuse boot-time URL validation for `PAYWAY_BASE_URL`.
4. **`backend/src/subscribers/order-placed.ts`** — add `ABA_PROVIDER_ID` →
   `"ABA PayWay"` branch (G3).
5. **`backend/src/jobs/expire-reservations.ts`** — treat PayWay sessions like
   Bakong sessions (G4). Set purchase `lifetime` = reservation TTL = 20 min so
   both sides expire together.
6. **Env vars**: `PAYWAY_BASE_URL`, `PAYWAY_MERCHANT_ID`, `PAYWAY_API_KEY`,
   `PAYWAY_DEV_ALLOW_LOOPBACK` (dev-mock seam, two-gate like Bakong's). Create
   `.env.example` while at it (G6).

### Storefront

7. **`checkout/page.tsx`** — third `PAYMENT_OPTIONS` entry + `"payway"` in the
   `PaymentMethod` union + branch in `handlePlaceOrder` (G2).
8. **`lib/checkout.ts`** — `startPayway()` / `pollPaywayStatus()` server
   actions mirroring `startKhqr()` / `pollKhqrStatus()`.
9. **Pay screen** — reuse the KHQR pay screen pattern: render
   `qr_string` as QR + "Open ABA Mobile" deeplink button, poll `status` every
   3s with the same countdown.

### Decision needed before implementation

PayWay overlaps Bakong (both produce KHQR). Options: **(a)** PayWay replaces
the Bakong provider (one gateway, adds cards — simplest ops), **(b)** PayWay
runs alongside Bakong (customer sees "KHQR" + "Card via PayWay"), or **(c)**
PayWay is the fallback until direct Bakong registration unblocks. This is a
product/fee decision — confirm before coding. The blueprint above works for
all three.

---

## 6. Best practices checklist (PayWay-specific)

- [ ] Hash exactly the strings you send; never re-format `amount` after hashing.
- [ ] Exclude `view_type`/`payment_gate` from the hash.
- [ ] Treat `tran_id` (≤20 chars) as *our* idempotency key; one `tran_id` per
      payment attempt, persisted before calling PayWay.
- [ ] `paid` only from backend check-transaction-2 (`payment_status_code === 0`)
      — pushback and browser redirects are hints, never proof.
- [ ] Set `lifetime` to the stock-reservation TTL (20 min), not the 30-day default.
- [ ] `return_url` must be base64-encoded and HTTPS in production.
- [ ] Never log the `api_key` or full hash inputs (they embed buyer PII);
      redact at the logger boundary like Bakong fields.
- [ ] Send `KHR` amounts as whole riel; `USD` with 2 decimals.
- [ ] Handle `429` from PayWay with backoff; our own poll route already caches
      verify results for 3s — keep that.
- [ ] Duplicate `tran_id` (`code 4`) on retry = previous attempt exists → check
      its status instead of erroring out.
- [ ] Production cutover: re-point `PAYWAY_BASE_URL`, swap credentials, confirm
      whitelisting of the production egress IP — no code change.

## 7. Test sandbox

A working, dependency-free harness lives in **`sandbox/aba-payway/`**
(client + strict hash-verifying mock gateway + 12-assertion lifecycle test,
currently all green). It runs offline today and against the real ABA sandbox
the moment your credentials arrive — see `sandbox/aba-payway/README.md` for
both modes, and §3.6 for test cards.

---

## 8. Sources

1. [PayWay Developer Suite](https://developer.payway.com.kh/) — official docs portal
2. [Purchase API](https://developer.payway.com.kh/purchase-14530820e0) — endpoint, params, hash order
3. [aba-payway-docs (offline mirror of official docs)](https://github.com/Joselay/aba-payway-docs) — overview, check-transaction-2, e-commerce checkout guide, KHQR guideline, resources/test cards
4. [payway-js](https://github.com/seanghay/payway-js) — community Node client used to cross-verify HMAC-SHA512/base64 and check-transaction hash order
5. [PayWay sandbox portal](https://sandbox.payway.com.kh/) — sandbox credential self-registration
6. [ABA PayWay business page](https://www.ababank.com/business/aba-payway/) and [merchant self-register](https://merchant.payway.com.kh/self-register/) — production onboarding
7. [HostAsean: Setting up ABA PayWay](https://www.hostasean.com/setting-up-aba-payway-payment-gateway/) — onboarding prerequisites, fees, timeline (third-party, treat fee figures as indicative)

*Methodology: 4 search queries + 8 source deep-reads. The hash specification
(field order, HMAC-SHA512, base64) was cross-verified between the official
docs mirror and an independent community SDK, then executable-verified by the
sandbox harness (client and mock implement the spec independently and agree).
Items not found in any source are flagged inline (§2.2 fees/settlement).*
