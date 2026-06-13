/**
 * Atomic fixed-window rate limiter (security.md "Concrete rate limits"; fixes
 * audit finding C-02).
 *
 * The previous per-route helper used the Medusa Cache module with a non-atomic
 * get -> check -> set sequence. Under a concurrent burst, N requests all read
 * the same counter value before any write landed, so every mandated limit (COD,
 * OAuth, KHQR/KHPAY/PayWay, admin) collapsed to ~N x the intended rate. This
 * module centralises ONE atomic implementation:
 *
 *  - When REDIS_URL is set (staging/prod), the increment is atomic across every
 *    server process via a Redis Lua script (INCR + PEXPIRE-on-first-hit), so the
 *    limit holds under concurrency and across instances.
 *  - When REDIS_URL is unset (local dev / in-memory cache), a synchronous
 *    in-process counter is race-free within the single Node process — JS is
 *    single-threaded and the check+increment runs with no intervening await.
 *    The same in-process path is the fail-open fallback if a Redis command
 *    errors mid-flight, so a Redis hiccup degrades the limiter rather than
 *    failing a customer's checkout or login outright.
 *
 * Returns true when the caller is already AT/OVER the limit (request rejected),
 * matching the previous helper's semantics: exactly `limit` requests are allowed
 * per window before rejection.
 *
 * The dedicated connection mirrors REDIS_URL, the same instance Medusa's
 * cache/event-bus modules use (see medusa-config.ts). ioredis is Medusa's own
 * Redis client; it is pinned exact in package.json.
 */
import { Redis } from "ioredis"

// Atomically increment the window counter and, only on its first hit, arm the
// expiry. Returns the post-increment count. The time bucket lives in the key
// (fixed window); PEXPIRE is cleanup so stale buckets cannot leak in Redis.
const INCR_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return c
`

// `undefined` = not yet initialised; `null` = no Redis configured (dev).
let redisClient: Redis | null | undefined

function getClient(): Redis | null {
  if (redisClient !== undefined) {
    return redisClient
  }
  const url = process.env.REDIS_URL
  if (!url) {
    redisClient = null
    return null
  }
  const client = new Redis(url, {
    // Bound failures so a degraded Redis can't hang a checkout/login request;
    // a failed command throws quickly and we fall back to the in-process path.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  })
  // A connection-level error must never crash the process; per-command failures
  // are handled at the call site.
  client.on("error", () => undefined)
  redisClient = client
  return client
}

// In-process fallback counters: bucketed key -> { count, resetAt(ms epoch) }.
const localCounters = new Map<string, { count: number; resetAt: number }>()

function localOverLimit(
  key: string,
  limit: number,
  ttlMs: number,
  now: number
): boolean {
  const entry = localCounters.get(key)
  if (!entry || entry.resetAt <= now) {
    localCounters.set(key, { count: 1, resetAt: now + ttlMs })
    // Opportunistic sweep so the map cannot grow unbounded over a long uptime.
    if (localCounters.size > 10_000) {
      for (const [k, v] of localCounters) {
        if (v.resetAt <= now) localCounters.delete(k)
      }
    }
    return 1 > limit
  }
  entry.count += 1
  return entry.count > limit
}

/**
 * Atomic fixed-window check. `keyPrefix` namespaces the counter (e.g.
 * `rl:cod:ip:1.2.3.4`); `windowMs` sets the bucket width; `limit` is the max
 * requests per window; `ttl` is the bucket lifetime in SECONDS (kept for parity
 * with the existing rate-limit constants). Returns true when over the limit.
 */
export async function overLimitAtomic(
  keyPrefix: string,
  windowMs: number,
  limit: number,
  ttl: number
): Promise<boolean> {
  const now = Date.now()
  const bucket = Math.floor(now / windowMs)
  const key = `${keyPrefix}:${bucket}`
  const ttlMs = Math.max(windowMs, ttl * 1000)

  const client = getClient()
  if (client) {
    try {
      const count = (await client.eval(
        INCR_SCRIPT,
        1,
        key,
        String(ttlMs)
      )) as number
      return count > limit
    } catch {
      // Redis unavailable mid-flight: degrade to in-process limiting rather than
      // failing the request outright.
      return localOverLimit(key, limit, ttlMs, now)
    }
  }
  return localOverLimit(key, limit, ttlMs, now)
}
