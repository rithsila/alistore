import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * TEST-04 — Bakong KHQR backend contract (sandbox).
 *
 * SCOPE CHANGE (PAYWAY-07, 2026-06-10): ABA PayWay replaced Bakong as the
 * ACTIVE storefront KHQR provider (ImplementPlan Phase 6), so the full
 * UI journey that used to live in this file now runs against PayWay in
 * `payway.spec.ts`. This spec keeps the backend CONTRACT coverage for the
 * dormant-but-registered Bakong provider (`/store/payments/khqr/*`), which
 * stays in the codebase for a possible direct-Bakong future.
 *
 * ── How "simulate pay" works (user-approved seam, 2026-06-06) ────────────────
 * The backend's payment verification is server-side only (security.md): both
 * `/khqr/status` and the Bakong provider's `authorizePayment` confirm payment
 * exclusively through the Bakong proxy (`check_transaction_by_md5`). This spec
 * hosts a MOCK of that proxy on `127.0.0.1:${MOCK_PROXY_PORT}` and flips a
 * reference to "found" (responseCode 0) to simulate the customer paying — so
 * the REAL verify → authorize → completeCart → stock-out code runs unmodified.
 * The SSRF guard normally (and correctly) blocks loopback proxies; the
 * dev-only, loopback-only escape in `bakong-payment/lib/proxy.ts` (gated on
 * NODE_ENV ≠ production AND `BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1`) lets the dev
 * backend reach the mock.
 *
 * Prerequisites (see playwright.config.ts for the dev-stack basics):
 *  - backend :9000 + storefront :8000 running, TEST-01 fixtures applied, and
 *    the Cambodia shipping option seeded (backend/src/scripts/seed-shipping.ts);
 *  - backend/.env must carry the dev-mock Bakong block (BAKONG_TOKEN set,
 *    BAKONG_PROXY_URL=http://127.0.0.1:4280, BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1)
 *    and the backend must have been (re)started after setting it — the spec
 *    fails with a setup message when the seam isn't active;
 *  - while this env block is set, /store/payments/khqr/* 502s whenever the
 *    mock is NOT listening — i.e. outside runs of this spec. Blank the block
 *    to return to QR-render-only sandbox behavior.
 *
 * Serial on purpose: the mock binds a fixed port and the tests share one
 * paid-references set, so they must run in a single worker, in order.
 *
 * Rate limits (security.md): `POST /khqr/start` allows 5/min/IP. This spec
 * makes 1 start call; payway.spec.ts hits its own separate limiter keys.
 *
 * Variant choice: sweatpants size S — TEST-03 (cod.spec.ts) owns M and L for
 * its stock-count assertions, and the TEST-01 fixtures zero XL.
 */

test.describe.configure({ mode: "serial" })

const KHQR_SIZE = "S"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"

/** Must match BAKONG_PROXY_URL in backend/.env (dev-mock block). */
const MOCK_PROXY_PORT = 4280
/** Deeplink the mock returns — asserting it proves the backend hit OUR mock. */
const MOCK_DEEPLINK = "https://bakong-mock.invalid/d/khqr-e2e"

/** `md5(qr)` — 32 lowercase hex chars (BACKEND-03 reference contract). */
const REFERENCE_PATTERN = /^[a-f0-9]{32}$/

// ── Mock Bakong proxy ─────────────────────────────────────────────────────────

/** References the "customer" has paid; checked by the mock's md5 endpoint. */
const paidReferences = new Set<string>()

let mockProxy: Server | undefined

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      body += chunk
    })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

/**
 * Minimal stand-in for the in-Cambodia Bakong proxy — the two paths
 * `lib/proxy.ts` calls. `check_transaction_by_md5` answers Bakong's real
 * shapes: `responseCode 0` + data once the QR is paid, `responseCode 1` while
 * pending (exactly what `checkTransactionByMd5` keys on).
 */
function startMockBakongProxy(): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0]
      const respond = (body: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify(body))
      }
      try {
        if (
          req.method === "POST" &&
          path.endsWith("/generate_deeplink_by_qr")
        ) {
          await readBody(req)
          return respond({ data: { shortLink: MOCK_DEEPLINK } })
        }
        if (
          req.method === "POST" &&
          path.endsWith("/check_transaction_by_md5")
        ) {
          const body = JSON.parse((await readBody(req)) || "{}") as {
            md5?: string
          }
          const paid =
            typeof body.md5 === "string" && paidReferences.has(body.md5)
          return respond(
            paid
              ? { responseCode: 0, data: { hash: body.md5 } }
              : {
                  responseCode: 1,
                  responseMessage: "Transaction could not be found",
                  data: null,
                }
          )
        }
        res.writeHead(404, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "unknown_mock_path" }))
      } catch {
        res.writeHead(500)
        res.end()
      }
    })()
  })

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `Mock Bakong proxy port ${MOCK_PROXY_PORT} is already in use — ` +
                "is another khqr.spec run (or a stale process) holding it?"
            )
          : err
      )
    })
    server.listen(MOCK_PROXY_PORT, "127.0.0.1", () => resolve(server))
  })
}

test.beforeAll(async () => {
  mockProxy = await startMockBakongProxy()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!mockProxy) return resolve()
    mockProxy.close(() => resolve())
  })
})

// ── Shared helpers (cod.spec.ts precedents) ──────────────────────────────────

