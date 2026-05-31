# Cloudflare R2 Setup Guide (Product Image Storage)

This guide walks you through creating a Cloudflare R2 bucket and wiring its
credentials into the Medusa backend so admin product-image uploads are stored
on R2 and served over a CDN. It assumes **no prior Cloudflare/S3 experience**.

R2 is the storage backend configured in `backend/medusa-config.ts` (the
`@medusajs/file-s3` provider). This is task **SETUP-05** in `ImplementPlan.md`.

> **You do NOT need to own the domain yet.** R2 gives every bucket a free
> temporary public URL (`*.r2.dev`) you can use for development now. When you
> buy `alistore.com` and complete **SETUP-11**, you swap that one URL for
> `https://img.alistore.com` — nothing else changes.

---

## Why R2 (and is it free?)

R2 is Cloudflare's S3-compatible object storage. The free tier is generous and
covers a single-shop storefront comfortably:

| Resource | Free per month |
|---|---|
| Storage | 10 GB-month |
| Class A ops (uploads/lists) | 1 million |
| Class B ops (reads/downloads) | 10 million |
| Egress (bandwidth out) | Free / unlimited |

You will likely pay **$0/month**. Cloudflare still asks for a payment method to
*activate* R2 — you are only charged if you exceed the allowances above.

> Pricing can change. Confirm current numbers on Cloudflare's R2 pricing page.

---

## Prerequisites

