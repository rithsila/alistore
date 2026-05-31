# Cloudflare DNS / Domain / Subdomains — SETUP-11

> **STATUS: TEMPLATE / NOT YET PROVISIONED.**
> This file documents the *intended* Cloudflare DNS configuration. It is **not** live.
> The acceptance criterion for SETUP-11 — *"All three subdomains resolve over HTTPS"* —
> **is not met** and cannot be until the two blockers below are resolved.
>
> **Blockers (open `⚠️ CLARIFY` items in `ImplementPlan.md`):**
> - **CLARIFY-08-REOPEN ⚠️** — The domain is **not yet purchased / confirmed owned**. `alistore.com`
>   was only *provisionally* locked. Every `${DOMAIN}` below is provisional until the real domain
>   is bought and CLARIFY-08 is re-resolved via `/clarify CLARIFY-08`.
> - **CLARIFY-11 (hostname value)** — The **production Medusa API hostname** (the public address
>   of the Proxmox VM) is unknown. Dev runs against `localhost:9000`. `${BACKEND_HOST}` /
>   `${BACKEND_ORIGIN_IP}` below are placeholders until the domain is chosen.
>
> Fill the **Variables** table, replace every `${...}` token, then provision and verify.

---

## Variables (fill these in once the domain is bought)

| Token                 | Meaning                                              | Value (fill in)                          |
|-----------------------|------------------------------------------------------|------------------------------------------|
| `${DOMAIN}`           | Registered apex domain                               | `alistore.com` *(PROVISIONAL — unbought)*|
| `${BACKEND_ORIGIN_IP}`| Public IPv4 of the Proxmox VM hosting Medusa         | `TBD` *(CLARIFY-11)*                      |
| `${VERCEL_CNAME}`     | Vercel-assigned CNAME target for the storefront      | `cname.vercel-dns.com` *(confirm in Vercel)* |
| `${R2_PUBLIC_HOST}`   | R2 public bucket host to alias for images            | `<bucket>.r2.dev` or R2 custom-domain target |

**Subdomain plan (from CLARIFY-08, provisional):**

| Subdomain            | Purpose            | Routes to        |
|----------------------|--------------------|------------------|
| `shop.${DOMAIN}`     | Storefront         | Vercel           |
| `img.${DOMAIN}`      | Product images/CDN | Cloudflare R2     |
| `api.${DOMAIN}`      | Medusa backend API | Proxmox VM (origin) |

> The plan names the backend host generically ("backend host → Proxmox"); `api.${DOMAIN}` is the
> proposed label. Confirm the exact backend hostname when resolving CLARIFY-11, and keep it in sync
> with the storefront `MEDUSA_BACKEND_URL`, the CSP `connect-src` host, and the CORS allowlist
> (see `.claude/rules/security.md`).

---

## 1. Add the domain to Cloudflare

1. Cloudflare Dashboard → **Add a site** → enter `${DOMAIN}`.
2. Choose a plan (Free is sufficient for v1).
3. Cloudflare scans existing records — review, then continue.
4. At the **registrar**, replace the nameservers with the two Cloudflare nameservers shown
   (e.g. `xxx.ns.cloudflare.com`). Wait for Cloudflare to report the zone **Active**.
5. **SSL/TLS → Overview**: set encryption mode to **Full (strict)**
   (origins must present a valid certificate — see §4).

---

## 2. DNS records

Create the following records in **DNS → Records**. The **Proxy** column controls whether traffic
flows through Cloudflare (orange cloud) or resolves directly to the origin (grey cloud).

| Type  | Name              | Content / Target          | Proxy        | Notes |
|-------|-------------------|---------------------------|--------------|-------|
| CNAME | `shop`            | `${VERCEL_CNAME}`         | DNS only (grey) | Vercel manages its own edge + TLS; do **not** proxy through Cloudflare. Add `shop.${DOMAIN}` as a domain in the Vercel project and follow Vercel's verification record if prompted. |
| CNAME | `img`             | `${R2_PUBLIC_HOST}`       | Proxied (orange) | Serves product images via Cloudflare CDN. Prefer attaching `img.${DOMAIN}` as an **R2 custom domain** (R2 → bucket `ali-store-products` → Settings → Custom Domains), which provisions the record + cert automatically. |
| A     | `api`             | `${BACKEND_ORIGIN_IP}`    | Proxied (orange) | Medusa backend on the Proxmox VM. Proxying hides the origin IP and terminates TLS at Cloudflare. |
| AAAA  | `api`             | `${BACKEND_ORIGIN_IPV6}`  | Proxied (orange) | *Optional* — add only if the VM has a public IPv6. |

