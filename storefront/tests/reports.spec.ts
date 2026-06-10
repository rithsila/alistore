import { execSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type APIRequestContext } from "@playwright/test"

/**
 * TEST-06 — Reports (sales + stock).
 *
 * Chain under test: seed known orders/levels → the admin reports reflect them.
 *
 *   1. Sales (BACKEND-08)  — place two COD orders with KNOWN totals
 *      (1× sweatshirt S = $15 + $1.50 delivery = $16.50; 2× sweatshirt L =
 *      $30 + $1.50 = $31.50), then assert `GET /admin/reports/sales?from=&to=`
 *      over the window spanning exactly those orders reports the matching
 *      order count, per-currency revenue, and best-seller quantities.
 *   2. Stock (BACKEND-08B) — seed a KNOWN low level (sweatshirt XL → adjust to
 *      3, restored afterwards) and assert `GET /admin/reports/stock` membership:
 *      at/below threshold appears in `low_stock[]`, above does not, boundary
 *      `<=` exact (in at threshold 3, out at 2). The fixture-zeroed sweatpants
 *      XL (TEST-01 fixtures) is the second known seeded level (0).
 *
 * ── Admin auth (TEST-05 pattern, user-approved 2026-06-06) ───────────────────
 * Dev has no admin MFA (SETUP-01C deferred), so the spec creates a THROWAWAY
 * admin per run (`npx medusa user`, random hex creds — never in code or env),
 * logs in via `POST /auth/user/emailpass`, and calls the admin endpoints with
 * the Bearer JWT. The created user is inert but stays in the dev DB.
 *
 * ── Parallel-suite safety ────────────────────────────────────────────────────
 * - Serial file: both tests share ONE throwaway admin (a single `npx medusa`
 *   CLI boot) — khqr.spec precedent.
 * - Variant ownership: sweatpants S/M/L belong to khqr/cod specs, shorts L to
 *   stock-in.spec, shorts/sweatshirt M are carted by cart.spec. This spec uses
 *   only sweatshirt S + L (orders) and sweatshirt XL (level seeding) — no
 *   other spec orders, counts, or mutates them.
 * - The sales window assertions are interference-proof: the expected set is
 *   enumerated independently via the core `GET /admin/orders` over the same
 *   window, so an order another spec places inside the (seconds-wide) window
 *   cannot flake the count/revenue equality — and in the normal quiet-window
 *   case that expected set is exactly the two seeded orders ($48.00, 2).
 *
 * Rate limits (security.md): `POST /store/orders/cod` allows 3/min/IP shared
 * with cod.spec's two placements (whose UI journey cannot retry a 429), so
 * this spec's two placements are spaced >60s apart — at most 1 of mine per
 * bucket, 2 + 1 = the limit — and additionally retry on 429 for back-to-back
 * manual runs. Admin endpoints allow 60/min/admin-session (far under). Avoid
 * more than one spec run per minute.
 *
 * Side effects per run (dev DB): one inert `test-admin-*` user, two pending
 * COD orders + their reservations (cod.spec precedent — never cleaned up),
 * and two `adjust` rows in the stock-movement ledger (level itself restored).
 *
 * Prerequisites (see playwright.config.ts): backend :9000 + storefront :8000
 * running, TEST-01 fixtures applied, Cambodia shipping option seeded
 * (backend/src/scripts/seed-shipping.ts).
 */

test.describe.configure({ mode: "serial" })

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

// ── Known catalog/shipping facts the expectations derive from ────────────────
// (TEST-01 fixtures: every USD base price is $15, "shorts" is the sale product
// so "sweatshirt" stays full-price; seed-shipping.ts: flat $1.50 delivery.)
const ORDER_PRODUCT_HANDLE = "sweatshirt"
const ORDER_A_SIZE = "S"
const ORDER_A_QTY = 1
const ORDER_A_TOTAL_USD = 16.5 // 1 × $15 + $1.50 delivery
const ORDER_B_SIZE = "L"
const ORDER_B_QTY = 2
const ORDER_B_TOTAL_USD = 31.5 // 2 × $15 + $1.50 delivery

const LOW_STOCK_PRODUCT_HANDLE = "sweatshirt"
const LOW_STOCK_SIZE = "XL"
/** The KNOWN level this spec seeds — below the default threshold of 5. */
const SEEDED_LOW_LEVEL = 3
/** Explicit threshold (= the BACKEND-01 default) so env overrides can't flake. */
const THRESHOLD = 5