- A Cloudflare account (free to create at <https://dash.cloudflare.com/sign-up>).
- The Ali Store backend cloned locally with `backend/.env` present.

---

## Step 1 — Enable R2

1. Log in to the Cloudflare dashboard: <https://dash.cloudflare.com>.
2. In the left sidebar, click **R2 Object Storage**.
3. Click **Enable R2** / **Purchase R2**. If prompted, add a payment method.
   (Free tier is still $0 — this is just to activate the service.)

---

## Step 2 — Create the bucket

1. In **R2 → Overview**, click **Create bucket**.
2. **Bucket name:** `ali-store-products`
   (lowercase, no spaces — write down exactly what you choose).
3. **Location:** choose **Automatic**, or the **Asia-Pacific (APAC)** hint for
   lower latency to Cambodia.
4. Click **Create bucket**.

➡️ This gives you your **`S3_BUCKET`** value (`ali-store-products`).

---

## Step 3 — Get your Account ID (the endpoint)

1. Go to **R2 → Overview**.
2. On the right side, find **Account ID** (a long hex string). Copy it.
3. Your S3 endpoint is:

   ```
   https://<account-id>.r2.cloudflarestorage.com
   ```

   Example: if your Account ID is `1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d`, then

   ```
   https://1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.r2.cloudflarestorage.com
   ```

➡️ This is your **`S3_ENDPOINT`** value.

---

## Step 4 — Create an API token (access key + secret)

1. Go to **R2 → Overview**, then click **Manage R2 API Tokens**
   (sometimes under **API → Manage API Tokens**).
2. Click **Create API Token**.
3. **Token name:** `ali-store-backend`.
4. **Permissions:** select **Object Read & Write**.
5. **Specify bucket(s):** scope it to **only** `ali-store-products`
   (least privilege — do not grant account-wide access).
6. Leave TTL as default (or set a long expiry) and click **Create API Token**.
7. Cloudflare now shows, **once only**:
   - **Access Key ID**
   - **Secret Access Key**

   Copy **both immediately** — the secret is never shown again. If you lose it,
   delete the token and create a new one.

➡️ These are your **`S3_ACCESS_KEY_ID`** and **`S3_SECRET_ACCESS_KEY`** values.

> 🔒 Treat the Secret Access Key like a password. Never paste it into chat,
> commit it, or share it. It only belongs in `backend/.env` (which is
> git-ignored).

---

## Step 5 — Enable the temporary public URL (dev only)

Until the real domain is connected (SETUP-11), use Cloudflare's free dev URL so
uploaded images are publicly viewable.

1. Open your bucket → **Settings** tab.
2. Find **Public access** → **R2.dev subdomain**.
3. Click **Allow Access** (confirm the warning).
4. Copy the URL it shows, e.g.:

   ```
   https://pub-1a2b3c4d5e6f.r2.dev
   ```

➡️ This is your **temporary `S3_FILE_URL`** value.

> ⚠️ The `r2.dev` URL is **development/testing only**. Cloudflare rate-limits it
> and explicitly says not to use it in production. In SETUP-11 you replace it
> with `https://img.alistore.com` and **turn this `r2.dev` access back off**.

---

## Step 6 — Fill in `backend/.env`

Open `backend/.env` and set the R2 block (the keys already exist as blanks):

```dotenv
# Cloudflare R2 file storage (S3-compatible). Product images.
S3_FILE_URL=https://pub-1a2b3c4d5e6f.r2.dev          # Step 5 — temporary dev URL
S3_REGION=auto                                        # leave as-is (R2 ignores region)
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com   # Step 3
S3_BUCKET=ali-store-products                          # Step 2
S3_ACCESS_KEY_ID=<your-access-key-id>                 # Step 4
S3_SECRET_ACCESS_KEY=<your-secret-access-key>         # Step 4
```

Replace each `<...>` with your real value. Do **not** wrap values in quotes.

> The File Module in `medusa-config.ts` only turns on when `S3_FILE_URL`,
> `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` are
> **all** set. If any is blank, Medusa falls back to local disk storage for dev.

---

## Step 7 — Restart and test

1. Restart the backend:

   ```bash
   cd backend
   npx medusa develop
   ```

2. Open the admin at <http://localhost:9000/app> and log in.
3. Go to **Products → (any product) → Media**, or **Upload** an image.
4. After upload, the image URL should start with your `S3_FILE_URL`, e.g.
   `https://pub-1a2b3c4d5e6f.r2.dev/...`, and the image should load in the
   browser.
5. In the Cloudflare dashboard, open the bucket — you should see the uploaded
   object listed.

✅ If the image uploads, returns an `r2.dev` URL, and loads — R2 is working.

---

## Going to production (later, in SETUP-11)

When `alistore.com` is purchased and added to Cloudflare:

1. In the bucket → **Settings → Custom Domains**, connect `img.alistore.com`.
2. **Disable** the `r2.dev` public access from Step 5.
3. Change `.env`:

   ```dotenv
   S3_FILE_URL=https://img.alistore.com
   ```

4. Restart the backend. New uploads now return `https://img.alistore.com/...`.

(DNS/CDN routing for all subdomains is documented in `infra/dns.md` per SETUP-11.)

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Upload fails with `Access Denied` / `403` | Token lacks **Object Read & Write**, or is scoped to a different bucket. Recreate the token (Step 4). |
| Upload fails with `NoSuchBucket` | `S3_BUCKET` typo, or `S3_ENDPOINT` Account ID is wrong. |
| `SignatureDoesNotMatch` | Wrong `S3_SECRET_ACCESS_KEY`, or a stray quote/space in `.env`. |
| Image uploads but URL won't load | `r2.dev` public access not enabled (Step 5), or `S3_FILE_URL` doesn't match the `pub-….r2.dev` URL. |
| Still using local disk after editing `.env` | One of the five required keys is still blank, or the server wasn't restarted. |

---

## Security checklist

- [ ] API token scoped to the single `ali-store-products` bucket (not account-wide).
- [ ] Secret Access Key only in `backend/.env` — never committed, never in chat.
- [ ] `r2.dev` public access disabled once `img.alistore.com` is live (production).
- [ ] Production bucket has **no public list** — public **read** only, via `img.alistore.com`.
- [ ] Rotate the token if it is ever exposed (delete + recreate, then update `.env`).
