import { execSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, test, type APIRequestContext } from "@playwright/test"

/**
 * TEST-07 — Invoice (render + VAT hidden when disabled).
 *
 * Chain under test: an order's invoice link (INTEGRATION-07's storefront
 * proxy → BACKEND-06's token-gated route) returns a printable HTML document
 * whose content matches the order, with NO VAT line while VAT is disabled.
 *
 *   1. Valid HTML — the raw response is 200 `text/html` (`no-store` +
 *      `nosniff`), a full `<!DOCTYPE html>` document, and a real browser
 *      parses it into the expected structure: correct `<title>`, the issuer
 *      header, an items table with one row per order line, and the
 *      Subtotal/Delivery/Total footer — every value cross-checked against an
 *      independent admin-API read of the same order.
 *   2. No VAT line with VAT off — `INVOICE_VAT_ENABLED` is off in dev
 *      (asserted as a precondition from `backend/.env`), so the document must
 *      contain no VAT row and no TIN, the footer must be EXACTLY
 *      Subtotal/Delivery/Total, and Total must equal subtotal + delivery to
 *      the cent (proof VAT contributed nothing to the math).
 *
 * ── How the spec obtains an order + token (no new COD placement) ────────────
 * The COD 3/min/IP budget is already exactly full in parallel suite runs
 * (cod.spec's 2 unretryable UI/contract placements + reports.spec's 1 per
 * bucket — TEST-06 verified live that an extra placement 429s cod.spec), so
 * this spec deliberately places NO order. Instead it reuses the TEST-05/06
 * throwaway-admin pattern to read the newest order whose
 * `metadata.invoice_token` is valid (minted by BACKEND-04/03B at creation,
 * non-revoked, non-expired) and builds the invoice URL from it. On a fresh dev
 * DB it polls briefly — in a full suite run cod.spec creates a tokened order
 * within the budget; failing that it fails loudly with the precondition.
 *
 * The invoice itself is fetched through the STOREFRONT origin (`:8000`,
 * Playwright baseURL) with no publishable key attached — the same-origin
 * `<a>` path a customer clicks — proving INTEGRATION-07's middleware injects
 * the key and the token rides through to the handler.
 *
 * ── Admin auth (TEST-05 pattern, user-approved 2026-06-06) ───────────────────
 * Dev has no admin MFA (SETUP-01C deferred), so the spec creates a THROWAWAY
 * admin per run (`npx medusa user`, random hex creds — never in code or env),
 * logs in via `POST /auth/user/emailpass`, and reads orders with the Bearer
 * JWT. The created user is inert but stays in the dev DB.
 *
 * ── Parallel-suite safety ────────────────────────────────────────────────────
 * Read-only: no COD slot consumed, no stock mutated, no order created. Shared
 * budgets touched: invoice route 60/min/IP (a handful of GETs) and admin reads
 * (paced well under 60/min). Side effect per run: one inert `test-admin-*`
 * user row.
 *
 * Prerequisites (see playwright.config.ts): backend :9000 + storefront :8000
 * running, and at least one order placed with an invoice token (any cod/khqr/
 * reports spec run satisfies this; the suite itself does in parallel runs).
 */

test.describe.configure({ mode: "serial" })

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

// ── Tokened-order discovery pacing ───────────────────────────────────────────
/** Newest orders inspected per poll round (today's orders all carry tokens). */
const DISCOVERY_PAGE_SIZE = 10
/** Wait between poll rounds — keeps admin reads well under 60/min. */
const DISCOVERY_INTERVAL_MS = 20_000
/** Fresh-DB budget: long enough for a parallel cod.spec run to seed an order. */
const DISCOVERY_BUDGET_MS = 120_000

// ── Invoice-template mirrors (lib/invoice-template.ts defaults) ──────────────
/** Issuer name when `INVOICE_BUSINESS_NAME` is unset. */
const DEFAULT_BUSINESS_NAME = "Ali Store"

// ── Response shapes ──────────────────────────────────────────────────────────

