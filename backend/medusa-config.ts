import { loadEnv, defineConfig } from '@medusajs/framework/utils'
import { assertSafeProxyUrl } from './src/modules/bakong-payment/lib/proxy'
import { assertSafePayWayUrl } from './src/modules/aba-payway/lib/client'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const jwtSecret = process.env.JWT_SECRET
const cookieSecret = process.env.COOKIE_SECRET

if (!jwtSecret || !cookieSecret) {
  throw new Error(
    "JWT_SECRET and COOKIE_SECRET must be set (use long, unpredictable values, e.g. `openssl rand -base64 48`)."
  )
}

// Redis-backed modules (event bus, cache, workflow engine) are enabled only
// when REDIS_URL is set. Without it, Medusa falls back to its in-memory event
// bus, cache, and workflow engine — acceptable for quick local dev, but never
// for production. See docs/postgres-proxmox-lxc-setup.md for the Redis setup.
const redisUrl = process.env.REDIS_URL

const redisModules = redisUrl
  ? [
      { resolve: "@medusajs/medusa/cache-redis", options: { redisUrl } },
      { resolve: "@medusajs/medusa/event-bus-redis", options: { redisUrl } },
      {
        resolve: "@medusajs/medusa/workflow-engine-redis",
        // Medusa v2.15.3's workflow-engine-redis destructures `url` from
        // `options.redis`; the flat `redisUrl` form crashes the loader.
        options: { redis: { url: redisUrl } },
      },
    ]
  : []

// Cloudflare R2 (S3-compatible) file storage. Product images are uploaded to
// the R2 bucket and served publicly through the CDN on img.alistore.com
// (S3_FILE_URL). The File Module is enabled only when all R2 settings are
// present; otherwise Medusa keeps its default local file provider for dev so
// the server still boots without R2 credentials.
const s3FileUrl = process.env.S3_FILE_URL
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY
const s3Bucket = process.env.S3_BUCKET
const s3Endpoint = process.env.S3_ENDPOINT

const fileModules =
  s3FileUrl && s3AccessKeyId && s3SecretAccessKey && s3Bucket && s3Endpoint
    ? [
        {
          resolve: "@medusajs/medusa/file",
          options: {
            providers: [
              {
                resolve: "@medusajs/file-s3",
                id: "s3",
                options: {
                  // Public CDN base URL (img.alistore.com); the provider
                  // appends the object key to build the returned image URL.
                  file_url: s3FileUrl,
                  access_key_id: s3AccessKeyId,
                  secret_access_key: s3SecretAccessKey,
                  // R2 ignores region but the S3 client requires one.
                  region: process.env.S3_REGION || "auto",
                  bucket: s3Bucket,
                  // R2 S3 API endpoint: https://<account-id>.r2.cloudflarestorage.com
                  endpoint: s3Endpoint,
                },
              },
            ],
          },
        },
      ]
    : []

