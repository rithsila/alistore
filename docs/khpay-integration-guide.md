# KHPAY Integration Guide (Phase 7 — KHPAY-01…06)

KHPAY (https://khpay.site) is a Cambodian payment aggregator. It became the
**active KHQR provider** behind the storefront's "Pay with KHQR" button after
ABA declined the direct PayWay merchant application pending a business license
(PAYWAY-08 blocked indefinitely). `bakong-payment` and `aba-payway` stay in the
repo, dormant (env-gated).

## Locked decisions (2026-06-10)

| Decision | Choice | Why |
|---|---|---|
| Rail | **Bakong KHQR** (`POST /bakong/generate`) | Settles directly to OUR Bakong account (configured once in KHPAY dashboard → Settings → Bakong) — not through KHPAY's PayWay link, which is the ABA-license path that was refused. |
| Checkout UX | **In-store QR + polling** | KHPAY returns the raw EMV KHQR string; the existing pay screen renders it and polls — customer never leaves the storefront. No deeplink on this rail (`deeplink: null`; the CTA self-hides). |
| Confirmation | **Polling only** | Backend verifies via `POST /bakong/check` (≥3s cached). No webhook/callback_url configured, no public callback endpoint exists for KHPAY. |

## Architecture

```
Pay screen ──POST /store/payments/khpay/start──▶ start route ──▶ pp_khpay_khqr.initiatePayment ──▶ KHPAY /bakong/generate
   ▲  │                                              │ reserves stock, maps khpay:cart:<bk_id>
   QR │ 3s poll                                      ▼
   └──┴─GET /store/payments/khpay/status?reference=bk_… ──▶ verifyKhpayPaid ──▶ KHPAY /bakong/check
                                  paid ──▶ finalizePaidCart (release hold → completeCart
                                           [provider re-verifies] → stock_movement(out) → invoice token)
```

Key files:

- `backend/src/modules/khpay-payment/` — vendored client (`lib/client.ts`),
  provider (`service.ts`, identifier `khpay` → provider id `pp_khpay_khqr`).
- `backend/src/api/store/payments/khpay/` — `start/`, `status/`, `shared.ts`.
- `backend/medusa-config.ts` — conditional registration on `KHPAY_API_KEY`;
  boot-time SSRF check of `KHPAY_BASE_URL` (hard allowlist: `khpay.site`).
- `storefront/src/lib/checkout.ts` — `startKhqr`/`pollKhqrStatus` point at
  the khpay routes; reference shape `/^bk_[A-Za-z0-9]{6,64}$/`.
- `storefront/tests/khpay.spec.ts` — e2e against a strict-bearer mock (:4285).

## Security posture (matches PayWay/Bakong)

- `paid` ONLY from server-side `/bakong/check`; provider `authorizePayment`
  re-verifies during cart completion (second independent confirmation).
- Bearer key from env only; key, QR strings, transaction ids, and bodies are
  never logged.
- SSRF: https-only, hard-coded host allowlist, no redirects, DNS re-check at
  call time; dev loopback escape is two-gated (`NODE_ENV !== production` AND
  `KHPAY_DEV_ALLOW_LOOPBACK=1`).
- Rate limits: start 5/min/IP + 20/hr/cart; status 60/min + 120/hr per
  reference + 60/min/IP; verify result cached ≥3s.
- Stock: reserve on start, release on expiry/failure (status route + the
  expire-reservations job, which now covers Bakong/PayWay/KHPAY uniformly).

## Env vars

| Var | Notes |
|---|---|
| `KHPAY_API_KEY` | Provider registers only when set. Dashboard → Settings → API keys. Rotate via `POST /keys/{id}/rotate`. |
| `KHPAY_BASE_URL` | Default `https://khpay.site/api/v1`; boot-validated. |
| `KHPAY_EXPIRES_MINUTES` | Default 20 — keep equal to the reservation TTL. |
| `KHPAY_DEV_ALLOW_LOOPBACK` | Dev-only mock escape; inert in production. |

## Running the e2e spec

1. Backend :9000 + storefront :8000 running, TEST-01 fixtures + Cambodia
   shipping option seeded.
2. `backend/.env` carries the KHPAY dev-mock block (`KHPAY_BASE_URL=
   http://127.0.0.1:4285/api/v1`, mock key, dev flag) — restart after editing.
3. `cd storefront && npx playwright test tests/khpay.spec.ts`

While the dev-mock block is set, `/store/payments/khpay/*` 502s whenever the
mock isn't listening — that's expected outside spec runs.

## UAT checklist (KHPAY-06 — human gated)

- [ ] KHPAY account + Dashboard → Settings → Bakong configured (account_id =
      our Bakong account, merchant name "Ali Store", city Phnom Penh).
- [ ] Production API key minted; `KHPAY_API_KEY` set; dev-mock block removed.
- [ ] `GET /me` shows `bakong_configured: true`.
- [ ] Real ~$0.50 payment: storefront journey → scan in a real banking app →
      order flips paid → money arrives in the Bakong account.
- [x] Real `bk_…` id shape confirmed (2026-06-10): `bk_` + 16 UPPERCASE hex —
      matches `KHPAY_REFERENCE_PATTERN`.
- [x] KHR confirmed REJECTED by the live gateway (`"currency must be USD"`,
      `error_code: VALIDATION_ERROR` — note: live envelope uses `error_code`,
      not the documented `code`; the client accepts both). The start route now
      always charges USD (the cart's base denomination); the display toggle
      remains display-only.
- [x] `GET /me` verified (2026-06-10): key valid, `bakong_configured: true`,
      plan "basic".
- [ ] Plan quota: Free = 100 req/day; one 20-min checkout polling at the 3s
      verify cache can make ~hundreds of check calls. Budget Starter+ or
      lengthen `VERIFY_PENDING_TTL` before go-live.
- [ ] Fees/settlement terms confirmed; aggregator-risk owner documented
      (KHPAY sits between us and Bakong — outage or misconduct blocks
      checkout; COD remains the fallback path).
