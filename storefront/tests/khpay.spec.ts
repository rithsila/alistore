import { execSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * KHPAY-05 — KHPAY end-to-end (local mock gateway).
 *
 * KHPAY replaced direct ABA PayWay as the active KHQR provider (ImplementPlan
 * Phase 7 — ABA declined the direct merchant application pending a business
 * license): the storefront's "Pay with KHQR" flow now drives
 * `/store/payments/khpay/*` (KHPAY's Bakong rail — money settles to our own
 * Bakong account). This spec owns the full UI journey (formerly
 * payway.spec.ts's); chain under test: start → simulate pay → status `paid` →
 * order captured → one `stock_movement(out)`.
 *
 * ── How "simulate pay" works ─────────────────────────────────────────────────
 * Payment verification is server-side only (security.md): the status route and
 * the provider's `authorizePayment` both confirm via KHPAY's `POST
 * /bakong/check`. This spec hosts a MOCK KHPAY gateway on
 * `127.0.0.1:${MOCK_GATEWAY_PORT}` that VERIFIES THE BEARER KEY of every
 * request — so the backend's auth header is proven against an independent
 * check, and a "paid" flip exercises the REAL verify → authorize →
 * completeCart → stock-out code unmodified. The SSRF guard normally blocks
 * loopback gateways; the dev-only escape in `khpay-payment/lib/client.ts`
 * (gated on NODE_ENV ≠ production AND `KHPAY_DEV_ALLOW_LOOPBACK=1`) lets the
 * dev backend reach the mock.
 *
 * Prerequisites (see playwright.config.ts for the dev-stack basics):
 *  - backend :9000 + storefront :8000 running, TEST-01 fixtures applied, and
 *    the Cambodia shipping option seeded (backend/src/scripts/seed-shipping.ts);
 *  - backend/.env must carry the dev-mock KHPAY block
 *    (KHPAY_BASE_URL=http://127.0.0.1:4285/api/v1,
 *    KHPAY_API_KEY=mock-khpay-key-not-a-secret, KHPAY_DEV_ALLOW_LOOPBACK=1)
 *    and the backend must have been (re)started after setting it;
 *  - while this env block is set, /store/payments/khpay/* 502s whenever the
 *    mock is NOT listening — i.e. outside runs of this spec.
 *
 * Serial on purpose: the mock binds a fixed port and the tests share its
 * transaction state, so they must run in a single worker, in order.
 *
 * Rate limits (security.md): `POST /khpay/start` allows 5/min/IP. A full run
 * makes a handful of start calls spread across the journey time; avoid
 * re-running the spec within a minute of a previous run.
 *
 * Expiry path note: the payment window is 20 minutes (KHPAY_EXPIRES_MINUTES,
 * pinned to the reservation TTL), so the expired-QR branch is not exercised
 * live here — it is the same template TEST-04 proved for Bakong/PayWay, and
 * the expire-reservations job covers the abandoned-cart case.
 *
 * Variant choice: sweatpants size S — shared with payway.spec.ts (the two
 * specs are not run together; both flows reuse the same stock pool), while
 * TEST-03 (cod.spec.ts) owns M and L for its stock-count assertions.
 */

test.describe.configure({ mode: "serial" })

const PDP_PATH = "/product/sweatpants"
const KHPAY_SIZE = "S"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

/** Must match the KHPAY dev-mock block in backend/.env. */
const MOCK_GATEWAY_PORT = 4285
const MOCK_API_KEY = "mock-khpay-key-not-a-secret"

/** KHPAY Bakong transaction id — `bk_` + hex (KHPAY-03 contract). */
const REFERENCE_PATTERN = /^bk_[A-Za-z0-9]{6,64}$/

// ── Mock KHPAY gateway ────────────────────────────────────────────────────────

interface MockTransaction {
  status: "pending" | "paid" | "expired"
  amount: number
  currency: string
  md5: string
}

/** Mock gateway state: transaction_id → transaction. */
const mockTransactions = new Map<string, MockTransaction>()

/** Flip a transaction to paid — "the customer paid in their banking app". */
function payTransaction(transactionId: string): void {
  const tx = mockTransactions.get(transactionId)
  if (!tx) throw new Error(`mock: unknown transaction_id`)
  tx.status = "paid"
}

let mockGateway: Server | undefined

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    req.on("data", (c: Uint8Array) => chunks.push(c))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

/**
 * Mock of the two KHPAY endpoints the backend calls, with STRICT bearer-key
 * verification (the real gateway's INVALID_API_KEY error) — a wrong/missing
 * Authorization header fails loudly here instead of only at UAT.
 */
function startMockKhpay(): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0]
      const respond = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" })
        res.end(JSON.stringify(body))
      }
      try {
        const raw = await readRawBody(req)

        // Strict auth on every endpoint — exactly one valid bearer key.
        if (req.headers.authorization !== `Bearer ${MOCK_API_KEY}`) {
          return respond(401, {
            success: false,
            error: "Invalid API key",
            code: "INVALID_API_KEY",
          })
        }

        const body = JSON.parse(raw.toString("utf8") || "{}") as Record<
          string,
          unknown
        >

        if (req.method === "POST" && path.endsWith("/bakong/generate")) {
          const amount = body.amount
          if (typeof amount !== "number" || !(amount > 0)) {
            return respond(422, {
              success: false,
              error: "Invalid amount",
              code: "INVALID_AMOUNT",
            })
          }
          const currency = body.currency
          if (currency !== "USD" && currency !== "KHR") {
            return respond(422, {
              success: false,
              error: "Currency must be USD",
              code: "CURRENCY_MUST_BE_USD",
            })
          }
          const transactionId = `bk_${randomBytes(6).toString("hex")}`
          const md5 = createHash("md5").update(transactionId).digest("hex")
          mockTransactions.set(transactionId, {
            status: "pending",
            amount,
            currency,
            md5,
          })
          return respond(201, {
            success: true,
            data: {
              transaction_id: transactionId,
              type: body.type ?? "individual",
              qr: `00020101021229370016alistore@mockMOCK${transactionId}`,
              md5,
              amount,
              currency,
              static: false,
              status: "pending",
              expires_at: "2099-01-01 00:00:00",
              payment_url: `http://127.0.0.1:${MOCK_GATEWAY_PORT}/pay/${transactionId}`,
              download_qr: `http://127.0.0.1:${MOCK_GATEWAY_PORT}/api/v1/qr/${transactionId}`,
            },
          })
        }

        if (req.method === "POST" && path.endsWith("/bakong/check")) {
          const byId =
            typeof body.transaction_id === "string"
              ? mockTransactions.get(body.transaction_id)
              : undefined
          const byMd5 =
            !byId && typeof body.md5 === "string"
              ? Array.from(mockTransactions.values()).find(
                  (t) => t.md5 === body.md5
                )
              : undefined
          const tx = byId ?? byMd5
          if (!tx) {
            return respond(404, {
              success: false,
              error: "Transaction not found",
              code: "TRANSACTION_NOT_FOUND",
            })
          }
          return respond(200, {
            success: true,
            data: {
              paid: tx.status === "paid",
              status: tx.status,
            },
          })
        }

        respond(404, { success: false, error: "unknown_mock_path" })
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
              `Mock KHPAY port ${MOCK_GATEWAY_PORT} is already in use — ` +
                "is another khpay.spec run holding it?"
            )
          : err
      )
    })
    server.listen(MOCK_GATEWAY_PORT, "127.0.0.1", () => resolve(server))
  })
}