> **Apex (`${DOMAIN}`) is intentionally not configured here.** SETUP-11 scopes only the three
> subdomains. Decide apex behavior (redirect to `shop.`, holding page, or unused) in a later task.

---

## 3. CDN caching (images)

For `img.${DOMAIN}` (R2-backed product images):

- **Caching → Configuration**: Caching Level **Standard**; Browser Cache TTL **Respect Existing Headers**.
- Ensure objects are uploaded with a long `Cache-Control` (e.g. `public, max-age=31536000, immutable`)
  since product images are content-addressed by key. The S3 file provider / upload path sets this; do
  **not** set short TTLs on immutable image keys.
- Optionally add a **Cache Rule** scoped to `Hostname eq img.${DOMAIN}` → **Eligible for cache**,
  Edge TTL "Use cache-control header".
- Leave `shop.${DOMAIN}` (Vercel) and `api.${DOMAIN}` (dynamic API) **uncached at the edge** for HTML/JSON.
  Do not add aggressive cache rules to the API host — payment/status/order responses must never be cached
  (`GET /store/payments/khqr/status` is explicitly short-lived; see `security.md`).

---

## 4. SSL / TLS

- **Encryption mode: Full (strict)** zone-wide.
- `shop.${DOMAIN}` — TLS handled by **Vercel** (grey-cloud / DNS-only); no Cloudflare cert needed.
- `img.${DOMAIN}` — cert provisioned by **R2 custom domain** (or Cloudflare edge cert if proxied).
- `api.${DOMAIN}` — the **Proxmox origin must present a valid certificate** for Full (strict) to work.
  Use a **Cloudflare Origin CA certificate** installed on the VM's reverse proxy (or a Let's Encrypt cert).
- Enable **Always Use HTTPS** (Edge Certificates) so HTTP → HTTPS redirects automatically.
- HSTS is asserted by the application response headers per `security.md`
  (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`). Enable Cloudflare's HSTS
  setting **only** after confirming every subdomain is HTTPS-ready, to avoid locking out a misconfigured host.

---

## 5. Cross-references to keep in sync

When the domain + backend hostname are finalized, update **all** of these together
(they are gated on the same CLARIFY-11 / CLARIFY-08 resolution):

- Storefront `MEDUSA_BACKEND_URL` → `https://api.${DOMAIN}`
- CSP `connect-src` host → `https://api.${DOMAIN}` (see `.claude/rules/security.md` HTTP headers)
- CSP `img-src` → `https://img.${DOMAIN}`
- Medusa CORS allowlist → `https://shop.${DOMAIN}` (storefront) + admin origin
- SETUP-05 production URL placeholder
- SETUP-09 image base URL — swap the temporary `r2.dev` URL for `https://img.${DOMAIN}`

---

## 6. Verification (acceptance criteria)

SETUP-11 is **done** only when all three resolve over HTTPS. Verify after provisioning:

```bash
# Each must return HTTP 200/3xx over TLS with a valid certificate
curl -sSI https://shop.${DOMAIN} | head -n 1
curl -sSI https://img.${DOMAIN}/<a-known-product-image-key> | head -n 1
curl -sSI https://api.${DOMAIN}/health | head -n 1

# Confirm DNS resolution + that the proxied hosts sit behind Cloudflare
dig +short shop.${DOMAIN}
dig +short img.${DOMAIN}
dig +short api.${DOMAIN}
```

- [ ] `shop.${DOMAIN}` serves the storefront over HTTPS (valid cert).
- [ ] `img.${DOMAIN}` serves an image over HTTPS from R2 via the CDN (valid cert, cache HIT on repeat).
- [ ] `api.${DOMAIN}` reaches Medusa on the Proxmox VM over HTTPS (Full strict, valid origin cert).

Until every box is checked against the **real** purchased domain, SETUP-11 remains **not done**.
