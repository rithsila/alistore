# ABA PayWay Test Sandbox

Standalone harness for developing and verifying the ABA PayWay integration
**before** touching `backend/` or `storefront/`. Zero dependencies — Node 20+
built-ins only. Nothing here ships to production.

```
sandbox/aba-payway/
├── lib/payway-client.mjs   # minimal PayWay client: hash + purchase + check-transaction
├── mock-server.mjs         # local fake PayWay gateway (port 4284) with strict hash verification
├── run-test.mjs            # 12-assertion lifecycle test (mock or real sandbox)
└── README.md
```

## Quick start (no credentials needed)

```powershell
# Terminal A — start the mock gateway
node sandbox/aba-payway/mock-server.mjs

# Terminal B — run the test suite
cd sandbox/aba-payway
node run-test.mjs
```

Expected: `Result: 12 passed, 0 failed`. The suite proves:

1. Purchase with `payment_option=abapay_khqr_deeplink` returns `qr_string` + `abapay_deeplink`
2. `check-transaction-2` reports `PENDING` before payment
3. A tampered hash is **rejected** (negative test)
4. Simulated payment fires the `return_url` pushback (`{tran_id, apv, status, return_params}`)
5. `check-transaction-2` flips to `APPROVED` with `payment_status_code: 0` and an `apv`

The mock recomputes the HMAC-SHA512 hash on every request using the exact
24-field canonical order from the official docs and logs `got/expected` on
mismatch — so a wrong hash implementation fails loudly offline, with the same
error codes the real gateway returns (`1` wrong hash on purchase, `5` on check).

## Running against the real ABA sandbox

After registering at <https://sandbox.payway.com.kh/> you receive a sandbox
`merchant_id` + `api_key` by email. Then:

```powershell
$env:PAYWAY_BASE_URL    = "https://checkout-sandbox.payway.com.kh"
$env:PAYWAY_MERCHANT_ID = "<sandbox merchant id>"
$env:PAYWAY_API_KEY     = "<sandbox api key>"
node run-test.mjs
```

In real-sandbox mode the suite creates a $1.00 KHQR purchase, verifies it is
`PENDING`, prints the `checkout_qr_url`, and tells you how to re-check after
paying manually:

```powershell
node run-test.mjs --check <tran_id>
```

> Note: the real sandbox requires your domain/IP to be whitelisted by the
> PayWay integration team. If purchase returns `status.code 6 — wrong domain`,
> email your IP/domain to your PayWay contact first.

Sandbox test cards (from the official resources doc):

| Outcome  | Card                       | Exp   | CVV | 3DS |
|----------|----------------------------|-------|-----|-----|
| Approved | Mastercard 5156 8399 3770 6777 | 01/30 | 993 | No  |
| Approved | Visa 4286 0900 0000 0206       | 04/30 | 777 | Yes |
| Declined | Mastercard 5156 8302 7256 1029 | 04/30 | 777 | Yes |
| Declined | Visa 4156 8399 3770 6777       | 01/30 | 993 | No  |

## Mock-only control endpoints

| Endpoint | Effect |
|----------|--------|
| `POST /__mock/pay {"tran_id": "..."}` | Mark APPROVED + fire pushback to `return_url` |
| `POST /__mock/decline {"tran_id": "..."}` | Mark DECLINED |
| `GET /__mock/transactions` | Inspect all mock state |

Port allocation in this repo: `4280` Bakong mock · `4281` FB OAuth mock ·
`4282` Google token mock · `4283` pushback receiver (run-test.mjs) ·
`4284` PayWay mock.

## Where this goes next

The full integration plan (Medusa provider module, backend routes, storefront
wiring, security checklist) lives in
[`docs/aba-payway-integration-guide.md`](../../docs/aba-payway-integration-guide.md).
When implementation starts, `lib/payway-client.mjs` is the reference for the
vendored `backend/src/modules/aba-payway/lib/` client, and `mock-server.mjs`
becomes the in-spec mock for `storefront/tests/aba.spec.ts` (same pattern as
the Bakong mock inside `storefront/tests/khqr.spec.ts`).
