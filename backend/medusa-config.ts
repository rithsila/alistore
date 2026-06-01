import { loadEnv, defineConfig } from '@medusajs/framework/utils'

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
const paymentModule = {
  resolve: "@medusajs/medusa/payment",
  options: {
    providers: [
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
    ],
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
    paymentModule,
    // Custom stock ledger module (SETUP-06). Always loaded; migrations for its
    // stock_movement table are generated/applied in SETUP-08.
    { resolve: "./src/modules/stock-movement" },
    // Facebook-login identity link module (SETUP-07). Always loaded; migrations
    // for its customer_social_identity table are generated/applied in SETUP-08.
    { resolve: "./src/modules/social-identity" },
  ],
})