/** Fixture-zeroed variant (dev-seed-catalog-fixtures.ts) — known level 0. */
const FIXTURE_ZERO_HANDLE = "sweatpants"
const FIXTURE_ZERO_SIZE = "XL"

// ── Timing ────────────────────────────────────────────────────────────────────
/** Pad the sales window so ms-truncated `created_at` bounds stay inclusive. */
const WINDOW_PAD_MS = 1_000
/** Let in-flight order commits land before reading report + enumeration. */
const SETTLE_MS = 1_500
/** COD 429 retry: the IP limit is a fixed 1-minute window (3/min). */
const COD_RETRY_DELAY_MS = 15_000
const COD_RETRY_BUDGET_MS = 180_000
/**
 * Space the two seeded placements >60s apart so they NEVER share a COD
 * rate-limit bucket: cod.spec contributes up to 2 placements to a bucket and
 * its UI journey cannot retry a 429, so this spec may add at most 1 per
 * bucket (2 + 1 = the 3/min/IP limit, verified live — an unspaced parallel
 * suite run 429'd cod.spec's checkout).
 */
const COD_BUCKET_SPACING_MS = 61_000

// ── Response shapes ──────────────────────────────────────────────────────────

/** BACKEND-08 response. */
interface SalesReport {
  from: string | null
  to: string | null
  orders: number
  revenue: Record<string, number>
  top_variants: Array<{ variant_id: string; title: string; quantity: number }>
}

/** BACKEND-08B row + response. */
interface StockRow {
  variant_id: string
  title: string
  sku: string | null
  quantity: number
}
interface StockReport {
  threshold: number
  levels: StockRow[]
  low_stock: StockRow[]
}

/** The slice of a core admin order this spec reads. */
interface AdminOrderView {
  id: string
  status: string
  created_at: string
  currency_code: string
  total: unknown
}

// ── Shared helpers (cod/khqr/stock-in spec precedents) ───────────────────────

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

/**
 * Random lowercase-hex token. [a-z0-9] only — safe to interpolate into the
 * `npx medusa user` shell command without quoting (stock-in.spec pattern).
 */
function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("hex")
}

