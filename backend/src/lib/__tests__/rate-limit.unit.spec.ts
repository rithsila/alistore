/**
 * Unit test for the atomic fixed-window rate limiter (audit finding C-02).
 *
 * Exercises the in-process path (no REDIS_URL), which is the branch that runs in
 * local dev and as the Redis-failure fallback — and the one the original
 * non-atomic get -> check -> set sequence broke within a single process. The
 * burst test is the direct race-fix proof: 50 concurrent calls must yield
 * EXACTLY `limit` allowances, not ~50.
 */
delete process.env.REDIS_URL // force the in-process branch regardless of env

import { overLimitAtomic } from "../rate-limit"

const WINDOW_MS = 60_000
const TTL_SECONDS = 60

// Unique key per assertion so module-level counters never collide across tests.
function uniqueKey(label: string): string {
  return `test:${label}:${Date.now()}:${Math.floor(Math.random() * 1e9)}`
}

describe("overLimitAtomic (in-process fixed window)", () => {
  it("allows exactly `limit` requests in a window, then rejects", async () => {
    const key = uniqueKey("seq")
    const limit = 5
    const results: boolean[] = []
    for (let i = 0; i < 8; i++) {
      results.push(await overLimitAtomic(key, WINDOW_MS, limit, TTL_SECONDS))
    }
    // false = allowed (not over). First `limit` allowed, remainder rejected.
    expect(results.filter((over) => !over).length).toBe(limit)
    expect(results.slice(0, limit).every((over) => over === false)).toBe(true)
    expect(results.slice(limit).every((over) => over === true)).toBe(true)
  })

  it("holds the limit under a concurrent burst (race-fix proof)", async () => {
    const key = uniqueKey("race")
    const limit = 10
    const burst = 50
    const results = await Promise.all(
      Array.from({ length: burst }, () =>
        overLimitAtomic(key, WINDOW_MS, limit, TTL_SECONDS)
      )
    )
    const allowed = results.filter((over) => !over).length
    expect(allowed).toBe(limit) // exactly 10 — the pre-fix code allowed ~50
  })

  it("tracks independent keys separately", async () => {
    const a = uniqueKey("a")
    const b = uniqueKey("b")
    expect(await overLimitAtomic(a, WINDOW_MS, 1, TTL_SECONDS)).toBe(false)
    expect(await overLimitAtomic(a, WINDOW_MS, 1, TTL_SECONDS)).toBe(true)
    expect(await overLimitAtomic(b, WINDOW_MS, 1, TTL_SECONDS)).toBe(false)
  })
})
