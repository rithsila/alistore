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
        options: { redis: { url: redisUrl } },
      },
    ]
  : []

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
  modules: redisModules,
})