/** The slice of an admin order line item the cross-check reads. */
interface AdminOrderItem {
  title?: string | null
  product_title?: string | null
  variant_title?: string | null
  quantity: number
  unit_price: unknown
  total: unknown
}

/** The slice of an admin order this spec reads (mirrors the route's fields). */
interface AdminOrderView {
  id: string
  display_id: number
  created_at: string
  currency_code: string
  metadata: Record<string, unknown> | null
  item_total: unknown
  shipping_total: unknown
  items: AdminOrderItem[]
}

// ── Shared helpers (cod/khqr/stock-in/reports spec precedents) ───────────────

/**
 * Random lowercase-hex token. [a-z0-9] only — safe to interpolate into the
 * `npx medusa user` shell command without quoting (stock-in.spec pattern).
 */
function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("hex")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Coerce an admin-API amount (number | string) to a finite number, loudly. */
function toFiniteNumber(value: unknown, label: string): number {
  const num = typeof value === "string" ? Number(value) : (value as number)
  expect(Number.isFinite(num), `${label} is not a finite number`).toBe(true)
  return num
}

/** Read one backend env value from `backend/.env` (absent file → undefined). */
function readBackendEnv(name: string): string | undefined {
  try {
    const content = readFileSync(join(BACKEND_DIR, ".env"), "utf8")
    const match = content.match(new RegExp(`^${name}=(.*)$`, "m"))
    if (match) {
      return match[1].trim()
    }
  } catch {
    // No .env — fall through to undefined (template defaults apply).
  }
  return undefined
}

/** Mirror the template's env-flag parse: true only for "true"/"1"/"yes". */
function readFlag(value: string | undefined): boolean {
  if (!value) return false
  return ["true", "1", "yes"].includes(value.trim().toLowerCase())
}

/** Mirror the template's cent rounding exactly. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Mirror the template's money formatting (Intl en-US currency). */
function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).format(amount)
  } catch {
    return `${currencyCode.toUpperCase()} ${amount.toFixed(2)}`
  }
}

/** Mirror the template's line-item label (product — variant | title | Item). */
function lineTitle(item: AdminOrderItem): string {
  const product = item.product_title?.trim()
  const variant = item.variant_title?.trim()
  if (product) return variant ? `${product} — ${variant}` : product
  return (item.title ?? "").trim() || "Item"
}

/**
 * Mirror BACKEND-06's token validity check on the metadata this spec reads:
 * present, not revoked, not past `invoice_token_expires_at`.
 */
function validInvoiceToken(
  metadata: Record<string, unknown> | null
): string | undefined {
  const meta = metadata ?? {}
  if (meta.invoice_token_revoked === true) return undefined
  const token = meta.invoice_token
  if (typeof token !== "string" || token.length === 0) return undefined
  const expiresAt = meta.invoice_token_expires_at
  if (typeof expiresAt === "string") {
    const exp = Date.parse(expiresAt)
    if (Number.isFinite(exp) && Date.now() > exp) return undefined
  }
  return token
}

// ── Admin reads ──────────────────────────────────────────────────────────────

/** Order fields the cross-check needs — mirrors the invoice route's graph. */
const ADMIN_ORDER_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "currency_code",
  "metadata",
  "item_total",
  "shipping_total",
  "*items",
].join(",")

let adminHeaders: Record<string, string>

/** Fetch one full order through the core admin API. */
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
 * Newest order carrying a VALID invoice token, polled within the discovery
 * budget (fresh-DB parallel runs: cod.spec seeds one mid-poll). Every order
 * BACKEND-04/03B creates is minted a token, so on a used dev DB the newest
 * order resolves immediately.
 */
