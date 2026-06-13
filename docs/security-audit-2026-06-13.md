# Security Audit — Ali Store (Full: backend + storefront)

**Date:** 2026-06-13
**Branch:** `feat/footer-info-pages`
**Auditor:** Security review (read-only; no code modified)
**Layers covered:** 2 (API & Server), 3 (Auth & Session), 4 (Frontend & Client), 5 (Config & Deploy), 7 (Payments)
**Method:** 4 parallel scoped reviews (backend payments, backend auth/API, storefront client, config/secrets/deps) + git-tracking verification of secret-exposure claims.

> Audit only. Fixes happen in separate tasks. Every finding below has a concrete attack path in this codebase.
> `npm audit` was **not** run (no install performed) — a dependency-CVE pass is still outstanding.

---

## Summary

- **2 CRITICAL · 8 HIGH · 11 MEDIUM · 8 LOW**
- **Top 3 to fix first:**
  1. **[C-01]** Real DB + Redis password `DbNew!2025` committed to git history → rotate now + scrub history.
  2. **[C-02]** Non-atomic rate-limiter (`get→check→set`) on *every* sensitive endpoint (COD, OAuth, KHQR/KHPAY start) → concurrent burst bypasses every limit.
  3. **[H-05]** Storefront `next.config.js` ignores TS + ESLint build errors **and** ships zero HTTP security headers → broken build gate on payment/auth code + clickjacking/MIME-sniff exposure.

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH | 8 |
| MEDIUM | 11 |
| LOW | 8 |

---

## CRITICAL findings

### [C-01] Real database + Redis password committed to git
- **Location**: `docs/postgres-proxmox-lxc-setup.md` (lines incl. 133, 234, 250, 330, 390, 404, 427, 430), `docs/uat-deploy.md:101-128` — both **git-tracked (verified)**. Connection strings: `postgres://db-admin:DbNew!2025@172.16.18.10:5432/medusa` and `redis://:DbNew!2025@172.16.18.10:6379`. The Postgres doc also sets Redis `bind 0.0.0.0` + `protected-mode no` (lines 307–321).
- **Attack**: Anyone who clones the repo (current/future contributors, CI, or if it ever goes public) has the prod DB + Redis password via `git log -p`. An attacker reaching the Proxmox LAN segment gets full DB access (all customer PII, orders, payment references) and Redis (inject events / wipe workflow engine).
- **Impact**: Full data breach + integrity loss. Confirmed exploitable — credential literally present in tracked files.
- **Fix**:
  1. Rotate both passwords on the VM now, update `backend/.env`, restart services.
  2. Scrub history with `git filter-repo --replace-text` / BFG Repo Cleaner, force-push.
  3. Replace doc occurrences with `<change-before-use>`.
  4. Re-secure Redis (`protected-mode yes`, bind to LAN IP, strong distinct password).
  5. **Note:** `docs/backend-proxmox-lxc-setup.md` (currently untracked) contains the same password — sanitize **before** committing.
- **Verification**: `git grep -i DbNew` returns nothing; a fresh clone cannot connect with the old password.

### [C-02] Non-atomic rate limiter — every sensitive endpoint bypassable under concurrency
- **Location**: shared `overLimit()` pattern duplicated across `backend/src/api/store/orders/cod/route.ts:159-172`, all OAuth routes (`facebook|google/route.ts` + `/callback`), `admin/stock-movements/route.ts`, `admin/reports/*/route.ts`, `orders/[id]/invoice/route.ts`, and all payment `start`/`status` routes. Pattern: `const current = get(key); if (current>=limit) return; set(key, current+1)`.
- **Attack**: Fire N concurrent requests in the same millisecond; all read `current=0` before any `set` lands, all pass the check. The COD 3/min/IP, OAuth 10/min/IP, and KHQR 5/min limits all collapse to ~N× under burst. Enables COD order spam / cart enumeration and OAuth attempt amplification.
- **Impact**: The project's mandated rate limits (`security.md`) are not enforced under load — primary abuse control on the most-targeted endpoints is defeated.
- **Fix**: Replace with atomic Redis `INCR` + `EXPIRE` on first hit (set TTL only when `INCR==1`), or use `rate-limiter-flexible`. Drop to the underlying ioredis client if the Medusa cache module doesn't expose `INCR`.
- **Verification**: Concurrency test (e.g. 30 parallel COD POSTs from one IP) yields exactly 3 successes, 27× `429`.