/** Fresh valid Cambodian phone per call (`^0[1-9]\d{7,8}$`). */
function randomPhone(): string {
  const digits = Math.floor(Math.random() * 10_000_000)
    .toString()
    .padStart(7, "0")
  return `09${digits}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mirror BACKEND-08's per-currency cent rounding exactly. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Coerce an admin-API total (number | string) to a finite number, loudly. */
function toFiniteNumber(value: unknown, label: string): number {
  const num = typeof value === "string" ? Number(value) : (value as number)
  expect(Number.isFinite(num), `${label} is not a finite number`).toBe(true)
  return num
}

/** Cambodia region — never regions[0] (the seed's first region is EUR). */
async function khRegionId(
  request: APIRequestContext,
  headers: Record<string, string>
): Promise<string> {
  const res = await request.get(
    `${BACKEND_URL}/store/regions?fields=*countries`,
    { headers }
  )
  expect(res.ok()).toBeTruthy()
  const { regions } = (await res.json()) as {
    regions: Array<{ id: string; countries?: Array<{ iso_2: string }> }>
  }
  const region = regions.find((r) =>
    (r.countries ?? []).some((c) => c.iso_2 === "kh")
  )
  expect(region, "no region containing Cambodia (kh)").toBeTruthy()
  return region!.id
}

/** Resolve a variant id by product handle + size title via the store API. */
async function resolveVariantId(
  request: APIRequestContext,
  headers: Record<string, string>,
  regionId: string,
  handle: string,
  size: string
): Promise<string> {
  const res = await request.get(
    `${BACKEND_URL}/store/products?handle=${handle}&region_id=${regionId}&fields=*variants`,
    { headers }
  )
  expect(res.ok()).toBeTruthy()
  const { products } = (await res.json()) as {
    products: Array<{ variants: Array<{ id: string; title?: string | null }> }>
  }
  const variant = products[0]?.variants.find((v) => v.title === size)
  expect(variant, `${handle} variant "${size}" not found`).toBeTruthy()
  return variant!.id
}

// ── Throwaway admin (TEST-05 pattern) — shared by both serial tests ──────────

let adminHeaders: Record<string, string>

test.beforeAll(async ({ request }) => {
  // One `npx medusa` CLI boot — generous hook budget.
  test.setTimeout(300_000)

  const adminEmail = `test-admin-${randomToken(6)}@alistore.dev`
  const adminPassword = randomToken(24)
  // execSync needs a shell for `npx` on Windows (spawning the .cmd shim
  // shell-less throws EINVAL on Node ≥20.12 — khqr/stock-in spec precedent).
  // Injection is prevented by the hard character-class guard below: both
  // interpolated values are locally generated hex in a fixed safe shape — no
  // shell metacharacters possible, no user input involved.
  if (
    !/^test-admin-[a-f0-9]+@alistore\.dev$/.test(adminEmail) ||
    !/^[a-f0-9]{48}$/.test(adminPassword)
  ) {
    throw new Error("unsafe admin credentials — refusing to shell out")
  }
  execSync(`npx medusa user -e ${adminEmail} -p ${adminPassword}`, {
    cwd: BACKEND_DIR,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 10 * 1024 * 1024,
  })

  const loginRes = await request.post(`${BACKEND_URL}/auth/user/emailpass`, {
    headers: { "content-type": "application/json" },
    data: { email: adminEmail, password: adminPassword },
  })
  expect(loginRes.status(), "emailpass login for the throwaway admin").toBe(200)
  const { token } = (await loginRes.json()) as { token?: string }
  expect(token, "no JWT from /auth/user/emailpass").toBeTruthy()
  adminHeaders = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  }
})

// ── Sales-report helpers ──────────────────────────────────────────────────────

/**
 * Place a COD order through the real public path (cart prep mirrors
 * cod.spec's BACKEND-04 contract test), retrying on 429 — the 3/min/IP COD
 * window is shared with cod.spec when the suite runs in parallel.
 */
async function placeCodOrder(
  request: APIRequestContext,
  headers: Record<string, string>,
  regionId: string,
  variantId: string,
  quantity: number
): Promise<string> {
  const cartRes = await request.post(`${BACKEND_URL}/store/carts`, {
    headers,
    data: { region_id: regionId },
  })
  expect(cartRes.ok()).toBeTruthy()
  const cartId = ((await cartRes.json()) as { cart: { id: string } }).cart.id

  const lineRes = await request.post(
    `${BACKEND_URL}/store/carts/${cartId}/line-items`,
    { headers, data: { variant_id: variantId, quantity } }
  )
  expect(lineRes.ok()).toBeTruthy()

  const phone = randomPhone()
  const updateRes = await request.post(`${BACKEND_URL}/store/carts/${cartId}`, {
    headers,
    data: {
      email: `${phone}@guest.alistore.com`,
      shipping_address: {
        first_name: "Test Six Reports",
        phone,
        address_1: "St 06, Phnom Penh",
        country_code: "kh",
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
    shipping_options[0],
    "no shipping option — re-run backend/src/scripts/seed-shipping.ts"
  ).toBeTruthy()
  const methodRes = await request.post(
    `${BACKEND_URL}/store/carts/${cartId}/shipping-methods`,
    { headers, data: { option_id: shipping_options[0].id } }
  )
  expect(methodRes.ok()).toBeTruthy()

  const deadline = Date.now() + COD_RETRY_BUDGET_MS
  for (;;) {
    const codRes = await request.post(`${BACKEND_URL}/store/orders/cod`, {
      headers,
      data: {
        cart_id: cartId,
        phone,
        name: "Test Six Reports",
        address: "St 06, Phnom Penh",
      },
    })
    if (codRes.status() === 429 && Date.now() < deadline) {
      // Shared 3/min/IP window (likely cod.spec in parallel) — wait it out.
      await sleep(COD_RETRY_DELAY_MS)
      continue
    }
    expect(codRes.status(), "POST /store/orders/cod").toBe(200)
    const body = (await codRes.json()) as { order_id?: string }
    expect(body.order_id).toBeTruthy()
    return body.order_id!
  }
}

/**
 * The order fields this spec reads via the core admin API. Passed explicitly —
 * the default admin order response omits `currency_code` (verified live).
 */
const ADMIN_ORDER_FIELDS = "id,status,created_at,currency_code,total"

/** Fetch one order through the core admin API (independent of the report). */
async function fetchAdminOrder(
  request: APIRequestContext,
  orderId: string
): Promise<AdminOrderView> {
  const res = await request.get(
    `${BACKEND_URL}/admin/orders/${encodeURIComponent(
      orderId
    )}?fields=${ADMIN_ORDER_FIELDS}`,
    { headers: adminHeaders }
  )
  expect(res.status(), `GET /admin/orders/${orderId}`).toBe(200)
  return ((await res.json()) as { order: AdminOrderView }).order
}

/**
 * Independently enumerate the qualifying orders in [fromMs, toMs] via the
 * paged core admin list. Qualification mirrors BACKEND-08 ("captured OR
 * not-cancelled"): no spec cancels orders, so `status !== "canceled"` is the
 * report's rule exactly (the cancelled-but-captured edge cannot occur here).
 */
async function listQualifyingOrders(
  request: APIRequestContext,
  fromMs: number,
  toMs: number
): Promise<AdminOrderView[]> {
  const PAGE_SIZE = 100
  const MAX_PAGES = 50
  const qualifying: AdminOrderView[] = []
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new Error(
        `order sweep exceeded ${PAGE_SIZE * MAX_PAGES} orders — ` +
          "dev DB unexpectedly large for this enumeration"
      )
    }
    const res = await request.get(
      `${BACKEND_URL}/admin/orders?limit=${PAGE_SIZE}&offset=${
        page * PAGE_SIZE
      }&fields=${ADMIN_ORDER_FIELDS}`,
      { headers: adminHeaders }
    )
    expect(res.status(), "GET /admin/orders (enumeration)").toBe(200)
    const { orders, count } = (await res.json()) as {
      orders: AdminOrderView[]
      count: number
    }
    for (const order of orders) {
      const createdMs = Date.parse(String(order.created_at))
      expect(
        Number.isFinite(createdMs),
        `unparseable created_at on ${order.id}`
      ).toBe(true)
      if (
        createdMs >= fromMs &&
        createdMs <= toMs &&
        order.status !== "canceled"
      ) {
        qualifying.push(order)
      }
    }
    if (orders.length === 0 || (page + 1) * PAGE_SIZE >= count) {
      return qualifying
    }
  }
}

// ── Stock-report helpers ──────────────────────────────────────────────────────

async function fetchStockReport(
  request: APIRequestContext,
  threshold: number
): Promise<StockReport> {
  const res = await request.get(
    `${BACKEND_URL}/admin/reports/stock?low_threshold=${threshold}`,
    { headers: adminHeaders }
  )
  expect(res.status(), "GET /admin/reports/stock").toBe(200)
  return (await res.json()) as StockReport
}

/** Absolute recount via BACKEND-07 `adjust`; returns the resulting level. */
async function adjustStock(
  request: APIRequestContext,
  variantId: string,
  target: number,
  reason: string
): Promise<number> {
  const res = await request.post(`${BACKEND_URL}/admin/stock-movements`, {
    headers: adminHeaders,
    data: { variant_id: variantId, type: "adjust", quantity: target, reason },
  })
  expect(res.status(), `stock adjust to ${target} (${reason})`).toBe(200)
  const body = (await res.json()) as {
    inventory_level: { stocked_quantity: number }
  }
  return body.inventory_level.stocked_quantity
}

// ── 1. Sales report (BACKEND-08) ─────────────────────────────────────────────

test.describe("Reports (TEST-06)", () => {
  test("sales report: seeded orders' count, revenue, and best-sellers match", async ({
    request,
  }) => {
    // Two COD placements (incl. possible 429 waits) + report reads.
    test.setTimeout(600_000)

    const storeHeaders = publishableKeyHeaders()
    const regionId = await khRegionId(request, storeHeaders)
    const variantAId = await resolveVariantId(
      request,
      storeHeaders,
      regionId,
      ORDER_PRODUCT_HANDLE,
      ORDER_A_SIZE
    )
    const variantBId = await resolveVariantId(
      request,
      storeHeaders,
      regionId,
      ORDER_PRODUCT_HANDLE,
      ORDER_B_SIZE
    )

    // ── Seed the known orders (the report window will span exactly these).
    const orderAId = await placeCodOrder(
      request,
      storeHeaders,
      regionId,
      variantAId,
      ORDER_A_QTY
    )
    // Next rate-limit bucket — see COD_BUCKET_SPACING_MS. The wider window
    // this opens is interference-proof via the enumeration below.
    await sleep(COD_BUCKET_SPACING_MS)
    const orderBId = await placeCodOrder(
      request,
      storeHeaders,
      regionId,
      variantBId,
      ORDER_B_QTY
    )

    // ── The orders ARE the knowns: $16.50 and $31.50 usd, on the backend.
    const orderA = await fetchAdminOrder(request, orderAId)
    const orderB = await fetchAdminOrder(request, orderBId)
    expect(orderA.currency_code).toBe("usd")
    expect(toFiniteNumber(orderA.total, "order A total")).toBe(
      ORDER_A_TOTAL_USD
    )
    expect(orderB.currency_code).toBe("usd")
    expect(toFiniteNumber(orderB.total, "order B total")).toBe(
      ORDER_B_TOTAL_USD
    )

    // ── Window spanning exactly the seeded orders, padded so ms-truncated
    // bounds stay inclusive against the DB timestamps.
    const fromMs = Date.parse(orderA.created_at) - WINDOW_PAD_MS
    const toMs = Date.parse(orderB.created_at) + WINDOW_PAD_MS
    const fromIso = new Date(fromMs).toISOString()
    const toIso = new Date(toMs).toISOString()

    // The window closed in the past — let any in-flight commits land so the
    // report and the enumeration below see the identical order set.
    await sleep(SETTLE_MS)

    const reportRes = await request.get(
      `${BACKEND_URL}/admin/reports/sales?from=${encodeURIComponent(
        fromIso
      )}&to=${encodeURIComponent(toIso)}`,
      { headers: adminHeaders }
    )
    expect(reportRes.status(), "GET /admin/reports/sales").toBe(200)
    const report = (await reportRes.json()) as SalesReport
    expect(report.from).toBe(fromIso)
    expect(report.to).toBe(toIso)

    // ── Expected set, enumerated independently over the same window. In the
    // normal quiet-window case this is EXACTLY the two seeded orders, making
    // the equalities below `orders: 2` and `revenue: { usd: 48 }`; if a
    // parallel spec's order landed inside the seconds-wide window it is
    // counted on both sides instead of flaking the run.
    const expected = await listQualifyingOrders(request, fromMs, toMs)
    const expectedIds = new Set(expected.map((o) => o.id))
    expect(expectedIds.has(orderAId), "order A missing from window").toBe(true)
    expect(expectedIds.has(orderBId), "order B missing from window").toBe(true)

    // Order count matches the expectation.
    expect(report.orders).toBe(expected.length)

    // Per-currency revenue matches (BACKEND-08 groups by currency, cents-
    // rounded; both seeded orders are usd, so usd includes the known $48.00).
    const expectedRevenue: Record<string, number> = {}
    for (const order of expected) {
      const currency = String(order.currency_code ?? "").toLowerCase() || "usd"
      expectedRevenue[currency] =
        (expectedRevenue[currency] ?? 0) +
        toFiniteNumber(order.total, `total of ${order.id}`)
    }
    for (const currency of Object.keys(expectedRevenue)) {
      expectedRevenue[currency] = round2(expectedRevenue[currency])
    }
    expect(report.revenue).toEqual(expectedRevenue)
    expect(report.revenue.usd).toBeGreaterThanOrEqual(
      ORDER_A_TOTAL_USD + ORDER_B_TOTAL_USD
    )

    // ── Best-sellers: nothing else in the suite orders sweatshirt S/L, so
    // their units are exact; L (2 units) must rank above S (1 unit). (Top-10
    // truncation can't hide them — that would need 10 busier variants inside
    // this seconds-wide window.)
    const topA = report.top_variants.find((t) => t.variant_id === variantAId)
    const topB = report.top_variants.find((t) => t.variant_id === variantBId)
    expect(topA?.quantity, "sweatshirt S units in top_variants").toBe(
      ORDER_A_QTY
    )
    expect(topB?.quantity, "sweatshirt L units in top_variants").toBe(
      ORDER_B_QTY
    )
    expect(topA!.title).toMatch(/sweatshirt/i)
    expect(topB!.title).toMatch(/sweatshirt/i)
    expect(
      report.top_variants.findIndex((t) => t.variant_id === variantBId)
    ).toBeLessThan(
      report.top_variants.findIndex((t) => t.variant_id === variantAId)
    )
  })

  // ── 2. Stock report (BACKEND-08B) ───────────────────────────────────────────

  test("stock report: seeded low level drives exact low-stock membership", async ({
    request,
  }) => {
    test.setTimeout(120_000)

    const storeHeaders = publishableKeyHeaders()
    const regionId = await khRegionId(request, storeHeaders)
    const lowVariantId = await resolveVariantId(
      request,
      storeHeaders,
      regionId,
      LOW_STOCK_PRODUCT_HANDLE,
      LOW_STOCK_SIZE
    )
    const zeroVariantId = await resolveVariantId(
      request,
      storeHeaders,
      regionId,
      FIXTURE_ZERO_HANDLE,
      FIXTURE_ZERO_SIZE
    )

    // ── Remember the variant's real level, then seed the KNOWN low level.
    const baseline = await fetchStockReport(request, THRESHOLD)
    const baselineRow = baseline.levels.find(
      (row) => row.variant_id === lowVariantId
    )
    expect(
      baselineRow,
      `${LOW_STOCK_PRODUCT_HANDLE} ${LOW_STOCK_SIZE} missing from stock ` +
        "report levels[] — is it stock-tracked?"
    ).toBeTruthy()
    const originalQty = baselineRow!.quantity

    const runId = randomToken(6)
    const seeded = await adjustStock(
      request,
      lowVariantId,
      SEEDED_LOW_LEVEL,
      `TEST-06-low-stock-${runId}`
    )
    expect(seeded).toBe(SEEDED_LOW_LEVEL)

    // Restore the real level even when an assertion fails; a restore failure
    // must not mask the original error (stock-in.spec pattern).
    let restoreError: unknown
    try {
      // ── Membership at the default threshold (passed explicitly so a dev
      // LOW_STOCK_THRESHOLD env override can't flake the expectations).
      const report = await fetchStockReport(request, THRESHOLD)
      expect(report.threshold).toBe(THRESHOLD)

      // The seeded known level appears, with its exact quantity, in both
      // levels[] and (being 3 ≤ 5) low_stock[].
      const levelRow = report.levels.find(
        (row) => row.variant_id === lowVariantId
      )
      expect(levelRow?.quantity).toBe(SEEDED_LOW_LEVEL)
      const lowRow = report.low_stock.find(
        (row) => row.variant_id === lowVariantId
      )
      expect(lowRow?.quantity).toBe(SEEDED_LOW_LEVEL)

      // The fixture-seeded zero level (sweatpants XL, TEST-01) is low stock.
      const zeroRow = report.low_stock.find(
        (row) => row.variant_id === zeroVariantId
      )
      expect(
        zeroRow?.quantity,
        `${FIXTURE_ZERO_HANDLE} ${FIXTURE_ZERO_SIZE} (fixture zero) in low_stock`
      ).toBe(0)

      // Full membership equivalence over the snapshot: low_stock[] is EXACTLY
      // the levels[] rows with quantity <= threshold — at/below appear,
      // others don't.
      const lowIds = new Set(report.low_stock.map((row) => row.variant_id))
      for (const row of report.levels) {
        expect(
          lowIds.has(row.variant_id),
          `low_stock membership of "${row.title}" (qty ${row.quantity}, ` +
            `threshold ${THRESHOLD})`
        ).toBe(row.quantity <= THRESHOLD)
      }
      const levelIds = new Set(report.levels.map((row) => row.variant_id))
      for (const row of report.low_stock) {
        expect(
          levelIds.has(row.variant_id),
          `low_stock row "${row.title}" missing from levels[]`
        ).toBe(true)
      }

      // ── Boundary is `<=` exactly: in at threshold 3, out at threshold 2
      // (but still present in levels[] with the seeded quantity).
      const atReport = await fetchStockReport(request, SEEDED_LOW_LEVEL)
      expect(atReport.threshold).toBe(SEEDED_LOW_LEVEL)
      expect(
        atReport.low_stock.some((row) => row.variant_id === lowVariantId)
      ).toBe(true)

      const belowReport = await fetchStockReport(request, SEEDED_LOW_LEVEL - 1)
      expect(belowReport.threshold).toBe(SEEDED_LOW_LEVEL - 1)
      expect(
        belowReport.low_stock.some((row) => row.variant_id === lowVariantId)
      ).toBe(false)
      expect(
        belowReport.levels.find((row) => row.variant_id === lowVariantId)
          ?.quantity
      ).toBe(SEEDED_LOW_LEVEL)
    } finally {
      try {
        const restored = await adjustStock(
          request,
          lowVariantId,
          originalQty,
          `TEST-06-restore-${runId}`
        )
        if (restored !== originalQty) {
          restoreError = new Error(
            `level restore mismatch: expected ${originalQty}, got ${restored}`
          )
        }
      } catch (error: unknown) {
        restoreError = error
      }
    }
    if (restoreError) {
      throw restoreError
    }
  })
})