async function findTokenedOrder(
  request: APIRequestContext
): Promise<{ order: AdminOrderView; token: string }> {
  const deadline = Date.now() + DISCOVERY_BUDGET_MS
  for (;;) {
    const listRes = await request.get(
      `${BACKEND_URL}/admin/orders?limit=${DISCOVERY_PAGE_SIZE}` +
        `&offset=0&order=-created_at&fields=id`,
      { headers: adminHeaders }
    )
    expect(listRes.status(), "GET /admin/orders (discovery)").toBe(200)
    const { orders } = (await listRes.json()) as {
      orders: Array<{ id: string }>
    }

    for (const { id } of orders) {
      const order = await fetchAdminOrder(request, id)
      const token = validInvoiceToken(order.metadata)
      if (token) {
        return { order, token }
      }
    }

    expect(
      Date.now() < deadline,
      "no order with a valid invoice token found — place one first " +
        "(any cod/khqr/reports spec run seeds one)"
    ).toBe(true)
    await sleep(DISCOVERY_INTERVAL_MS)
  }
}

// ── Shared fixture: throwaway admin → tokened order → raw invoice fetch ──────

let order: AdminOrderView
/** Storefront-origin invoice path (INTEGRATION-07's same-origin `<a>` URL). */
let invoicePath: string
let rawHtml: string

test.beforeAll(async ({ request }) => {
  // One `npx medusa` CLI boot + possible fresh-DB discovery polling.
  test.setTimeout(300_000 + DISCOVERY_BUDGET_MS)

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
  const { token: jwt } = (await loginRes.json()) as { token?: string }
  expect(jwt, "no JWT from /auth/user/emailpass").toBeTruthy()
  adminHeaders = {
    authorization: `Bearer ${jwt}`,
    "content-type": "application/json",
  }

  // ── The order under test + its capability token (admin metadata read).
  const found = await findTokenedOrder(request)
  order = found.order
  invoicePath = `/store/orders/${encodeURIComponent(
    order.id
  )}/invoice?token=${encodeURIComponent(found.token)}`

  // ── Raw fetch through the storefront proxy, NO publishable key attached —
  // exactly the browser `<a>` request; the middleware must inject the key.
  const invoiceRes = await request.get(invoicePath)
  expect(invoiceRes.status(), `GET ${invoicePath} via :8000 proxy`).toBe(200)
  expect(invoiceRes.headers()["content-type"]).toContain("text/html")
  expect(invoiceRes.headers()["cache-control"]).toContain("no-store")
  expect(invoiceRes.headers()["x-content-type-options"]).toBe("nosniff")
  rawHtml = await invoiceRes.text()
})

// ── 1. Valid HTML matching the order ─────────────────────────────────────────