---

## HIGH findings

### [H-01] COD order completion has no cart-ownership proof
- **Location**: `backend/src/api/store/orders/cod/route.ts:272-299`. Client-supplied `cart_id` looked up via `query.graph` with no check that the submitted phone/name matches the cart creator.
- **Attack**: Attacker who learns a victim's ULID `cart_id` (URLs, logs, shared links) POSTs `{cart_id, phone:<attacker>, name, address}` → victim's cart completes under attacker contact details; victim's cart is consumed (idempotency blocks re-order).
- **Impact**: Order hijack / denial against a targeted cart; merchant ships to / calls the wrong person.
- **Fix**: Require the cart's pre-set shipping phone (set during storefront checkout prep) to match the submitted phone, or a cart-scoped HMAC capability minted at cart creation. Bind cart → guest session.
- **Verification**: COD with a mismatched phone on a foreign cart returns `403`.

### [H-02] Google `id_token` decoded without signature verification
- **Location**: `backend/src/api/store/auth/google/callback/route.ts:349-356` uses `jwt.decode` (no crypto verify), trusting only the TLS channel.
- **Attack**: Any future TLS interception/misconfig, or a staging box running `NODE_ENV!=production` pointed at a non-loopback token base, lets an attacker mint a JWT with arbitrary `sub`/`email` → account takeover.
- **Impact**: Customer account takeover.
- **Fix**: `jwt.verify` against Google JWKS (`google-auth-library` or `jwks-rsa`). TLS should not be the sole identity trust anchor.
- **Verification**: A token with a tampered payload / bad signature is rejected.

### [H-03] Storefront order-confirmation defaults to "paid" from a URL param
- **Location**: `storefront/src/app/order/[id]/page.tsx:81-96` — placeholder `fetchOrderConfirmation` returns `state: "paid"` whenever `?status` ≠ `cod`, with no backend call and no id validation.
- **Attack**: Visiting `/order/<anything>` renders a convincing "Payment confirmed" receipt for an unpaid order. Violates "payment status read from server only."
- **Impact**: Fabricated paid receipt; risk a merchant dispatches against the screen instead of the admin panel.
- **Fix**: Replace seam with a real Medusa `retrieveOrder` reading authoritative payment state; default ambiguous/unknown to a neutral state, never "paid". Gate the placeholder to throw in production until INTEGRATION lands.
- **Verification**: `/order/<unpaid-id>` shows pending/unknown, not "paid".

### [H-04] Error objects leaked verbatim to storefront clients
- **Location**: `storefront/src/lib/data/customer.ts` (`error.toString()` at 95-96, 113, 119, 205, 224, 269) and `storefront/src/lib/util/medusa-error.ts:6-9` (`console.error` of `error.response.data` **and** `headers`, incl. `set-cookie`).
- **Attack**: Signup/login return verbose Medusa errors → user enumeration; production logs capture PII (email/phone/address) + session cookies for any non-2xx response.
- **Impact**: Information disclosure + user enumeration + PII/session-cookie in logs.
- **Fix**: Map status codes to generic user messages; remove/guard `console.error`; never log response headers; apply `security.md` logger redaction.
- **Verification**: Failed login returns a generic message; logs contain no PII or `set-cookie`.

