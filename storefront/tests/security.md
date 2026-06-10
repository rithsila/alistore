# TEST-11 — Security & Privacy Checklist

> **Task:** TEST-11 (`ImplementPlan.md`) — _Security_
> **Objective:** Verify privacy/security posture.
> **Requirements:** No secrets in client bundle; proxy reachable only from backend
> (IP allowlist); payment status verified server-side only; no card data anywhere.
> **Acceptance criteria:** All checks pass; client-forged "paid" is rejected.
> **Dependencies:** BACKEND-03B (KHQR status + server verify), INTEGRATION-09 (image delivery).

This is a **manual security checklist** with a **static-verification** layer,
the same posture as the sibling `responsive.md` (TEST-09) and `a11y.md`
(TEST-10). Two kinds of rows:

- **▣ Static (verified from source):** the control is fixed in code and confirmed
  here with file/line evidence — it cannot regress without a code change. These
  are the heart of TEST-11: the secret boundary, the SSRF/egress guard, the
  server-side payment verify, and the absence of card capture are all decidable
  by reading the source + a grep, and that is done below.
- **☐ Runtime / deploy (pending):** anything that needs the live stack, the
  in-Cambodia proxy host, a production build, or an infra control (the proxy's
  *inbound* IP allowlist) — left for a UAT/go-live gate. These have **not** been
  executed from this environment.

The authority is `.claude/rules/security.md`. Mark each runtime row
**✓ Pass / ✗ Fail / — N/A**. Any ✗ blocks the acceptance criteria.

---

## Reference — the payment trust boundary (source of truth)

`paid` has exactly **one** producer: a server-side Bakong verify. There is **no
input field, body, header, or query param** by which a client can assert payment
status. The relevant files:

| Concern | File | What enforces it |
|---|---|---|
| Status endpoint (only `reference` in) | `backend/src/api/store/payments/khqr/status/route.ts` | zod `ReferenceSchema = ^[a-f0-9]{32}$` (L47); status derived from an existing order link (L361-374) **or** server verify (L398-409) — never a client field |
| Server-side verify | `…/bakong-payment/lib/proxy.ts` `checkTransactionByMd5` (L297-340) | `paid` only when Bakong returns `responseCode === 0 && data != null` (L339) |
| Unconfigured = pending, never paid | `status/route.ts` L393-397 | no proxy/token → caches + returns `pending`; "never fabricate 'paid'" |
| SSRF egress guard | `proxy.ts` `assertSafeProxyUrl` (L134-176) + `assertResolvesPublic` (L182-209) | https-only, no creds, allowlist (mandatory in prod), private/loopback/link-local/CGNAT reject, DNS-rebind re-check, `redirect: "manual"` |
| Storefront never forges status | `storefront/src/lib/checkout.ts` `pollKhqrStatus` (L535-566) | returns server status verbatim; "never infers or fabricates payment status" |
| Ownership (no client cart id) | `checkout.ts` `getCartId()` from `HttpOnly` cookie (L277, L404, L480) | a caller can't act on someone else's cart |

---

## Track A — No secrets in the client bundle

- [▣] **Grep of `storefront/src` for every backend secret returns nothing.** `BAKONG_TOKEN`, `BAKONG_PROXY_URL`, `BAKONG_ACCOUNT`, `FB_APP_SECRET`, `GOOGLE_CLIENT_SECRET`, `TELEGRAM_BOT_TOKEN`, `S3_SECRET*`, `DATABASE_URL` → **0 matches**. None of these are referenced anywhere in the storefront.
- [▣] **Storefront talks to Medusa with the publishable key only** (`@lib/config` SDK); the admin API is never called (`checkout.ts` L44-45, L46: "Storefront uses the publishable key only … the admin API is never touched"). Admin JWT / API key never reaches the client (`security.md` "Authorization").
- [▣] **Only public env vars are exposed client-side:** `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` + `MEDUSA_BACKEND_URL` (Stack.md) — both public by design. No secret is placed behind a `NEXT_PUBLIC_*` prefix.
- [▣] **Bakong token + proxy URL live only in backend env** and are read only in `backend/src/modules/bakong-payment/**` (`process.env.BAKONG_TOKEN` / `BAKONG_PROXY_URL` in `status/route.ts` L391-392, passed into the server-only proxy client).
- [☐] **Production-build confirmation:** build the storefront and grep the emitted `.next` client chunks for any secret value / the strings above — expect none. (Runtime/build gate; not run here.)
- [☐] **No secret in network tab:** load checkout in a browser and confirm no secret appears in any client request/response or in `window.__NEXT_DATA__`. _(Note N3: `next.config.js` `logging.fetches.fullUrl: true` logs full fetch URLs to the **dev server console** only — not the client bundle — but avoid putting secrets in query strings regardless.)_