test.beforeAll(async () => {
  mockGateway = await startMockKhpay()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!mockGateway) return resolve()
    mockGateway.close(() => resolve())
  })
})

// ── Shared helpers (payway.spec.ts / cod.spec.ts precedents) ─────────────────

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

/** KHPAY-02 `/start` response shape (same contract as the khqr/payway routes). */
interface KhpayStartResponse {
  qr: string
  deeplink: string | null
  reference: string
  expires_at: string | null
}

type RequestLike = {
  get: (url: string, opts?: object) => Promise<any>
  post: (url: string, opts?: object) => Promise<any>
}

/** Cambodia region + sweatpants variant + fresh cart with one line item. */
async function createCartWithSweatpants(
  request: RequestLike,
  headers: Record<string, string>
): Promise<string> {
  const regionsRes = await request.get(
    `${BACKEND_URL}/store/regions?fields=*countries`,
    { headers }
  )
  expect(regionsRes.ok()).toBeTruthy()
  const { regions } = (await regionsRes.json()) as {
    regions: Array<{ id: string; countries?: Array<{ iso_2: string }> }>
  }
  // Cambodia region — never regions[0] (the seed's first region is EUR).
  const region = regions.find((r) =>
    (r.countries ?? []).some((c) => c.iso_2 === "kh")
  )
  expect(region, "no region containing Cambodia (kh)").toBeTruthy()

  const productRes = await request.get(
    `${BACKEND_URL}/store/products?handle=sweatpants&region_id=${
      region!.id
    }&fields=*variants`,
    { headers }
  )
  expect(productRes.ok()).toBeTruthy()
  const { products } = (await productRes.json()) as {
    products: Array<{ variants: Array<{ id: string; title?: string | null }> }>
  }
  const variant = products[0]?.variants.find((v) => v.title === KHPAY_SIZE)
  expect(variant, `sweatpants variant "${KHPAY_SIZE}" not found`).toBeTruthy()

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
  return cartId
}