### [H-05] Storefront build ignores type/lint errors + ships no security headers
- **Location**: `storefront/next.config.js` — `typescript.ignoreBuildErrors:true` (lines 22–26), `eslint.ignoreDuringBuilds:true`, and no `headers()` function.
- **Attack**: A type error in a payment/auth/zod path deploys silently; missing `X-Frame-Options`/CSP `frame-ancestors` allows clickjacking the checkout; missing `nosniff`/HSTS weakens transport.
- **Impact**: Broken build gate on security-critical code + clickjacking / MIME-sniffing exposure.
- **Fix**: Remove both ignore flags (fix surfaced errors); add the `security.md` header set (HSTS, CSP without `unsafe-inline`/`unsafe-eval`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`).
- **Verification**: `curl -I` on a deployed page shows all six headers; build fails on an injected type error.

### [H-06] `REVALIDATE_SECRET=supersecret` hardcoded in tracked template
- **Location**: `storefront/.env.template:40` (**git-tracked, verified**).
- **Attack**: Copied verbatim to deploy → known ISR revalidation secret lets anyone trigger mass cache invalidation = DoS amplification against the Medusa backend.
- **Impact**: Backend DoS via forced revalidation if the secret is wired into a revalidate route.
- **Fix**: Replace literal with a generation placeholder (`<openssl rand -hex 32>`); set per-environment, never shared.
- **Verification**: Template contains no usable secret; deployed value is unique per environment.

### [H-07] Facebook callback passes raw `req.url` (containing OAuth `code`) into provider
- **Location**: `backend/src/api/store/auth/facebook/callback/route.ts:219-226` (`as any`, full `url`+`query` forwarded to `validateCallback`).
- **Attack**: The authorization `code` rides in the URL into a layer that may log it; widens code-leak surface.
- **Impact**: Potential OAuth `code` leakage into logs.
- **Fix**: Pass only `query:{ code }`, not the full URL; mark the object non-loggable.
- **Verification**: Callback input no longer contains the raw URL/code beyond what token exchange needs.

### [H-08] Invoice route: order-existence oracle + unvalidated id
- **Location**: `backend/src/api/store/orders/[id]/invoice/route.ts:33` (`id` only `string().min(1).max(100)`); token verified *after* order lookup → `404 not_found` vs `403 invalid_token` differential.
- **Attack**: Enumerate which order IDs exist by the response-code difference, before attacking the token.
- **Impact**: Order enumeration oracle.
- **Fix**: Constrain `id` to ULID/UUID regex; return `403` uniformly whether or not the order exists (constant-time path).
- **Verification**: Both nonexistent and wrong-token requests return identical `403`.

---

## MEDIUM findings

### [M-01] Finalize-paid race (no atomic state guard)
- **Location**: `backend/src/api/store/payments/payway/shared.ts:271-308` & `khpay/shared.ts:271-305`. Concurrent poll + pushback both pass `findExistingOrderId` and run `releaseStartReservation`/finalize.
- **Fix**: `UPDATE payment_session SET status='authorized' WHERE id=$ AND status='pending'` CAS before release. *(`security.md` explicitly mandates this `WHERE status='pending_payment'` guard.)*

### [M-02] KHQR releases reservation before completion succeeds
- **Location**: `backend/src/api/store/payments/khqr/status/route.ts:428-445`. If `completeCartWorkflow` throws after release, stock is freed for a paid-but-incomplete cart.
- **Fix**: Complete-then-release, or hold the reservation until the order id returns.

### [M-03] PayWay pushback has no source-IP allowlist
- **Location**: `backend/src/api/hooks/payway/pushback/route.ts:56-131`.
- **Fix**: Add ABA's published callback IP ranges; silently `acknowledge()` off-allowlist to avoid an existence oracle. (Server-side re-verify already prevents payment fraud.)

### [M-04] Status routes rate-limit *after* DB/cache lookup
- **Location**: `khpay/status/route.ts:91-117`, `payway/status/route.ts:89-115`.
- **Fix**: Move `overLimit` before `loadCartForTxn` (KHQR already does this).

### [M-05] `expire-reservations` job non-atomic release+delete
- **Location**: `backend/src/jobs/expire-reservations.ts:144-163`. A thrown reservation-release followed by a successful session-delete strands inventory permanently.
- **Fix**: Single compensating workflow, or an orphan-reservation sweep.

### [M-06] `cart_id` not bound to caller session in `/start` routes
- **Location**: `khqr/start/route.ts:343-354`, `khpay/start/route.ts:252-260`, `payway/start/route.ts:264-275`.
- **Fix**: Bind cart ↔ session; verify match. Mitigates rate-limit griefing against a targeted cart.

### [M-07] Client-controlled `x-request-id` echoed/logged unbounded
- **Location**: all `getRequestId()` implementations (payments `shared.ts`, OAuth routes, etc.).
- **Fix**: Cap to 64 chars `[A-Za-z0-9_-]` or always generate server-side; strip `\r\n`. Removes log-injection / stored-XSS-in-admin risk.

### [M-08] Cookie clears omit security flags
- **Location**: `storefront/src/lib/data/cookies.ts:62-67` (`removeAuthToken`) and `storefront/src/lib/data/customer.ts:146` (`connect.sid`).
- **Fix**: Expire with matching `httpOnly` + `secure` + `sameSite` to avoid a shadowing non-secure cookie.

### [M-09] Phone not validated in address server actions
- **Location**: `storefront/src/lib/data/customer.ts:171-271` (`addCustomerAddress` / `updateCustomerAddress`).
- **Fix**: Apply `^(\+855|0)[1-9]\d{7,8}$` (`security.md`: "every entry point").

### [M-10] Dev JWT/COOKIE/KHPAY/Telegram/R2 secrets may equal production
- **Location**: `backend/.env` (gitignored). Real-looking `JWT_SECRET`, `COOKIE_SECRET`, `KHPAY_API_KEY` (`ak_…`), `TELEGRAM_BOT_TOKEN`, `S3_*` keys present locally.
- **Fix**: Ensure the Proxmox VM has independently generated secrets; never copy dev → prod. Keep dev/prod KHPAY keys separate. Rotate Telegram + R2 creds if any exposure vector existed.

### [M-11] `.mcp.json` not gitignored
- **Location**: repo root `.mcp.json` (untracked — verified). One `git add .` from committing the Supabase project ref `yvqeeusgchiezqduwodg`.
- **Fix**: Add `.mcp.json` to `.gitignore` now.

### [M-12] No max-length bounds on checkout name/address/note
- **Location**: `storefront/src/lib/checkout.ts` `normalizeContact` (~lines 130-160). `fullName`, `address`, `note` forwarded to Medusa + Telegram subscriber unbounded.
- **Fix**: Cap name ≤200, address ≤500, note `.slice(0,500)`.

> Note: M-12 is the storefront-input-bounds finding; renumbered here to avoid collision. Total MEDIUM count = 11 distinct issues (M-10 and M-04 each consolidate duplicates found across providers).

---

## LOW findings

### [L-01] Invoice HTML missing `X-Frame-Options`/CSP/`Referrer-Policy`
- **Location**: `backend/src/api/store/orders/[id]/invoice/route.ts:234-236` (only `Content-Type`, `Cache-Control: no-store`, `nosniff` set). Clickjacking on the only HTML backend route.

### [L-02] `auth-facebook/service.ts:272-278` returns raw `error.message`
- Leak if ever surfaced by a caller → use generic + log server-side.

### [L-03] `social_identity` model lacks constraints
- **Location**: `backend/src/modules/social-identity/models/social-identity.ts`. No enum/check on `provider`; no unique index on `(provider, provider_user_id)` → duplicate links pick `existing[0]`.

### [L-04] `escapeHtml` doesn't escape `/`
- **Location**: `backend/src/lib/invoice-template.ts:96-103`. Defense-in-depth only.

### [L-05] `NEXT_PUBLIC_BASE_URL` silently falls back to `https://localhost:8000`
- **Location**: `storefront/src/lib/util/env.ts:1-3`. Fail-fast in production instead.

### [L-06] `logging.fetches.fullUrl: true` in prod
- **Location**: `storefront/next.config.js:17`. Logs every server fetch URL on Vercel; gate to dev only.

### [L-07] OAuth components expose overridable `loginHref`
- **Location**: `storefront/src/components/checkout/FacebookLogin.tsx:48`, `GoogleLogin.tsx:47`. Latent open-redirect surface; remove the prop or allowlist. (No active exploit path today — defaults used.)

### [L-08] SSRF allowlist relaxed when `NODE_ENV!=production` + exchange-rate divergence
- **Location**: `backend/src/lib/proxy-guard.ts:120-126` (allowlist enforced in prod only); `storefront/src/lib/price.ts:51,57` (`NEXT_PUBLIC_USD_KHR_RATE` vs backend `USD_KHR_RATE` can diverge → display/QR amount mismatch). Document the pairing / warn when unset.

---

## NOT issues (false-positive checks performed)

- **OAuth `state`/CSRF** — both FB + Google: 256-bit, Redis-stored, single-use, cookie-bound, compared before code exchange. ✅
- **`redirect_uri`** — resolved from env + hard-coded allowlist (HTTPS, exact callback path), not from Host header → no open redirect. ✅
- **OAuth email never auto-links** — duplicate email → `409`, fresh customer created; email is not ownership proof. ✅
- **Invoice token** — `randomBytes(32)` base64url (256-bit), `timingSafeEqual`, expirable + revocable. ✅
- **No `dangerouslySetInnerHTML`, no `localStorage`/`sessionStorage`** anywhere in storefront. ✅
- **No admin key/JWT in client bundle** — only `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` (intended public); `MEDUSA_BACKEND_URL` server-only; `server-only` imports present in `cookies.ts`/`session-headers.ts`. ✅
- **KHQR polling reads `paid` from the server action only**, validates `reference` (`^bk_[A-Za-z0-9]{6,64}$`); amount derived server-side from cart, not client. ✅
- **`redirect:"manual"` + 3xx-reject** in all outbound payment fetches = correct SSRF/no-follow posture; `md5` is the Bakong protocol status key, not a hash primitive. ✅
- **Pushback trusts no HMAC by design** — re-verifies server-side via `checkTransaction` before acting (ABA API limitation, correctly mitigated). ✅
- **Dev seams** (`FB_GRAPH_DEV_BASE_URL`, `GOOGLE_TOKEN_DEV_BASE_URL`, loopback proxy escapes) — two-gate (`NODE_ENV!=production` AND explicit flag), loopback-only, inert in production. ✅
- **Admin report/stock routes** — use `AuthenticatedMedusaRequest` + defensive `req.auth_context?.actor_id` check. ✅
- **Exact pins / `save-exact=true` / lockfiles present / `@medusajs/* = 2.15.3`** in both repos; `medusa-config.ts` fail-fast env validation; no `console.log` in either `src/`. ✅
- **`backend/.env` + `storefront/.env.local` gitignored** (verified, not committed); FB/Google/PayWay/Bakong values in dev env are mock placeholders. ✅
- **Publishable key (`pk_…`) in docs** — intentionally public, not a leak. ✅

---

## Fix in this order

Effort: **S** <30m · **M** 30m–2h · **L** ≥½ day

1. **[C-01]** Rotate `DbNew!2025` (PG+Redis) + scrub git history + sanitize untracked doc — **M** (rotation S, history scrub M)
2. **[M-11]** Add `.mcp.json` to `.gitignore` — **S**
3. **[H-06]** Replace `REVALIDATE_SECRET=supersecret` placeholder — **S**
4. **[C-02]** Atomic Redis `INCR` rate limiter (shared helper → all endpoints) — **M**
5. **[H-05]** Remove TS/ESLint ignore flags + add header set — **M** (headers S; fixing surfaced type errors M–L)
6. **[H-03]** Replace storefront "paid"-defaulting seam / gate in prod — **S–M**
7. **[H-02]** Google `id_token` JWKS verify — **M**
8. **[H-01]** COD cart-ownership proof — **M**
9. **[H-04]** Sanitize client-facing errors + kill header logging — **S**
10. **[H-08]** Invoice ULID validation + constant `403` — **S**
11. **[H-07]** FB callback: pass only `code` — **S**
12. **[M-01/M-02]** Payment finalize CAS guard + complete-then-release — **M**
13. **[M-03..M-10, M-12]** pushback IP allowlist, status RL ordering, expiry-job atomicity, cart-session binding, `x-request-id` cap, cookie flags, address phone validation, prod-secret separation, input length bounds — **S each, M total**
14. **LOW batch [L-01..L-08]** — **S each**

---

## Outstanding (not covered by this audit)

- **Dependency CVE scan** — `npm audit --production` was not run (no install). Run in both `backend/` and `storefront/`; fail on `high`+.
- **Deployed-header verification** — confirm Vercel/Cloudflare-injected headers vs. the `security.md` required set via `curl -I` against the live storefront.