## Track B — Proxy reachable only from the backend (egress allowlist / SSRF)

- [▣] **Bakong is only ever called server-side.** Both proxy calls (`generateDeeplink`, `checkTransactionByMd5`) live in `backend/src/modules/bakong-payment/lib/proxy.ts`; the storefront has **0** references to any `BAKONG_*` symbol (Track A grep). The client never calls Bakong or the proxy (`security.md` "Payments": "NEVER call Bakong from the client").
- [▣] **SSRF egress allowlist on the proxy URL** (`assertSafeProxyUrl`, L134-176): must be `https://` (L146), no embedded credentials (L149), host must be on `BAKONG_PROXY_ALLOWED_HOSTS` when set (L165), and a literal private IP is rejected (L171). **In production the allowlist is mandatory** — missing it throws `UnsafeProxyUrlError` (L155-162).
- [▣] **Private/loopback/link-local/CGNAT blocked** (`isPrivateAddress`, L70-94): 10/8, 127/8, 169.254/16, 172.16-31, 192.168/16, 100.64-127 (CGNAT), `::1`, `fe80`, `fc/fd`, IPv4-mapped — covered.
- [▣] **DNS-rebinding defense:** the host is re-resolved at call time and every resolved address re-checked against the private ranges (`assertResolvesPublic`, L182-209); no record / private record throws.
- [▣] **No redirect following:** both fetches use `redirect: "manual"` and reject any 3xx outright (L249-251, L323-325) — closes the redirect-to-internal SSRF vector.
- [▣] **Dev loopback escape is dual-gated and inert in prod** (`devLoopbackEscapeActive`, L106-111): requires `NODE_ENV !== "production"` **and** `BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1`, and relaxes loopback **only** (TEST-04 mock proxy). `NODE_ENV=production` disables it regardless of the flag; every other SSRF rule stays enforced.
- [☐] **Proxy *inbound* IP allowlist (infra/deploy):** the in-Cambodia proxy host should itself accept connections only from the backend's egress IP (`security.md` "SSRF" / proxy infra). This is a server-config control, not a repo artifact — verify at deploy. (Go-live gate.)
- [☐] **Live egress check:** from a non-backend host, confirm the proxy refuses the request (or is network-unreachable). (Deploy gate.)

## Track C — Payment status verified server-side only + **client-forged "paid" is rejected**

- [▣] **The only client input to status is `reference`.** `GET /store/payments/khqr/status?reference=` validates it with zod `^[a-f0-9]{32}$` (L47, L322-326); there is **no `status` body/param/header** anywhere in the handler. A client literally has no field to set "paid".
- [▣] **`paid` is produced only by the server.** Either (a) an `order_cart` link already exists → the order was created by a prior server-verified completion (L361-374), or (b) `checkTransactionByMd5` confirms via the in-Cambodia proxy (L398-409). No other branch returns `paid`.
- [▣] **Unconfigured never fabricates paid:** with no proxy/token the handler caches `pending` and returns `pending` (L393-397) — fail-closed.
- [▣] **A forged/guessed reference cannot mint paid:** an unknown reference → `404 reference_not_found` (no cart mapping, L335-338; or no matching Bakong session, L352-356). `reference = md5(qr)` is a 128-bit non-guessable capability (Stack/`security.md`), and even a *valid* reference returns `pending` until the server's own verify confirms.
- [▣] **Idempotent + race-guarded finalize:** completion runs once; `writeStockOut` is idempotent per order (L280-284); verify cached ≥3s (L60-61); rate-limited 60/min-IP + 60/min & 120/hr per reference (L55-57, L202-236) — matching `security.md` limits.
- [▣] **Storefront mirrors, never asserts:** `pollKhqrStatus` returns the server status verbatim and only clears the cart cookie on a server-reported `paid` (L535-566); the pay screen reads payment state from the server, never the client (`security.md` "Frontend").
- [▣] **Sensitive values never logged:** `reference`, token, and proxy bodies are excluded from all log lines (`status/route.ts` L25-27; `proxy.ts` L17, L244, L318); errors return `{ error, request_id }` only (L161-168).
- [☐] **Runtime positive proof (exists):** the TEST-04 paid-flip E2E (`storefront/tests/khqr.spec.ts`) drives start → server-side-mock pay → poll and asserts the status flips to `paid` **only after the server verify**, the order becomes `paid`, and one `out` movement is written — green in the suite. Re-run to confirm.
- [☐] **Runtime negative proof (run for this criterion):** `GET /store/payments/khqr/status?reference=<random 32-hex>` returns `404`/`pending`, **never `paid`**; a status request with an extra `status=paid` query/body is ignored (the handler reads neither). Confirm against the dev backend.

