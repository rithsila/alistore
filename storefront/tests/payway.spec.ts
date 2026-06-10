import { execSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { join } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * PAYWAY-07 — ABA PayWay end-to-end (sandbox).
 *
 * PayWay replaced Bakong as the active KHQR provider (ImplementPlan Phase 6):
 * the storefront's "Pay with KHQR" flow now drives `/store/payments/payway/*`.
 * This spec owns the full UI journey (formerly TEST-04's, see khqr.spec.ts);
 * chain under test: start → simulate pay → status `paid` → order captured →
 * one `stock_movement(out)` — plus the pushback (server callback) path and the
 * forged-pushback rejection.
 *
 * ── How "simulate pay" works ─────────────────────────────────────────────────
 * Payment verification is server-side only (security.md): the status route,
 * the pushback route, and the provider's `authorizePayment` all confirm via
 * PayWay's check-transaction-2. This spec hosts a MOCK PayWay gateway on
 * `127.0.0.1:${MOCK_GATEWAY_PORT}` that VERIFIES THE HMAC-SHA512 HASH of every
 * request with the same canonical field order as real PayWay — so the
 * backend's hash implementation is proven against an independent
 * implementation, and a "paid" flip exercises the REAL verify → authorize →
 * completeCart → stock-out code unmodified. The SSRF guard normally blocks
 * loopback gateways; the dev-only escape in `aba-payway/lib/client.ts` (gated
 * on NODE_ENV ≠ production AND `PAYWAY_DEV_ALLOW_LOOPBACK=1`) lets the dev
 * backend reach the mock.
 *
 * Prerequisites (see playwright.config.ts for the dev-stack basics):
 *  - backend :9000 + storefront :8000 running, TEST-01 fixtures applied, and
 *    the Cambodia shipping option seeded (backend/src/scripts/seed-shipping.ts);
 *  - backend/.env must carry the dev-mock PayWay block
 *    (PAYWAY_BASE_URL=http://127.0.0.1:4284, PAYWAY_MERCHANT_ID=ec_sandbox_demo,
 *    PAYWAY_API_KEY=mock-api-key-not-a-secret, PAYWAY_DEV_ALLOW_LOOPBACK=1) and
 *    the backend must have been (re)started after setting it;
 *  - while this env block is set, /store/payments/payway/* 502s whenever the
 *    mock is NOT listening — i.e. outside runs of this spec.
 *
 * Serial on purpose: the mock binds a fixed port and the tests share its
 * transaction state, so they must run in a single worker, in order.
 *
 * Rate limits (security.md): `POST /payway/start` allows 5/min/IP. A full run
 * makes 6 start calls spread across several minutes of journey time; avoid
 * re-running the spec within a minute of a previous run.
 *
 * Expiry path note: the payment window is 20 minutes (PAYWAY_EXPIRES_MINUTES,
 * pinned to the reservation TTL), so the expired-QR branch is not exercised
 * live here — it is the same template the khqr status route proved in
 * TEST-04, and the expire-reservations job covers the abandoned-cart case.
 *
 * Variant choice: sweatpants size S — TEST-03 (cod.spec.ts) owns M and L for
 * its stock-count assertions, and the TEST-01 fixtures zero XL.
 */

test.describe.configure({ mode: "serial" })

const PDP_PATH = "/product/sweatpants"
const PAYWAY_SIZE = "S"

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

/** Must match the PayWay dev-mock block in backend/.env. */
const MOCK_GATEWAY_PORT = 4284
const MOCK_MERCHANT_ID = "ec_sandbox_demo"
const MOCK_API_KEY = "mock-api-key-not-a-secret"

/** Minted PayWay tran_id — 20 lowercase hex chars (PAYWAY-03B contract). */
const REFERENCE_PATTERN = /^[a-f0-9]{20}$/

// ── Mock ABA PayWay gateway ───────────────────────────────────────────────────

/**
 * Purchase hash field order (24 fields; `view_type`/`payment_gate` excluded) —
 * an INDEPENDENT implementation of the spec in
 * docs/aba-payway-integration-guide.md §3.2, deliberately not imported from
 * the backend so a backend hash bug cannot self-validate.
 */
const PURCHASE_HASH_ORDER = [
  "req_time",
  "merchant_id",
  "tran_id",
  "amount",
  "items",
  "shipping",
  "firstname",
  "lastname",
  "email",
  "phone",
  "type",
  "payment_option",
  "return_url",
  "cancel_url",
  "continue_success_url",
  "return_deeplink",
  "currency",
  "custom_fields",
  "return_params",
  "payout",
  "lifetime",
  "additional_params",
  "google_pay_token",
  "skip_success_page",
]

function hmacBase64(data: string, apiKey: string): string {
  return createHmac("sha512", apiKey).update(data).digest("base64")
}

function purchaseHash(
  fields: Record<string, string | undefined>,
  apiKey: string
): string {
  return hmacBase64(
    PURCHASE_HASH_ORDER.map((k) => fields[k] ?? "").join(""),
    apiKey
  )
}

function checkHash(
  fields: { req_time?: string; merchant_id?: string; tran_id?: string },
  apiKey: string
): string {
  return hmacBase64(
    `${fields.req_time ?? ""}${fields.merchant_id ?? ""}${
      fields.tran_id ?? ""
    }`,
    apiKey
  )
}

interface MockTransaction {
  status: "PENDING" | "APPROVED" | "DECLINED"
  amount: string
  currency: string
  apv: string | null
}

/** Mock gateway state: tran_id → transaction. */
const mockTransactions = new Map<string, MockTransaction>()

/** Flip a transaction to APPROVED — "the customer paid". */
function payTransaction(tranId: string): void {
  const tx = mockTransactions.get(tranId)
  if (!tx) throw new Error(`mock: unknown tran_id`)
  tx.status = "APPROVED"
  tx.apv = `APV${tranId.slice(0, 6)}`
}

/** Revert to PENDING (used to prove pushback — not a real PayWay behavior). */
function unpayTransaction(tranId: string): void {
  const tx = mockTransactions.get(tranId)
  if (!tx) throw new Error(`mock: unknown tran_id`)
  tx.status = "PENDING"
  tx.apv = null
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

/** Minimal multipart/form-data parser — text fields only (all PayWay uses). */
function parseMultipart(
  buffer: Buffer,
  contentType: string
): Record<string, string> {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)
  if (!m) return {}
  const boundary = `--${m[1] || m[2]}`
  const fields: Record<string, string> = {}
  for (const part of buffer.toString("utf8").split(boundary)) {
    const headerEnd = part.indexOf("\r\n\r\n")
    if (headerEnd === -1) continue
    const name = /name="([^"]+)"/.exec(part.slice(0, headerEnd))?.[1]
    if (!name) continue
    fields[name] = part
      .slice(headerEnd + 4)
      .replace(/\r\n--?$/, "")
      .replace(/\r\n$/, "")
  }
  return fields
}