async function startKhpay(
  request: RequestLike,
  headers: Record<string, string>,
  cartId: string
): Promise<KhpayStartResponse> {
  const startRes = await request.post(
    `${BACKEND_URL}/store/payments/khpay/start`,
    { headers, data: { cart_id: cartId, currency: "USD" } }
  )
  expect(
    startRes.status(),
    "khpay/start failed — is the dev-mock KHPAY env block loaded and the mock listening?"
  ).toBe(200)
  return (await startRes.json()) as KhpayStartResponse
}

async function getKhpayStatus(
  request: RequestLike,
  headers: Record<string, string>,
  reference: string
): Promise<{ status: string; order_id?: string; invoice_token?: string }> {
  const res = await request.get(
    `${BACKEND_URL}/store/payments/khpay/status?reference=${reference}`,
    { headers }
  )
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    status: string
    order_id?: string
    invoice_token?: string
  }
}

// ── 1. /start contract + strict-auth acceptance ──────────────────────────────

test.describe("KHPAY start contract (KHPAY-02)", () => {
  test("returns QR + bk_ reference + expiry; bearer accepted by strict mock; idempotent reuse", async ({
    request,
  }) => {
    const headers = publishableKeyHeaders()
    const cartId = await createCartWithSweatpants(request, headers)

    const start = await startKhpay(request, headers, cartId)

    // Contract: EMV QR from KHPAY, bk_ reference, no deeplink on this rail.
    expect(start.qr).toContain("alistore@mockMOCK")
    expect(start.reference).toMatch(REFERENCE_PATTERN)
    expect(start.deeplink).toBeNull()

    // The strict mock verified the bearer key — reaching its transaction
    // store proves the backend authenticated correctly.
    expect(mockTransactions.has(start.reference)).toBeTruthy()
    expect(mockTransactions.get(start.reference)!.status).toBe("pending")

    // Expiry: ISO timestamp within the payment window (default 20 min) — OUR
    // window, not the mock's far-future one (the provider mints its own).
    expect(start.expires_at).toBeTruthy()
    const msLeft = Date.parse(start.expires_at!) - Date.now()
    expect(msLeft).toBeGreaterThan(60_000)
    expect(msLeft).toBeLessThanOrEqual(30 * 60_000)

    // Status before any payment: pending (never fabricated paid).
    expect(
      (await getKhpayStatus(request, headers, start.reference)).status
    ).toBe("pending")

    // Idempotency: a second /start reuses the session — same reference, and
    // no second KHPAY transaction was created.
    const txCount = mockTransactions.size
    const again = await startKhpay(request, headers, cartId)
    expect(again.reference).toBe(start.reference)
    expect(mockTransactions.size).toBe(txCount)
  })

  test("mock rejects a wrong bearer key (strictness proof)", async ({
    request,
  }) => {
    // Direct POST to the mock with the WRONG key — the mock must reject it,
    // which is what makes the previous test's pass meaningful.
    const res = await request.post(
      `http://127.0.0.1:${MOCK_GATEWAY_PORT}/api/v1/bakong/generate`,
      {
        headers: {
          authorization: "Bearer wrong-key",
          "content-type": "application/json",
        },
        data: { amount: 1, currency: "USD" },
      }
    )
    expect(res.status()).toBe(401)
    const body = (await res.json()) as { success: boolean; code: string }
    expect(body.success).toBe(false)
    expect(body.code).toBe("INVALID_API_KEY")
  })
})

// ── 2. Full chain through the real storefront UI ─────────────────────────────

