import { execSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * TEST-04 — KHQR end-to-end (sandbox).
 *
 * Chain under test: start → simulate pay → status `paid` → order `paid` → one
 * `stock_movement(out)`.
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
 * Rate limits (security.md): `POST /khqr/start` allows 5/min/IP. A full run
 * makes 3 start calls (contract test + UI journey + idempotency probe), so
 * avoid more than one spec run per minute.
 *
 * Variant choice: sweatpants size S — TEST-03 (cod.spec.ts) owns M and L for
 * its stock-count assertions, and the TEST-01 fixtures zero XL.
 */

test.describe.configure({ mode: "serial" })

const PDP_PATH = "/product/sweatpants"
const KHQR_SIZE = "S"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

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

/** Fresh valid Cambodian phone per call (`^0[1-9]\d{7,8}$`). */
function randomPhone(): string {
  const digits = Math.floor(Math.random() * 10_000_000)
    .toString()
    .padStart(7, "0")
  return `09${digits}`
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

// ── 2. Full chain through the real storefront UI ─────────────────────────────

test.describe("KHQR full chain (TEST-04)", () => {
  test("simulated payment: status paid → order paid → one stock_movement(out)", async ({
    page,
  }) => {
    // UI journey + cart completion + a `medusa exec` boot — generous budget.
    test.setTimeout(420_000)

    // ── Add to bag (PDP, size S).
    await page.goto(PDP_PATH, { waitUntil: "domcontentloaded" })
    const sizeGroup = page.getByRole("group", { name: "Size" })
    await sizeGroup
      .getByRole("button", { name: KHQR_SIZE, exact: true })
      .click()
    await page.getByRole("button", { name: "Add to bag" }).click()
    await expect(page.getByText("Added to bag.")).toBeVisible()

    // ── Checkout: delivery details + KHQR (the default selection).
    await page.goto("/checkout", { waitUntil: "domcontentloaded" })
    // Hydration gate (cod.spec.ts): pre-hydration input is lost to component
    // state; the nav bag count only renders client-side, so it proves the tree
    // is interactive.
    await expect(page.getByRole("link", { name: "Bag, 1 item" })).toBeVisible()
    await page.locator("#delivery-full-name").fill("Test Four Khqr")
    await page.locator("#delivery-phone").fill(randomPhone())
    await page.locator("#delivery-address").fill("St 04, Phnom Penh")
    await page.getByText("Bakong KHQR", { exact: true }).click()
    const placeOrder = page.getByRole("button", { name: "Place order" })
    await expect(placeOrder).toBeEnabled()
    // Preps the cart (email + address + shipping method) then routes to the
    // pay screen (INTEGRATION-05).
    await placeOrder.click()
    await page.waitForURL(/\/checkout\/khqr/)

    // ── Pay screen: live QR + polling state.
    await expect(
      page.getByRole("img", { name: "Bakong KHQR payment code" })
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText("Waiting for payment… keep this screen open.")
    ).toBeVisible()
    await expect(page.getByText("Expires in")).toBeVisible()

    // ── Recover the reference: read the cart id from the (HttpOnly) cookie and
    // re-call /start — BACKEND-03 idempotently reuses the session the UI
    // started, so this returns the SAME reference (the established proof trick).
    const cartCookie = (await page.context().cookies()).find(
      (c) => c.name === "_medusa_cart_id"
    )
    expect(cartCookie?.value, "no _medusa_cart_id cookie").toBeTruthy()
    const cartId = decodeURIComponent(cartCookie!.value)

    const headers = publishableKeyHeaders()
    const startRes = await page.request.post(
      `${BACKEND_URL}/store/payments/khqr/start`,
      { headers, data: { cart_id: cartId, currency: "USD" } }
    )
    expect(startRes.status()).toBe(200)
    const start = (await startRes.json()) as KhqrStartResponse
    expect(start.reference).toMatch(REFERENCE_PATTERN)
    expectSeamActive(start.deeplink)

    // ── Before pay: server-verified status is pending.
    const pendingRes = await page.request.get(
      `${BACKEND_URL}/store/payments/khqr/status?reference=${start.reference}`,
      { headers }
    )
    expect(pendingRes.status()).toBe(200)
    expect(((await pendingRes.json()) as { status: string }).status).toBe(
      "pending"
    )

    // ── SIMULATE PAY: the mock proxy now reports the md5 as a found
    // transaction, exactly as Bakong would after the customer pays.
    paidReferences.add(start.reference)

    // ── The UI's own 3s poll picks it up; the backend verifies via the mock,
    // completes the cart (provider re-verify → captured), and the screen
    // redirects to the paid confirmation.
    await page.waitForURL(/\/order\/[^/?]+$/, { timeout: 60_000 })
    await expect(
      page.getByRole("heading", { name: "Payment confirmed" })
    ).toBeVisible()
    const orderId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").pop()!
    )
    expect(orderId).toMatch(/^order_[A-Za-z0-9]+$/)

    // ── status is now paid for that same reference (idempotent short-circuit)
    // and hands out the order id + invoice token.
    const paidRes = await page.request.get(
      `${BACKEND_URL}/store/payments/khqr/status?reference=${start.reference}`,
      { headers }
    )
    expect(paidRes.status()).toBe(200)
    const paid = (await paidRes.json()) as {
      status: string
      order_id?: string
      invoice_token?: string
    }
    expect(paid.status).toBe("paid")
    expect(paid.order_id).toBe(orderId)
    expect(paid.invoice_token).toBeTruthy()

    // The token-gated invoice answers 200 → the order really exists
    // server-side (wrong token → 403, missing order → 404; BACKEND-06).
    const invoiceRes = await page.request.get(
      `/store/orders/${encodeURIComponent(
        orderId
      )}/invoice?token=${encodeURIComponent(paid.invoice_token!)}`
    )
    expect(invoiceRes.status()).toBe(200)

    // ── Backend truth: order `paid` + exactly one stock_movement(out).
    // (No public API exposes these — the dev helper prints them from the DB.)
    // execSync needs a shell for `npx` on Windows (spawning .cmd shell-less
    // throws EINVAL on Node ≥20.12); injection is prevented by the hard
    // character-class guard below — the interpolated value is [A-Za-z0-9_]
    // only, no shell metacharacters possible.
    if (!/^order_[A-Za-z0-9]+$/.test(orderId)) {
      throw new Error("unsafe order id — refusing to shell out")
    }
    const verifyOut = execSync(
      `npx medusa exec ./src/scripts/dev-verify-khqr-order.ts ${orderId}`,
      {
        cwd: BACKEND_DIR,
        encoding: "utf8",
        timeout: 240_000,
        maxBuffer: 10 * 1024 * 1024,
      }
    )
    const marker = verifyOut.match(/KHQR_VERIFY_RESULT (\{.*\})/)
    expect(
      marker,
      "no KHQR_VERIFY_RESULT line in medusa exec output"
    ).toBeTruthy()
    const verified = JSON.parse(marker![1]) as {
      order: {
        id: string
        status: string
        payment_collections?: Array<{
          status?: string | null
          payments?: Array<{ id: string; captured_at?: string | null }>
        }>
      } | null
      movements: Array<{
        variant_id: string
        type: string
        quantity: number
        reason: string | null
        order_id: string | null
        created_by: string | null
      }>
    }

    // Order `paid`: the payment on the order's payment collection carries a
    // `captured_at` stamp — written only when the payment is captured (the
    // provider's authorizePayment returned "captured" after its own mock
    // verify). The computed `payment_status` field is an HTTP-layer
    // convenience and isn't resolvable from raw query.graph.
    expect(verified.order?.id).toBe(orderId)
    const payments = (verified.order?.payment_collections ?? []).flatMap(
      (pc) => pc.payments ?? []
    )
    expect(payments.length).toBeGreaterThan(0)
    for (const payment of payments) {
      expect(payment.captured_at).toBeTruthy()
    }

    // One `out` ledger row for the single-line order, stamped by the system.
    const outs = verified.movements.filter((m) => m.type === "out")
    expect(outs).toHaveLength(1)
    expect(outs[0].order_id).toBe(orderId)
    expect(Number(outs[0].quantity)).toBe(1)
    expect(outs[0].created_by).toBe("system")
    expect(outs[0].reason).toBe("KHQR payment")
    expect(outs[0].variant_id).toBeTruthy()
  })
})
