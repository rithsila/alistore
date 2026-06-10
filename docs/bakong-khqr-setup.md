# Bakong KHQR — Operator Setup Guide

**Audience:** you, the shop operator — the person who registered the Bakong
account and links it to Ali Store. This is the *"I have a Bakong account, now
what?"* guide.

**For the code/implementation reference** (endpoints, vendored QR logic, SSRF
guard), see [`payments-khqr.md`](./payments-khqr.md). This guide is about
**getting credentials and wiring them in** — it does not change any code.

> ⚠️ **Payments are the highest-risk part of this system.** Everything here
> follows `.claude/rules/security.md`: secrets live only in `.env` (never
> committed), the token/QR/reference are never logged, and "paid" is only ever
> decided by a server-side check — never by the customer's phone. If anything in
> this guide is unclear for *your* bank or account, stop and verify in the
> Bakong portal before going live. Don't guess on payments.

---

## 1. The mental model — you need THREE separate things

Registering the Bakong **app** and linking your bank gave you **one** of the
three pieces. Here's the whole picture:

| # | Thing | What it is | Where it comes from | Maps to env var |
|---|-------|-----------|---------------------|-----------------|
| 1 | **Bakong Account ID** | The identifier money is paid *into* — embedded in every QR. Looks like `username@bankcode`. | The **Bakong mobile app** (you already have this). | `BAKONG_ACCOUNT` |
| 2 | **Open API token** | A developer JWT that lets the backend *talk* to Bakong (generate deeplinks, check if a QR was paid). **Separate registration**, tied to an email, **expires every 90 days**. | The **Bakong Open API developer portal** (you do NOT have this yet). | `BAKONG_TOKEN` |
| 3 | **In‑Cambodia proxy** | A thin HTTPS forwarder that sits in Cambodia. Ali Store **never** calls Bakong directly — all traffic goes through this. | You stand it up (see §4). | `BAKONG_PROXY_URL` + `BAKONG_PROXY_ALLOWED_HOSTS` |