/** Read a storefront env value: process env first, then .env.local / .env. */
function readStorefrontEnv(name: string): string | undefined {
  if (process.env[name]) {
    return process.env[name]
  }
  for (const file of [".env.local", ".env"]) {
    try {
      const content = readFileSync(join(__dirname, "..", file), "utf8")
      const match = content.match(new RegExp(`^${name}=(.*)$`, "m"))
      if (match) {
        return match[1].trim()
      }
    } catch {
      // File absent — try the next one.
    }
  }
  return undefined
}

function publishableKeyHeaders(): Record<string, string> {
  const publishableKey = readStorefrontEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")
  expect(
    publishableKey,
    "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY missing (storefront env)"
  ).toBeTruthy()
  return {
    "x-publishable-api-key": publishableKey!,
    "content-type": "application/json",
  }
}

function md5Hex(value: string): string {
  return createHash("md5").update(value).digest("hex")
}

/** BACKEND-03 `/start` response shape. */
interface KhqrStartResponse {
  qr: string
  deeplink: string | null
  reference: string
  expires_at: string | null
}

/**
 * Assert the seam is actually active: with the dev-mock env block loaded the
 * backend resolves the deeplink THROUGH the mock; `deeplink: null` means the
 * backend still runs without `BAKONG_PROXY_URL` (restart it after setting
 * backend/.env per the spec header).
 */
function expectSeamActive(deeplink: string | null): void {
  expect(
    deeplink,
    "Backend returned deeplink:null — the dev-mock Bakong env block " +
      "(BAKONG_TOKEN/BAKONG_PROXY_URL/BAKONG_PROXY_DEV_ALLOW_LOOPBACK) is not " +
      "loaded. Set it in backend/.env and restart the backend (spec header)."
  ).toBe(MOCK_DEEPLINK)
}

// ── 1. /start contract against the sandbox seam ──────────────────────────────

test.describe("KHQR start contract (BACKEND-03)", () => {
  test("returns a scannable QR, md5 reference, expiry; status pending before pay", async ({
    request,
  }) => {
    const headers = publishableKeyHeaders()

    // Cambodia region — never regions[0] (the seed's first region is EUR).
    const regionsRes = await request.get(
      `${BACKEND_URL}/store/regions?fields=*countries`,
      { headers }
    )
    expect(regionsRes.ok()).toBeTruthy()
    const { regions } = (await regionsRes.json()) as {
      regions: Array<{ id: string; countries?: Array<{ iso_2: string }> }>
    }
    const region = regions.find((r) =>
      (r.countries ?? []).some((c) => c.iso_2 === "kh")
    )
    expect(region, "no region containing Cambodia (kh)").toBeTruthy()

    // The sweatpants variant for this spec (size S — see header).
    const productRes = await request.get(
      `${BACKEND_URL}/store/products?handle=sweatpants&region_id=${
        region!.id
      }&fields=*variants`,
      { headers }
    )
    expect(productRes.ok()).toBeTruthy()
    const { products } = (await productRes.json()) as {
      products: Array<{
        variants: Array<{ id: string; title?: string | null }>
      }>
    }
    const variant = products[0]?.variants.find((v) => v.title === KHQR_SIZE)
    expect(variant, `sweatpants variant "${KHQR_SIZE}" not found`).toBeTruthy()

    // Minimal cart — /start needs only a priced line item (no email/shipping).
    const cartRes = await request.post(`${BACKEND_URL}/store/carts`, {
      headers,
      data: { region_id: region!.id },
    })
    expect(cartRes.ok()).toBeTruthy()
    const cartId = ((await cartRes.json()) as { cart: { id: string } }).cart.id

    const lineRes = await request.post(
      `${BACKEND_URL}/store/carts/${cartId}/line-items`,
      { headers, data: { variant_id: variant!.id, quantity: 1 } }
    )
    expect(lineRes.ok()).toBeTruthy()

    // ── start: the BACKEND-03 contract.
    const startRes = await request.post(
      `${BACKEND_URL}/store/payments/khqr/start`,
      { headers, data: { cart_id: cartId, currency: "USD" } }
    )
    expect(startRes.status()).toBe(200)
    const start = (await startRes.json()) as KhqrStartResponse

    // EMVCo KHQR: payload format indicator "000201" + point-of-initiation "12"
    // (dynamic QR), CRC tag at the tail; reference is md5(qr).
    expect(start.qr.startsWith("000201")).toBeTruthy()
    expect(start.qr).toMatch(/6304[0-9A-F]{4}$/)
    expect(start.reference).toMatch(REFERENCE_PATTERN)
    expect(start.reference).toBe(md5Hex(start.qr))

    // Expiry: ISO timestamp within the QR window (default 20 min).
    expect(start.expires_at).toBeTruthy()
    const msLeft = Date.parse(start.expires_at!) - Date.now()
    expect(msLeft).toBeGreaterThan(60_000)
    expect(msLeft).toBeLessThanOrEqual(30 * 60_000)

    // Deeplink came through the mock — proves the seam is live end-to-end.
    expectSeamActive(start.deeplink)

    // ── status before any payment: pending (never fabricated paid).
    const statusRes = await request.get(
      `${BACKEND_URL}/store/payments/khqr/status?reference=${start.reference}`,
      { headers }
    )
    expect(statusRes.status()).toBe(200)
    expect(((await statusRes.json()) as { status: string }).status).toBe(
      "pending"
    )
  })
})


// The full storefront UI journey (formerly block 2 here) moved to
// payway.spec.ts when ABA PayWay replaced Bakong as the active provider
// (PAYWAY-06/07) — the pay screen now drives /store/payments/payway/*.