## Track D — No card data anywhere

- [▣] **No card capture exists.** Grep across both repos for `card|cardNumber|PAN|cvv|cvc|expiry|creditcard|credit_card` returns only false positives — `ProductCard`, commented-out `gift_cards`, and "card padding" prose. No PAN/CVV/expiry field, type, or storage anywhere.
- [▣] **Both payment paths are card-free by design:** KHQR is a Bakong QR / deeplink (the customer pays in their own banking app — no card data transits the storefront or backend), and COD is cash on delivery. `security.md` "Payments": "NEVER store/transmit card data anywhere" — structurally satisfied.
- [☐] **Visual confirmation:** walk the checkout + KHQR screens and confirm no card-entry UI is ever rendered. (Runtime spot-check.)

---

## Notes

- **N1 — "IP allowlist" has two halves.** The repo enforces the **egress** half:
  the backend may only reach an allowlisted, public, non-redirecting proxy host
  (Track B, statically verified). The **inbound** half — the proxy accepting only
  the backend's IP — is the proxy server's own firewall/config and is a deploy
  gate (N1 row in Track B), not a repo artifact.
- **N2 — Card-free is structural, not configured.** There is nothing to disable
  or get wrong: no card field exists. KHQR + COD never touch a PAN.
- **N3 — `logging.fetches.fullUrl: true`** in `next.config.js` logs full fetch
  URLs to the **dev server console** (not the client bundle, not prod default
  behavior). It does not leak secrets to the client; it's a reminder to keep
  secrets out of query strings (the code already passes `reference` as a query
  param — `reference` is a capability, not a secret, and is excluded from logs).
- **N4 — Adjacent already-proven controls (context, not TEST-11 scope):** OAuth
  `state` is server-minted, single-use, Redis-backed, allowlisted `redirect_uri`
  (TEST-08/08B); order/invoice tokens are 128-bit, `timingSafeEqual`-compared,
  expirable (BACKEND-06); admin endpoints are admin-guarded. These reinforce the
  posture but are verified under their own tasks.

---

## Results & sign-off

| Track | Scope | Static (▣) | Runtime/deploy result | Date | Tester |
|---|---|---|---|---|---|
| A | No secrets in client bundle | ✓ 0 secret refs; PK-only | | | |
| B | Proxy backend-only + SSRF | ✓ egress guard enforced | | | |
| C | Server-verified status; forged paid rejected | ✓ no client status path | | | |
| D | No card data anywhere | ✓ no card capture | | | |

**Acceptance criteria — all must hold:**

- [▣/☐] **All checks pass** — ▣ A–D verified from source (secret boundary, SSRF/egress guard, server-side verify, no card data); ☐ confirm the runtime/deploy rows (prod-bundle grep, live egress, proxy inbound allowlist) at go-live.
- [▣/☐] **Client-forged "paid" is rejected** — ▣ proven from `status/route.ts`: the only client input is a zod-validated `reference`; `paid` is produced solely by a server-side proxy verify or an existing order link; a forged reference yields `404`/`pending`, never `paid`. ☐ Runtime negative check (random/forged reference) + the existing TEST-04 paid-flip E2E.

> **Execution status:** Checklist authored; the **static (▣)** layer — the secret
> grep, the SSRF/egress guard, the server-side-only payment verify, and the
> absence of any card-capture path — is verified from the source with file/line
> evidence and is the substance of the acceptance criteria. The **runtime/deploy
> (☐)** rows (production-bundle grep, live egress refusal, the proxy's inbound IP
> allowlist, and the forged-reference negative check) were **not** executed from
> this environment and remain a go-live/UAT gate. The TEST-04 KHQR paid-flip E2E
> already proves at runtime that `paid` flips only after the server verify. No
> defects found in the static review.
