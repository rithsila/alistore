# Security Rules — apply on every task

Medusa v2.15.3 backend + Next.js 15 storefront, Bakong KHQR + COD.
Authz lives in Medusa's API layer. Supabase RLS only for non-Medusa tables.

## Authorization

* NEVER expose admin JWT/API key in client. Storefront uses publishable key only.
* ALWAYS guard `src/api/admin/*` with Medusa admin middleware.
* ALWAYS scope `src/api/store/*` to the current session/cart/order — no client-supplied ids without ownership check.
* Non-Medusa Supabase tables: RLS on, never `USING (true)`, scope by owning id, validate FKs belong to same owner.

## Admin auth (MFA)

* MFA required on the admin account (Medusa v2.15.3 primitives, TOTP).
* Admin login rate limit: 5/min/IP, 20/hour/email. Lock or step-up after 10 fails.
* Admin password ≥16 chars, mixed classes. Rotate on suspected exposure.
* Admin session cookie: `HttpOnly; Secure; SameSite=Lax`, TTL ≤8h.
* Invalidate session on password/MFA change.

## Sessions & cookies

* Storefront session: `HttpOnly; Secure; SameSite=Strict`.
* NEVER store tokens, session ids, payment refs, or order-tokens in `localStorage`/`sessionStorage`.
* Rotate session id on privilege change.

## Payments (highest risk)

* NEVER trust client-reported payment status. `paid` only after server-side Bakong verify (md5/reference).
* NEVER call Bakong from the client. All traffic via in-Cambodia proxy from backend.
* NEVER log Bakong request/response bodies. Redact tokens; treat `reference` as sensitive.
* ALWAYS use vendored `src/modules/bakong-payment/`. Do not depend on `bakong-khqr` package.
* NEVER store/transmit card data anywhere.
* Idempotent verify: `reference` is the idempotency key.
* State transition guard: `UPDATE ... WHERE status='pending_payment'` to block double-paid races.
* Stock release on cancel/expire in the same transaction as status change.
* Cache verify result ≥3s server-side; stop polling after reservation TTL (20 min).
* Rate-limit per `reference`, not only per IP.

## SSRF (Bakong proxy URL)

* Validate `BAKONG_PROXY_URL` at boot: `https://`, host on hard-coded allowlist, no private/loopback/link-local IPs.
* Re-check resolution at call time. No redirects (reject 3xx). No user-controlled URL params.

## Facebook OAuth

* `state` server-generated, single-use, session-bound, stored in Redis, verified on callback.
* `redirect_uri` from a hard-coded allowlist. Never echo `?next=`/`?return_to=` without allowlist check.
* Scopes: `email`, `public_profile` only.
* Account-link safety: FB identity may link only to a customer who proved phone ownership in the same session.
* FB email is not proof of customer ownership.

## Webhooks / callbacks

* HMAC signature header, ±5min timestamp, nonce store for replay block.
* Source IP allowlist where the partner publishes one.
* Never act on unsigned callbacks.

## Invoice & order-token

* Token ≥128-bit entropy (`crypto.randomBytes(32).toString('base64url')`).
* Compare with `crypto.timingSafeEqual`, never `===`.
* Single-purpose (invoice only), expirable (30 days), admin-revocable.

## API routes (Medusa + Next.js)

* Validate every body with **zod** on the server.
* Errors: log with `x-request-id`, return `{ error, request_id }` only.
* Secrets never in client bundle. `NEXT_PUBLIC_*` only for truly public values.
* Order ids: UUID/ULID, non-sequential.
* Concrete rate limits:
  * `POST /store/payments/khqr/start` — 5/min/IP, 20/hour/session
  * `GET  /store/payments/khqr/status` — 60/min/session, 120/hour/reference
  * `POST /store/orders/cod` — 3/min/IP, 10/hour/phone
  * `GET  /store/auth/facebook[/callback]` — 10/min/IP
  * Telegram send path — 30/min/process
  * Admin endpoints — 60/min/admin-session

## HTTP security headers (prod)

* `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
* `Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https://img.<domain>; font-src 'self'; connect-src 'self' https://<medusa-host>`
* `X-Content-Type-Options: nosniff`
* `X-Frame-Options: DENY`
* `Referrer-Policy: strict-origin-when-cross-origin`
* `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
* No `'unsafe-inline'`/`'unsafe-eval'` in CSP.

## CORS

* Never `Allow-Origin: *` on credentialed endpoints.
* Allowlist storefront + admin origins only.

## File uploads (admin → R2)

* Max 5 MB. MIME: `image/jpeg|png|webp` only.
* Re-validate magic bytes server-side. Strip EXIF.
* Store under UUID key. R2: no public list, public read on `img.<domain>` only.
* Reject SVG.

## Secrets

* Never commit `.env*`, R2/Bakong/Telegram/FB secrets, `*.pem`, `*.key`, `id_rsa*`, service-account JSON.
* Never hardcode in source or tests.
* Validate required env at startup; fail fast.
* Document rotation owner + cadence per secret.

## Frontend

* `dangerouslySetInnerHTML` forbidden except invoice path (sanitize with DOMPurify server-side first).
* Validate URL params before use as identifiers.
* Rely on React default escaping for user content.
* Payment status read from server only — never client.

## Customer data

* v1 PII: name, phone, address, optional note, optional FB identity. No more without approval.
* Phones never in logs or error messages. Telegram alerts go to private chat only.
* Phone regex: `^(\+855|0)[1-9]\d{7,8}$` at every entry point.
* Retention: 24 months post last order, then purge (backups too).

## SQL

* No string interpolation. Parameterized queries / Medusa query layer only.

## Logging

* `x-request-id` on every request, propagated downstream.
* Redaction at logger boundary: phone, address, Bakong token/md5/reference, Telegram/FB tokens.
* No `console.log` in prod paths. Logger only.
* Log retention ≤90 days, admin-only access.

## Migrations & data safety

* Review migrations for destructive ops before merge.
* Backup + verify before any prod migration.
* The agent MAY run `db:migrate`/`db:generate` against the UAT/dev database. Never run `db:migrate`/`db:reset`/`db:rollback` against real production from the agent.

## Dependencies

* Exact pins, commit lockfiles, install with `npm ci`.
* No packages published in the last 7–14 days on backend/payment paths.
* No packages with <100 weekly downloads without source review.
* Medusa core pinned at `2.15.3` (MFA-capable) until deliberate bump.
* CI: `npm audit --production` fail on `high`+; secret scanner on every push; Semgrep on PR.

## Pre-complete self-check

* [ ] All endpoints behind correct auth?
* [ ] Admin auth changes: MFA + rate limits still enforced?
* [ ] Non-Medusa Supabase tables: RLS scoped?
* [ ] No hardcoded secrets, no leaky `NEXT_PUBLIC_*`?
* [ ] All input zod-validated, output sanitized?
* [ ] Payment: `paid` set only after server verify, race-guarded?
* [ ] OAuth: state verified, `redirect_uri` allowlisted, scopes minimal?
* [ ] Uploads: size + MIME + magic-byte enforced?
* [ ] New fetches: SSRF guard active?
* [ ] Security headers on new routes?
* [ ] Concrete rate limits set?
* [ ] Versions pinned, lockfile updated, `npm audit` clean?

If any answer is wrong: fix before reporting done.