/**
 * Mock of the two PayWay endpoints the backend calls, with STRICT hash
 * verification (the real gateway's `1`/`5` wrong-hash error codes) — a wrong
 * backend hash implementation fails loudly here instead of only at UAT.
 */
function startMockPayWay(): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? "").split("?")[0]
      const respond = (body: unknown): void => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify(body))
      }
      try {
        const raw = await readRawBody(req)
        const contentType = req.headers["content-type"] ?? ""

        if (req.method === "POST" && path.endsWith("/payments/purchase")) {
          const fields = contentType.includes("multipart/form-data")
            ? parseMultipart(raw, contentType)
            : (JSON.parse(raw.toString("utf8") || "{}") as Record<
                string,
                string
              >)

          if (fields.merchant_id !== MOCK_MERCHANT_ID) {
            return respond({ status: { code: 8, message: "Wrong merchant" } })
          }
          if (fields.hash !== purchaseHash(fields, MOCK_API_KEY)) {
            return respond({ status: { code: 1, message: "Wrong hash" } })
          }
          if (!fields.tran_id || !fields.amount) {
            return respond({ status: { code: 2, message: "Missing param" } })
          }
          if (mockTransactions.has(fields.tran_id)) {
            return respond({
              status: { code: 4, message: "Duplicate tran_id" },
            })
          }
          mockTransactions.set(fields.tran_id, {
            status: "PENDING",
            amount: fields.amount,
            currency: fields.currency || "USD",
            apv: null,
          })
          return respond({
            status: {
              code: "00",
              message: "Success!",
              tran_id: fields.tran_id,
            },
            qr_string: `00020101021230510016abaakhppMOCK${fields.tran_id}`,
            abapay_deeplink: `abamobilebank://ababank.com?type=payway&qrcode=${fields.tran_id}`,
            checkout_qr_url: `http://127.0.0.1:${MOCK_GATEWAY_PORT}/mock-checkout/${fields.tran_id}`,
          })
        }

        if (
          req.method === "POST" &&
          path.endsWith("/payments/check-transaction-2")
        ) {
          const body = JSON.parse(raw.toString("utf8") || "{}") as Record<
            string,
            string
          >
          if (body.merchant_id !== MOCK_MERCHANT_ID) {
            return respond({ status: { code: 8 }, data: null })
          }
          if (body.hash !== checkHash(body, MOCK_API_KEY)) {
            return respond({
              status: { code: 5, message: "Invalid hash" },
              data: null,
            })
          }
          const tx = body.tran_id
            ? mockTransactions.get(body.tran_id)
            : undefined
          if (!tx) {
            return respond({
              status: { code: 6, message: "Transaction not found" },
              data: null,
            })
          }
          const codes = { APPROVED: 0, PENDING: 2, DECLINED: 3 } as const
          return respond({
            status: { code: "00", message: "Success!", tran_id: body.tran_id },
            data: {
              payment_status: tx.status,
              payment_status_code: codes[tx.status],
              total_amount: Number(tx.amount),
              payment_amount: tx.status === "APPROVED" ? Number(tx.amount) : 0,
              payment_currency: tx.status === "PENDING" ? "" : tx.currency,
              apv: tx.apv ?? "",
            },
          })
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
              `Mock PayWay port ${MOCK_GATEWAY_PORT} is already in use — ` +
                "is another payway.spec run (or the sandbox/aba-payway mock) holding it?"
            )
          : err
      )
    })
    server.listen(MOCK_GATEWAY_PORT, "127.0.0.1", () => resolve(server))
  })
}