The account ID (#1) and the API token (#2) are **independent**: #1 routes the
money, #2 authorizes the API calls. You need both, and you get them from two
different places.

```
Customer scans QR  ──pays──▶  funds land in  BAKONG_ACCOUNT  (#1)
                                                   ▲
Ali Store backend ──Bearer BAKONG_TOKEN (#2)──▶ in-KH proxy (#3) ──▶ Bakong Open API
   "is md5 <ref> paid yet?"                                          (generate deeplink,
                                                                      check transaction)
```

---

## 2. Step 1 — Get your Bakong Account ID  → `BAKONG_ACCOUNT`

This is the account that **receives** the money. For v1 we use an **Individual**
account (locked decision — PRD §10).

1. Open the **Bakong** app (or your bank's app, if it shows a Bakong/KHQR ID).
2. Find your **Bakong Account ID** — it is shown in your profile / "My QR" /
   account-info screen. It is **not** your phone number and **not** your bank
   account number. It looks like:
   - `username@bankcode` — e.g. `sophea@aclb` (ACLEDA), `sophea@nbcq` (NBC/Bakong wallet), `sophea@wing`, etc.
   - The `@suffix` is your bank's Bakong code; it differs per bank. **Read it
     exactly from the app — do not guess the suffix.**
3. This whole string (max 32 chars) is your `BAKONG_ACCOUNT`.

> **Verify it before trusting it:** the single most important pre-launch check is
> to generate one real QR with this account ID and scan it with the Bakong app —
> the app should show *your* name as the payee. See §6.

---

## 3. Step 2 — Register for the Open API token  → `BAKONG_TOKEN`

This is the part the app **doesn't** give you. The backend needs a developer
token to call Bakong's API (turn a QR into a deeplink, and check whether a QR was
paid).

1. Go to the **Bakong Open API developer portal:**
   <https://api-bakong.nbc.gov.kh/register>
2. Register with an **email you control and will keep** — the token is bound to
   this email, expiry warnings are emailed here, and renewal uses this email.
   Use a shop/ops mailbox, not a personal one that might be abandoned.
3. Complete registration and **copy the issued token** (a long JWT string).
4. Put it in `BAKONG_TOKEN` (see §5). **Treat it like a password** — it is a
   secret, never commit it, never log it, never put it in the storefront bundle.

### ⏰ The 90-day expiry — read this, it WILL bite you otherwise

- **Bakong Open API tokens expire after ~90 days.** NBC emails the registered
  address ~3 days before expiry.
- When the token lapses, the backend can no longer verify payments: deeplinks
  come back `null`/`502`, and KHQR status polls stay stuck on `pending` forever
  even after the customer pays. **This is a silent outage** if you're not
  watching for it.
- Ali Store does **not** auto-renew. You renew manually:
  - Bakong exposes `POST /v1/renew_token` (body `{ "email": "<your email>" }`)
    which returns a fresh token, **or** you re-issue from the portal.
  - Put the new token in `BAKONG_TOKEN` and **restart the backend** (env is read
    at boot / per request from `process.env`).
- **Set a recurring calendar reminder for ~80 days out** the moment you generate
  the token, so you rotate it before it dies. (See the operations checklist in
  §8.)

> **Sandbox first (optional but recommended):** there is a staging environment at
> <https://sit-api-bakong.nbc.gov.kh/> with its own registration. Use it to
> dry-run the integration before pointing at production
> `https://api-bakong.nbc.gov.kh/`.

### If registration fails with "Registration temporarily unavailable"

This red banner is a **server-side error on NBC's portal**, not a problem with
your inputs (a bad field would be flagged individually). The portal is known to
be flaky. In priority order:

1. **Register from a Cambodian network.** The portal/API are commonly reachable
   only from Cambodian IPs — registering from outside Cambodia (or a non-KH VPN)
   can surface as exactly this generic error. Try from the Proxmox VM in
   Cambodia, or mobile data on a Cambodian carrier. (This is the same reason the
   integration needs an in-Cambodia proxy — see §4.)
2. **Retry later** — the portal goes down regularly; try a different time of day.
3. **Clean browser** — disable translate/extension overlays, try incognito or
   another browser.
4. **Dry-run on SIT** (above) while production registration is down.
5. **Persisting for days → contact NBC Bakong support.** Multi-day waits and
   email follow-ups are commonly reported.

The **"Token expired? Renew"** link on the page is **only for existing tokens** —
not for first-time registration. Don't use it to register.

> **Not a blocker:** you do NOT need the token to keep building. The backend
> boots and generates valid QRs without it (deeplink `null`, status stays
> `pending`), and **COD checkout works fully** with no Bakong credentials. Slot
> the token in once the portal cooperates.

---

## 4. Step 3 — Stand up the in‑Cambodia proxy  → `BAKONG_PROXY_URL`

**Why this exists:** Ali Store's payment code has **no direct-to-Bakong path** —
by design (`security.md`), every Bakong call goes through a proxy URL you
control. The Bakong Open API is also commonly reachable only from inside
Cambodia, so the proxy must sit on a Cambodian network/IP. Your backend already
runs on the Proxmox VM in Cambodia, so the proxy can live on the **same host or
LAN** — it just has to be reachable at an `https://` URL.

The backend calls these two paths on top of `BAKONG_PROXY_URL`:

```
{BAKONG_PROXY_URL}/generate_deeplink_by_qr      (POST, Bearer token)
{BAKONG_PROXY_URL}/check_transaction_by_md5     (POST, Bearer token)
```

So the proxy is a **pure pass-through** to the matching Bakong endpoints. If your
proxy URL is `https://bakong-proxy.alistore.com/v1`, it must forward to
`https://api-bakong.nbc.gov.kh/v1/...` unchanged (same path, same body, same
`Authorization` header).

### Minimal nginx pass-through example

```nginx
# Proxy host (in Cambodia). TLS terminated here; forwards /v1/* to Bakong.
server {
    listen 443 ssl;
    server_name bakong-proxy.alistore.com;

    # ssl_certificate / ssl_certificate_key ... (use a real cert)

    location /v1/ {
        proxy_pass         https://api-bakong.nbc.gov.kh/v1/;
        proxy_set_header   Host api-bakong.nbc.gov.kh;
        proxy_ssl_server_name on;
        # Pass the backend's Authorization: Bearer <token> straight through.
        proxy_pass_request_headers on;
        proxy_read_timeout 15s;
    }
    # Optionally lock inbound access to your backend's IP only.
}
```

With that, set `BAKONG_PROXY_URL=https://bakong-proxy.alistore.com/v1`.

### The SSRF allowlist is mandatory in production

`BAKONG_PROXY_ALLOWED_HOSTS` is a comma-separated allowlist of proxy hostnames.
In production (`NODE_ENV=production`) the backend **refuses to boot** if
`BAKONG_PROXY_URL` is set but this list is empty — that's the SSRF guard from
`security.md`. Set it to your proxy host:

```
BAKONG_PROXY_ALLOWED_HOSTS=bakong-proxy.alistore.com
```

Other guard rails enforced automatically (you don't configure these, just be
aware): the proxy URL must be `https://`, must not embed credentials, must not
resolve to a private/loopback IP (re-checked at call time to defend against DNS
rebinding), and redirects from the proxy are rejected. The URL is validated **at
boot**, so a bad value fails startup loudly instead of breaking checkout later.

> **Do I really need a separate proxy box?** If your backend is already in
> Cambodia, the proxy can be an nginx `location` block on the *same* server (a
> different hostname/vhost pointing at Bakong). The architecture just requires
> that `BAKONG_PROXY_URL` is a public `https://` host on the allowlist — it must
> not be a raw private IP in production. A loopback/`localhost` proxy is only
> allowed in **dev** via `BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1` (never in prod).

---

## 5. Step 4 — Wire the environment variables

Edit `backend/.env` (copy from `backend/.env.template`). **Never commit real
values.** The relevant block:

```bash
# --- Bakong KHQR (Individual account) ---
BAKONG_ACCOUNT=sophea@aclb                       # §2 — your real account ID
BAKONG_TOKEN=eyJhbGciOi...                        # §3 — the Open API JWT (secret)
BAKONG_PROXY_URL=https://bakong-proxy.alistore.com/v1   # §4 — your proxy base
BAKONG_PROXY_ALLOWED_HOSTS=bakong-proxy.alistore.com    # §4 — required in prod

# Optional display/behaviour (have sensible defaults if left blank):
BAKONG_MERCHANT_NAME=Ali Store                    # shown in banking apps (tag 59)
BAKONG_MERCHANT_CITY=Phnom Penh                   # tag 60
BAKONG_QR_EXPIRES_MINUTES=20                       # QR + stock-hold window

# Leave UNSET in production (dev-only test escape hatch):
# BAKONG_PROXY_DEV_ALLOW_LOOPBACK=
```

Also relevant nearby (not Bakong-specific, but needed for KHR QR amounts and
correct client-IP rate limiting):

```bash
USD_KHR_RATE=4100          # KHR QR amount = USD total × this rate, rounded to whole riel
TRUSTED_PROXY_COUNT=1      # set to the number of reverse proxies (e.g. 1 for Cloudflare) in front of the backend
```

### Full Bakong env reference

| Var | Required? | Purpose | Default |
|-----|-----------|---------|---------|
| `BAKONG_ACCOUNT` | **prod** | Receiving account ID (`name@bank`), embedded in the QR (tag 29-00). **Secret.** | — (falls back to a non-payable `sandbox@dev` placeholder if empty) |
| `BAKONG_TOKEN` | **prod** | Open API bearer token. **Secret, never logged.** | — |
| `BAKONG_PROXY_URL` | **prod** | In-Cambodia proxy base mirroring Bakong `/v1`. | — |
| `BAKONG_PROXY_ALLOWED_HOSTS` | **prod (enforced)** | Comma-separated proxy host allowlist (SSRF). Boot fails in prod if `BAKONG_PROXY_URL` set but this empty. | — |
| `BAKONG_MERCHANT_NAME` | optional | Payee name shown in banking apps (tag 59). | `Ali Store` |
| `BAKONG_MERCHANT_CITY` | optional | Merchant city (tag 60). | `Phnom Penh` |
| `BAKONG_QR_EXPIRES_MINUTES` | optional | QR lifetime + stock reservation window. | `20` |
| `BAKONG_PROXY_DEV_ALLOW_LOOPBACK` | **dev only** | `=1` allows a `localhost` mock proxy for E2E tests. **Ignored in prod.** | unset |

> **What happens with no Bakong config (dev/sandbox):** the backend still boots
> and still *generates* a QR + reference, but `deeplink` comes back `null` and a
> status poll can never confirm `paid` (it stays `pending` — it never fakes a
> payment). That's the intended safe behaviour, not a bug.

---

## 6. Step 5 — Verify end-to-end (do this before taking real orders)

The vendored QR builder is profile-specific (single tag-29 sub-tag, tag-99
timestamp). A **live scan is the authoritative validation** — don't skip it.

1. **Boot check:** start the backend (`npx medusa develop` in `backend/`). If
   `BAKONG_PROXY_URL` / allowlist are wrong, it fails at startup with a clear
   message. Green boot = the proxy URL passed SSRF validation.
2. **Generate a real QR:** place a test item in the cart on the storefront and
   choose "Pay with KHQR" (or call `POST /store/payments/khqr/start` with a
   `cart_id`). You should get back a `qr`, a non-null `deeplink`, and a
   `reference`.
3. **Scan it with the Bakong app:** the app must show **your shop/name** as the
   payee and the **correct amount + currency**. If the payee or amount is wrong,
   stop — `BAKONG_ACCOUNT`, `USD_KHR_RATE`, or the currency wiring is off.
4. **Pay a tiny amount** (e.g. the KHR equivalent of a few cents/riel — use a
   cheap test product). 
5. **Watch the confirmation flip:** the storefront polls
   `GET /store/payments/khqr/status?reference=...` every ~3s. Within a few
   seconds of paying it should flip `pending → paid`, the order should be
   created, and stock should decrement (a `stock_movement(out)` row is written).
6. **COD path** is independent of Bakong and needs none of this — it works
   regardless of KHQR config.

If the flip never happens but you definitely paid → see Troubleshooting (§7).

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Backend **won't boot**, complains about `BAKONG_PROXY_URL` / allowlist | URL isn't `https://`, or prod with empty `BAKONG_PROXY_ALLOWED_HOSTS`, or URL targets a private IP | Use a public `https://` proxy host; set the allowlist to that host |
| `deeplink` is `null` (but QR works) | `BAKONG_PROXY_URL` or `BAKONG_TOKEN` not set | Set both; restart. (In dev this is expected and harmless — the QR alone scans.) |
| `502 payment_gateway_unavailable` | Proxy unreachable, token expired/invalid, or proxy not forwarding correctly | Check the proxy is up and forwarding `/v1/*` to Bakong; **check the token hasn't expired** (§3); confirm headers/body pass through unchanged |
| Customer paid, but status stays **`pending` forever** | Token expired (most common after ~90 days), proxy down, or `BAKONG_ACCOUNT` mismatch so the md5 doesn't match a real transaction | Renew token (§3); verify proxy; re-confirm the account ID with a fresh live scan (§6) |
| QR shows **wrong payee name** when scanned | `BAKONG_ACCOUNT` is wrong / wrong bank suffix | Re-read the account ID from the Bakong app (§2) |
| QR shows **wrong amount** in KHR | `USD_KHR_RATE` wrong or unset | Set `USD_KHR_RATE` to the current rate |
| Hitting rate limits behind Cloudflare | `TRUSTED_PROXY_COUNT` mismatch | Set it to the number of proxies in front of the backend (1 for Cloudflare) |

**Where to look:** the backend logs payment failures by `request_id` only — the
token, QR, and reference are deliberately **never** logged. Correlate the
`request_id` the storefront shows on error with the server log line.

---

## 8. Operations & security checklist

**Ongoing operations**
- [ ] **Token rotation:** calendar reminder ~80 days from issuance to renew
      `BAKONG_TOKEN` (§3) before the 90-day expiry. Update `.env` + restart.
- [ ] Watch the registered email for NBC's 3-day expiry warning.
- [ ] Keep the proxy host healthy (it's a single point of failure for online
      payments — COD is unaffected).
- [ ] Document the **rotation owner** for each secret (`security.md` requires an
      owner + cadence per secret).

**Security (from `.claude/rules/security.md` — non-negotiable)**
- [ ] `BAKONG_TOKEN`, `BAKONG_ACCOUNT`, and the QR `reference` are secrets —
      never committed, never logged, never sent to the storefront bundle.
- [ ] Bakong is **never** called from the client and **never** directly from the
      backend — only via the proxy.
- [ ] "Paid" is only set after the server-side md5 verify — a client claiming
      "I paid" is never trusted.
- [ ] `BAKONG_PROXY_ALLOWED_HOSTS` is set in production.
- [ ] `.env` is not in git (confirm it's git-ignored before committing anything).

---

## 9. Individual vs Merchant KHQR (v1 → v2)

v1 ships on **Individual KHQR** (a locked decision — PRD §10). That's correct for
launch. Be aware of the trade-offs and when to upgrade:

- **Individual accounts have lower per-transaction / daily receiving limits** and
  are not VAT/merchant-statement oriented. Fine for a small single-operator shop.
- **Upgrade to a Merchant (KHQR) account** as a fast-follow when: you start
  charging VAT, you hit receiving limits, or you need proper merchant settlement
  reporting. The code is config-driven (account type lives in `BAKONG_ACCOUNT` +
  the QR profile), so the upgrade is mostly swapping the account ID and
  re-validating with a live scan — but treat it as its own task, not an ad-hoc
  change.

---

## 10. Quick-start summary

1. **Account ID** — copy `username@bankcode` from the Bakong app → `BAKONG_ACCOUNT`.
2. **API token** — register at <https://api-bakong.nbc.gov.kh/register> → `BAKONG_TOKEN` (90-day expiry — set a reminder!).
3. **Proxy** — stand up an in-Cambodia `https://` pass-through to `api-bakong.nbc.gov.kh/v1` → `BAKONG_PROXY_URL` + `BAKONG_PROXY_ALLOWED_HOSTS`.
4. **Wire `.env`**, restart the backend (must boot clean).
5. **Live-scan test:** generate a QR, scan it, confirm payee + amount, pay a tiny sum, watch `pending → paid`.

---

## Sources

- [Bakong Open API portal](https://api-bakong.nbc.gov.kh/) · [SIT/staging](https://sit-api-bakong.nbc.gov.kh/) · [developer docs](https://api-bakong.nbc.gov.kh/document) · [register](https://api-bakong.nbc.gov.kh/register)
- [Bakong Open API Implementation Guideline (NBC, PDF)](https://bakong.nbc.gov.kh/download/KHQR/integration/Bakong%20Open%20API%20Document.pdf)
- [Bakong QR Payment Integration (NBC, PDF)](https://bakong.nbc.gov.kh/download/QR%20Payment%20Integration.pdf)
- Reference SDKs (for endpoint/field shapes — we do **not** depend on these; logic is vendored): [bsthen/bakong-khqr (Python)](https://github.com/bsthen/bakong-khqr) · [chhunneng/bakong-khqr (Go)](https://github.com/chhunneng/bakong-khqr)
- Internal: [`docs/payments-khqr.md`](./payments-khqr.md) (implementation reference), `backend/src/modules/bakong-payment/`, `backend/medusa-config.ts`, `backend/.env.template`.