test.describe("Invoice (TEST-07)", () => {
  test("renders valid HTML whose content matches the order", async ({
    page,
  }) => {
    // ── Document shape: a full standalone HTML document.
    expect(rawHtml.trimStart().startsWith("<!DOCTYPE html>")).toBe(true)
    expect(rawHtml).toContain('<html lang="en">')
    expect(rawHtml.trimEnd().endsWith("</html>")).toBe(true)

    // ── A real browser parses it (the practical "valid HTML" proof): every
    // assertion below queries the parsed DOM, not the source text.
    await page.goto(invoicePath, { waitUntil: "domcontentloaded" })
    await expect(page).toHaveTitle(`Invoice #${order.display_id}`)
    await expect(
      page.getByRole("heading", {
        name:
          readBackendEnv("INVOICE_BUSINESS_NAME")?.trim() ||
          DEFAULT_BUSINESS_NAME,
      })
    ).toBeVisible()
    await expect(page.getByText(`Invoice #${order.display_id}`)).toBeVisible()
    // Stable date render (template: ISO date part of created_at).
    await expect(
      page.getByText(String(order.created_at).slice(0, 10))
    ).toBeVisible()

    // ── Items table: header + one row per order line, cross-checked against
    // the independent admin read of the same order (titles, qty, money).
    const currency = String(order.currency_code ?? "usd").toUpperCase()
    const headerCells = page.locator("table thead th")
    await expect(headerCells).toHaveText(["Item", "Qty", "Unit", "Amount"])

    expect(
      order.items.length,
      "order under test has line items"
    ).toBeGreaterThan(0)
    // Ground-truth guard (review finding): a 0 quantity here would cross-
    // cancel with a 0 rendered through the same graph gotcha the route fix
    // addressed — fail loudly instead of silently passing on 0 == 0.
    for (const item of order.items) {
      expect(
        Number(item.quantity),
        `admin-read quantity for "${lineTitle(item)}" must be > 0`
      ).toBeGreaterThan(0)
    }
    const bodyRows = page.locator("table tbody tr")
    await expect(bodyRows).toHaveCount(order.items.length)

    const renderedRows: string[][] = []
    for (let i = 0; i < order.items.length; i++) {
      renderedRows.push(await bodyRows.nth(i).locator("td").allInnerTexts())
    }
    for (const item of order.items) {
      const expected = [
        lineTitle(item),
        String(Number(item.quantity) || 0),
        formatMoney(
          toFiniteNumber(item.unit_price, "item unit_price"),
          currency
        ),
        formatMoney(toFiniteNumber(item.total, "item total"), currency),
      ]
      expect(
        renderedRows.some((row) =>
          row.every((cell, i) => cell === expected[i])
        ),
        `invoice line for "${expected[0]}" (${JSON.stringify(expected)}) ` +
          `in ${JSON.stringify(renderedRows)}`
      ).toBe(true)
    }

    // ── Totals footer: Subtotal = item_total, Delivery = shipping_total,
    // Total = their cent-rounded sum (VAT off ⇒ no other contribution).
    const subtotal = toFiniteNumber(order.item_total, "order item_total")
    const delivery = toFiniteNumber(
      order.shipping_total,
      "order shipping_total"
    )
    const footRows = page.locator("table tfoot tr")
    await expect(footRows.filter({ hasText: "Subtotal" })).toContainText(
      formatMoney(subtotal, currency)
    )
    await expect(footRows.filter({ hasText: "Delivery" })).toContainText(
      formatMoney(delivery, currency)
    )
    await expect(footRows.filter({ hasText: "Total" }).last()).toContainText(
      formatMoney(round2(subtotal + delivery), currency)
    )
  })

  // ── 2. VAT line hidden while VAT is disabled ────────────────────────────────

  test("shows no VAT line or TIN while VAT is disabled", async ({ page }) => {
    // Precondition: dev runs with VAT off (PRD/CLARIFY-10 — VAT-ready but
    // disabled in v1). If this fails, unset INVOICE_VAT_ENABLED in
    // backend/.env — TEST-07 verifies the disabled rendering.
    expect(
      readFlag(readBackendEnv("INVOICE_VAT_ENABLED")),
      "INVOICE_VAT_ENABLED must be off in backend/.env for TEST-07"
    ).toBe(false)

    // ── Source-level absence: the VAT row label ("VAT (10%)") and the TIN
    // header line are not in the document at all.
    expect(rawHtml).not.toMatch(/VAT\s*\(/i)
    expect(rawHtml).not.toContain('class="tin"')

    // ── DOM-level absence: the footer is EXACTLY Subtotal/Delivery/Total —
    // no fourth (VAT) row — and no visible VAT/TIN text anywhere.
    await page.goto(invoicePath, { waitUntil: "domcontentloaded" })
    const footRows = page.locator("table tfoot tr")
    await expect(footRows).toHaveCount(3)
    await expect(footRows.nth(0)).toContainText("Subtotal")
    await expect(footRows.nth(1)).toContainText("Delivery")
    await expect(footRows.nth(2)).toContainText("Total")
    const bodyText = (await page.locator("body").innerText()) ?? ""
    expect(bodyText).not.toMatch(/\bVAT\b/i)
    expect(bodyText).not.toMatch(/\bTIN\b/i)

    // ── Math-level absence: Total carries zero VAT — it equals subtotal +
    // delivery to the cent (the enabled path would add round2(subtotal*rate)).
    const subtotal = toFiniteNumber(order.item_total, "order item_total")
    const delivery = toFiniteNumber(
      order.shipping_total,
      "order shipping_total"
    )
    const currency = String(order.currency_code ?? "usd").toUpperCase()
    await expect(footRows.nth(2)).toContainText(
      formatMoney(round2(subtotal + delivery), currency)
    )
  })
})