test.describe("KHPAY full chain (KHPAY-05)", () => {
  test("simulated payment: status paid → order captured → one stock_movement(out)", async ({
    page,
  }) => {
    // UI journey + cart completion + a `medusa exec` boot — generous budget.
    test.setTimeout(420_000)

    // ── Add to bag (PDP, size S).
    await page.goto(PDP_PATH, { waitUntil: "domcontentloaded" })
    const sizeGroup = page.getByRole("group", { name: "Size" })
    await sizeGroup
      .getByRole("button", { name: KHPAY_SIZE, exact: true })
      .click()
    await page.getByRole("button", { name: "Add to bag" }).click()
    await expect(page.getByText("Added to bag.")).toBeVisible()

    // ── Checkout: delivery details + KHQR (the default selection).
    await page.goto("/checkout", { waitUntil: "domcontentloaded" })
    // Hydration gate (cod.spec.ts): the nav bag count only renders
    // client-side, so it proves the tree is interactive.
    await expect(page.getByRole("link", { name: "Bag, 1 item" })).toBeVisible()
    await page.locator("#delivery-full-name").fill("Test Khpay Chain")
    await page.locator("#delivery-phone").fill(randomPhone())
    await page.locator("#delivery-address").fill("St 07, Phnom Penh")
    await page.getByText("KHQR", { exact: true }).click()
    const placeOrder = page.getByRole("button", { name: "Place order" })
    await expect(placeOrder).toBeEnabled()
    await placeOrder.click()
    await page.waitForURL(/\/checkout\/khqr/)

    // ── Pay screen: live QR + polling state.
    await expect(
      page.getByRole("img", { name: "KHQR payment code" })
    ).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText("Waiting for payment… keep this screen open.")
    ).toBeVisible()
    await expect(page.getByText("Expires in")).toBeVisible()

    // ── Recover the reference: read the cart id from the (HttpOnly) cookie
    // and re-call /start — KHPAY-02 idempotently reuses the session the UI
    // started, so this returns the SAME reference (the established trick).
    const cartCookie = (await page.context().cookies()).find(
      (c) => c.name === "_medusa_cart_id"
    )
    expect(cartCookie?.value, "no _medusa_cart_id cookie").toBeTruthy()
    const cartId = decodeURIComponent(cartCookie!.value)

    const headers = publishableKeyHeaders()
    const start = await startKhpay(page.request as RequestLike, headers, cartId)
    expect(start.reference).toMatch(REFERENCE_PATTERN)

    // ── Before pay: server-verified status is pending.
    expect(
      (
        await getKhpayStatus(
          page.request as RequestLike,
          headers,
          start.reference
        )
      ).status
    ).toBe("pending")

    // ── SIMULATE PAY: the mock now reports paid, exactly as KHPAY would
    // after the customer pays in their banking app.
    payTransaction(start.reference)

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
    const paid = await getKhpayStatus(
      page.request as RequestLike,
      headers,
      start.reference
    )
    expect(paid.status).toBe("paid")
    expect(paid.order_id).toBe(orderId)
    expect(paid.invoice_token).toBeTruthy()

    // The token-gated invoice answers 200 → the order really exists.
    const invoiceRes = await page.request.get(
      `/store/orders/${encodeURIComponent(
        orderId
      )}/invoice?token=${encodeURIComponent(paid.invoice_token!)}`
    )
    expect(invoiceRes.status()).toBe(200)

    // ── Backend truth: payment captured + exactly one stock_movement(out).
    // execSync needs a shell for `npx` on Windows; injection is prevented by
    // the hard character-class guard below.
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
        payment_collections?: Array<{
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

    expect(verified.order?.id).toBe(orderId)
    const payments = (verified.order?.payment_collections ?? []).flatMap(
      (pc) => pc.payments ?? []
    )
    expect(payments.length).toBeGreaterThan(0)
    for (const payment of payments) {
      expect(payment.captured_at).toBeTruthy()
    }

    const outs = verified.movements.filter((m) => m.type === "out")
    expect(outs).toHaveLength(1)
    expect(outs[0].order_id).toBe(orderId)
    expect(Number(outs[0].quantity)).toBe(1)
    expect(outs[0].created_by).toBe("system")
    expect(outs[0].reason).toBe("KHQR payment (KHPAY)")
  })
})