// Bakong KHQR payment provider (BACKEND-03). Registered under Medusa's Payment
// Module so the cart uses payment_collection / payment_session (PRD §4, native
// model). The provider id resolves to `pp_bakong_khqr`. Secrets (BAKONG_ACCOUNT,
// token, proxy) stay in .env; merchant name/city default for the Phnom Penh shop
// and may be overridden per environment. QR expiry aligns with the 20-min
// reservation TTL (security.md).
// SSRF boot check (security.md "SSRF (Bakong proxy URL)"): validate the proxy
// URL shape + allowlist at startup so a misconfigured proxy fails fast instead
// of surfacing as a customer-facing 502 mid-checkout. DNS resolution is still
// re-checked at call time (DNS-rebind defense in lib/proxy.ts).
const bakongProxyUrl = process.env.BAKONG_PROXY_URL
if (bakongProxyUrl) {
  const allowedProxyHosts = (process.env.BAKONG_PROXY_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  assertSafeProxyUrl(
    bakongProxyUrl,
    allowedProxyHosts.length > 0 ? allowedProxyHosts : undefined
  )
}

// ABA PayWay (PAYWAY-01/02): direct HTTPS gateway — no proxy. SSRF boot check
// mirrors the Bakong one above: validate the base URL against the hard-coded
// host allowlist at startup so a misconfigured/poisoned PAYWAY_BASE_URL fails
// fast instead of mid-checkout. DNS resolution is re-checked at call time in
// lib/client.ts. The dev loopback escape (PAYWAY_DEV_ALLOW_LOOPBACK=1,
// non-production) admits only the local mock gateway.
const paywayBaseUrl = process.env.PAYWAY_BASE_URL
if (paywayBaseUrl) {
  assertSafePayWayUrl(paywayBaseUrl)
}

// Auth Module providers (BACKEND-05B/05C). Specifying `providers` overrides the
// framework default, so `emailpass` MUST stay listed — admin login + MFA
// (security.md) depend on it. The Facebook and Google providers are each added
// only when their credentials are present (mirrors the conditional file/payment
// modules above) so dev boot never fails on missing social secrets; each
// callback URL must match the redirect_uri the respective start route sends
// (FB_OAUTH_REDIRECT_URI / GOOGLE_OAUTH_REDIRECT_URI), validated there.
const fbAppId = process.env.FB_APP_ID
const fbAppSecret = process.env.FB_APP_SECRET
const fbCallbackUrl =
  process.env.FB_OAUTH_REDIRECT_URI ||
  "http://localhost:9000/store/auth/facebook/callback"

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const googleCallbackUrl =
  process.env.GOOGLE_OAUTH_REDIRECT_URI ||
  "http://localhost:9000/store/auth/google/callback"

const authProviders: Record<string, unknown>[] = [
  { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
]
if (fbAppId && fbAppSecret) {
  authProviders.push({
    resolve: "./src/modules/auth-facebook",
    id: "facebook",
    options: {
      clientId: fbAppId,
      clientSecret: fbAppSecret,
      callbackUrl: fbCallbackUrl,
    },
  })
}
if (googleClientId && googleClientSecret) {
  authProviders.push({
    resolve: "@medusajs/medusa/auth-google",
    id: "google",
    options: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      callbackUrl: googleCallbackUrl,
    },
  })
}

const authModule = {
  resolve: "@medusajs/medusa/auth",
  options: { providers: authProviders },
}

// Payment providers. Bakong stays registered (dormant wiring — the storefront
// flow now targets PayWay, ImplementPlan Phase 6 locked decision); ABA PayWay
// registers only when its merchant credentials are present (same conditional
// pattern as the auth providers) so dev boots without them.
const paymentProviders: Record<string, unknown>[] = [
  {
    resolve: "./src/modules/bakong-payment",
    id: "khqr",
    options: {
      bakongAccount: process.env.BAKONG_ACCOUNT || "",
      merchantName: process.env.BAKONG_MERCHANT_NAME || "Ali Store",
      merchantCity: process.env.BAKONG_MERCHANT_CITY || "Phnom Penh",
      expiresInMinutes:
        Number(process.env.BAKONG_QR_EXPIRES_MINUTES) || 20,
    },
  },
]
if (process.env.PAYWAY_MERCHANT_ID && process.env.PAYWAY_API_KEY) {
  paymentProviders.push({
    resolve: "./src/modules/aba-payway",
    id: "khqr",
    options: {
      // Payment lifetime == stock-reservation TTL (one constant, PAYWAY-05).
      expiresInMinutes: Number(process.env.PAYWAY_EXPIRES_MINUTES) || 20,
    },
  })
}

const paymentModule = {
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: paymentProviders,
  },
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // Used for Medusa's distributed locking when Redis is available.
    ...(redisUrl ? { redisUrl } : {}),
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret,
      cookieSecret,
    }
  },
  modules: [
    ...redisModules,
    ...fileModules,
    authModule,
    paymentModule,
    // Custom stock ledger module (SETUP-06). Always loaded; migrations for its
    // stock_movement table are generated/applied in SETUP-08.
    { resolve: "./src/modules/stock-movement" },
    // Facebook-login identity link module (SETUP-07). Always loaded; migrations
    // for its customer_social_identity table are generated/applied in SETUP-08.
    { resolve: "./src/modules/social-identity" },
  ],
})