test.beforeAll(async () => {
  mockGateway = await startMockPayWay()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!mockGateway) return resolve()
    mockGateway.close(() => resolve())
  })
})

// ── Shared helpers (khqr.spec.ts / cod.spec.ts precedents) ────────────────────

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

/** PAYWAY-03 `/start` response shape (same contract as the khqr route). */
interface PaywayStartResponse {
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
  const variant = products[0]?.variants.find((v) => v.title === PAYWAY_SIZE)
  expect(variant, `sweatpants variant "${PAYWAY_SIZE}" not found`).toBeTruthy()

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

/**
 * Make the cart completable (email + Cambodia shipping address + shipping
 * method) — completeCartWorkflow requires all three; the UI journey gets this
 * from `prepareCartForCheckout`, API-level tests do it here.
 */
async function prepareCartViaApi(
  request: RequestLike,
  headers: Record<string, string>,
  cartId: string
): Promise<void> {
  const updateRes = await request.post(`${BACKEND_URL}/store/carts/${cartId}`, {
    headers,
    data: {
      email: "payway-e2e@example.com",
      shipping_address: {
        first_name: "Payway",
        last_name: "Pushback",
        address_1: "St 07, Phnom Penh",
        city: "Phnom Penh",
        country_code: "kh",
        phone: randomPhone(),
      },
    },
  })
  expect(updateRes.ok()).toBeTruthy()

  const optionsRes = await request.get(
    `${BACKEND_URL}/store/shipping-options?cart_id=${cartId}`,
    { headers }
  )
  expect(optionsRes.ok()).toBeTruthy()
  const { shipping_options } = (await optionsRes.json()) as {
    shipping_options: Array<{ id: string }>
  }
  expect(
    shipping_options?.length,
    "no shipping option (run backend/src/scripts/seed-shipping.ts)"
  ).toBeTruthy()

  const methodRes = await request.post(
    `${BACKEND_URL}/store/carts/${cartId}/shipping-methods`,
    { headers, data: { option_id: shipping_options[0].id } }
  )
  expect(methodRes.ok()).toBeTruthy()
}

async function startPayway(
  request: RequestLike,
  headers: Record<string, string>,
  cartId: string
): Promise<PaywayStartResponse> {
  const startRes = await request.post(
    `${BACKEND_URL}/store/payments/payway/start`,
    { headers, data: { cart_id: cartId, currency: "USD" } }
  )
  expect(
    startRes.status(),
    "payway/start failed — is the dev-mock PayWay env block loaded and the mock listening?"
  ).toBe(200)
  return (await startRes.json()) as PaywayStartResponse
}

async function getPaywayStatus(
  request: RequestLike,
  headers: Record<string, string>,
  reference: string
): Promise<{ status: string; order_id?: string; invoice_token?: string }> {
  const res = await request.get(
    `${BACKEND_URL}/store/payments/payway/status?reference=${reference}`,
    { headers }
  )
  expect(res.status()).toBe(200)
  return (await res.json()) as {
    status: string
    order_id?: string
    invoice_token?: string
  }
}

// ── 1. /start contract + strict-hash acceptance ──────────────────────────────

test.describe("PayWay start contract (PAYWAY-03)", () => {
  test("returns QR + 20-hex reference + expiry; hash accepted by strict mock; idempotent reuse", async ({
    request,
  }) => {
    const headers = publishableKeyHeaders()
    const cartId = await createCartWithSweatpants(request, headers)

    const start = await startPayway(request, headers, cartId)

    // Contract: QR from PayWay, minted 20-hex reference, ABA deeplink.
    expect(start.qr).toContain("abaakhppMOCK")
    expect(start.reference).toMatch(REFERENCE_PATTERN)
    expect(start.deeplink).toContain("abamobilebank://")

    // The strict mock verified the purchase HMAC — reaching its transaction
    // store proves the backend's 24-field hash implementation is correct.
    expect(mockTransactions.has(start.reference)).toBeTruthy()
    expect(mockTransactions.get(start.reference)!.status).toBe("PENDING")

    // Expiry: ISO timestamp within the payment window (default 20 min).
    expect(start.expires_at).toBeTruthy()
    const msLeft = Date.parse(start.expires_at!) - Date.now()
    expect(msLeft).toBeGreaterThan(60_000)
    expect(msLeft).toBeLessThanOrEqual(30 * 60_000)

    // Status before any payment: pending (never fabricated paid).
    expect(
      (await getPaywayStatus(request, headers, start.reference)).status
    ).toBe("pending")

    // Idempotency: a second /start reuses the session — same reference, and
    // no second PayWay purchase was created.
    const txCount = mockTransactions.size
    const again = await startPayway(request, headers, cartId)
    expect(again.reference).toBe(start.reference)
    expect(mockTransactions.size).toBe(txCount)
  })

  test("mock rejects a tampered purchase hash (strictness proof)", async ({
    request,
  }) => {
    // Direct POST to the mock with a hash made with the WRONG key — the mock
    // must reject it, which is what makes the previous test's pass meaningful.
    const fields: Record<string, string> = {
      req_time: "20260610120000",
      merchant_id: MOCK_MERCHANT_ID,
      tran_id: "feedfacefeedfacefeed",
      amount: "1.00",
      currency: "USD",
    }
    fields.hash = purchaseHash(fields, "wrong-key")
    const res = await request.post(
      `http://127.0.0.1:${MOCK_GATEWAY_PORT}/api/payment-gateway/v1/payments/purchase`,
      { multipart: fields }
    )
    const body = (await res.json()) as { status: { code: string | number } }
    expect(String(body.status.code)).toBe("1")
    expect(mockTransactions.has("feedfacefeedfacefeed")).toBeFalsy()
  })
})

// ── 2. Full chain through the real storefront UI ─────────────────────────────

test.describe("PayWay full chain (PAYWAY-07)", () => {
  test("simulated payment: status paid → order captured → one stock_movement(out)", async ({
    page,
  }) => {
    // UI journey + cart completion + a `medusa exec` boot — generous budget.
    test.setTimeout(420_000)

    // ── Add to bag (PDP, size S).
    await page.goto(PDP_PATH, { waitUntil: "domcontentloaded" })
    const sizeGroup = page.getByRole("group", { name: "Size" })
    await sizeGroup
      .getByRole("button", { name: PAYWAY_SIZE, exact: true })
      .click()
    await page.getByRole("button", { name: "Add to bag" }).click()
    await expect(page.getByText("Added to bag.")).toBeVisible()

    // ── Checkout: delivery details + KHQR (the default selection).
    await page.goto("/checkout", { waitUntil: "domcontentloaded" })
    // Hydration gate (cod.spec.ts): the nav bag count only renders
    // client-side, so it proves the tree is interactive.
    await expect(page.getByRole("link", { name: "Bag, 1 item" })).toBeVisible()
    await page.locator("#delivery-full-name").fill("Test Payway Chain")
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
    // and re-call /start — PAYWAY-03 idempotently reuses the session the UI
    // started, so this returns the SAME reference (the established trick).
    const cartCookie = (await page.context().cookies()).find(
      (c) => c.name === "_medusa_cart_id"
    )
    expect(cartCookie?.value, "no _medusa_cart_id cookie").toBeTruthy()
    const cartId = decodeURIComponent(cartCookie!.value)

    const headers = publishableKeyHeaders()
    const start = await startPayway(
      page.request as RequestLike,
      headers,
      cartId
    )
    expect(start.reference).toMatch(REFERENCE_PATTERN)

    // ── Before pay: server-verified status is pending.
    expect(
      (
        await getPaywayStatus(
          page.request as RequestLike,
          headers,
          start.reference
        )
      ).status
    ).toBe("pending")

    // ── SIMULATE PAY: the mock now reports APPROVED, exactly as PayWay would
    // after the customer pays in the ABA app.
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
    const paid = await getPaywayStatus(
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
    expect(outs[0].reason).toBe("KHQR payment (PayWay)")
  })
})

// ── 3. Pushback (server callback) path — PAYWAY-04 ───────────────────────────

test.describe("PayWay pushback (PAYWAY-04)", () => {
  test("verified pushback completes the order without any poll", async ({
    request,
  }) => {
    test.setTimeout(180_000)

    const headers = publishableKeyHeaders()
    const cartId = await createCartWithSweatpants(request, headers)
    await prepareCartViaApi(request, headers, cartId)
    const start = await startPayway(request, headers, cartId)

    // Customer pays in the ABA app; PayWay calls our pushback hook. The hook
    // must NOT trust the body — it re-verifies via the mock (APPROVED).
    payTransaction(start.reference)
    const pushRes = await request.post(`${BACKEND_URL}/hooks/payway/pushback`, {
      headers: { "content-type": "application/json" }, // no publishable key — ABA wouldn't send one
      data: { tran_id: start.reference, apv: "APVTEST", status: 0 },
    })
    expect(pushRes.status()).toBe(200)
    expect((await pushRes.json()) as object).toEqual({ received: true })

    // Prove the PUSHBACK created the order (not our status call below): set
    // the mock back to PENDING and wait out the 30s verify cache — if the
    // pushback hadn't completed the cart, status would now re-verify and see
    // PENDING. `paid` can therefore only come from the order_cart
    // short-circuit, i.e. an order that already exists.
    unpayTransaction(start.reference)
    await new Promise((r) => setTimeout(r, 31_000))

    const status = await getPaywayStatus(request, headers, start.reference)
    expect(status.status).toBe("paid")
    expect(status.order_id).toMatch(/^order_[A-Za-z0-9]+$/)
    expect(status.invoice_token).toBeTruthy()
  })

  test("forged pushback for an unpaid transaction does nothing", async ({
    request,
  }) => {
    const headers = publishableKeyHeaders()
    const cartId = await createCartWithSweatpants(request, headers)
    await prepareCartViaApi(request, headers, cartId)
    const start = await startPayway(request, headers, cartId)

    // Attacker posts a "paid" pushback — but the mock still says PENDING, so
    // the hook's mandatory re-verify refuses to finalize anything.
    const forged = await request.post(`${BACKEND_URL}/hooks/payway/pushback`, {
      headers: { "content-type": "application/json" },
      data: { tran_id: start.reference, apv: "FORGED", status: 0 },
    })
    expect(forged.status()).toBe(200)
    expect((await forged.json()) as object).toEqual({ received: true })

    // No order was created; the payment is still pending.
    const status = await getPaywayStatus(request, headers, start.reference)
    expect(status.status).toBe("pending")
    expect(status.order_id).toBeUndefined()

    // Malformed pushback shapes are rejected outright.
    const malformed = await request.post(
      `${BACKEND_URL}/hooks/payway/pushback`,
      {
        headers: { "content-type": "application/json" },
        data: { tran_id: "not-a-valid-id!" },
      }
    )
    expect(malformed.status()).toBe(400)
  })
})
