import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, Page, test } from "@playwright/test"

/**
 * TEST-03 — COD end-to-end (place COD → three effects).
 *
 *   1. Order `pending_confirmation` — observed twice: the real checkout journey
 *      lands on the COD confirmation (`/order/[id]?status=cod&token=…`) whose
 *      invoice token round-trips to a live 200 (a fabricated/seam-only order
 *      could not produce a token the backend accepts), and the BACKEND-04
 *      contract test reads `status: "pending_confirmation"` straight from
 *      `POST /store/orders/cod`.
 *   2. Telegram alert — DEFERRED to UAT (user decision 2026-06-06):
 *      `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are empty in dev so the
 *      subscriber no-ops, and the Bot API host is hard-coded per security.md
 *      (no mockable seam). The `test.fixme` below documents the UAT procedure.
 *   3. Stock reserved — the PDP stock note ("N left", reservation-adjusted
 *      availability from INTEGRATION-03) drops by exactly the ordered quantity
 *      after the order is placed.
 *
 * Prerequisites (see playwright.config.ts): backend :9000 + storefront :8000
 * running, TEST-01 fixtures applied, and the Cambodia shipping option seeded
 * (backend/src/scripts/seed-shipping.ts — re-run after any DB reset).
 *
 * Rate limits (security.md): `POST /store/orders/cod` allows 3/min/IP and
 * 10/hour/phone. Each test uses a fresh random Cambodian phone so repeated
 * runs don't trip the per-phone window; avoid >3 spec runs per minute.
 *
 * The two order-placing tests use DIFFERENT sizes (M vs L) so the parallel
 * workers can't race each other's stock counts.
 */

const PDP_PATH = "/product/sweatpants"
const UI_SIZE = "M" // UI journey orders sweatpants M (stock-count assertions)
const API_SIZE = "L" // contract test orders sweatpants L (no count overlap)

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"

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

/**
 * Fresh valid Cambodian phone per call (`^0[1-9]\d{7,8}$`) so the 10/hour
 * per-phone COD rate limit never accumulates across spec runs.
 */
function randomPhone(): string {
  const digits = Math.floor(Math.random() * 10_000_000)
    .toString()
    .padStart(7, "0")
  return `09${digits}`
}

/**
 * Select `size` on the sweatpants PDP and read the reservation-adjusted
 * availability from the "N left" stock note (INTEGRATION-03). Fails loudly if
 * the variant reports unmanaged/unlimited stock — the decrement assertion
 * needs a finite count.
 */
async function pdpStockCount(page: Page, size: string): Promise<number> {
  await page.goto(PDP_PATH, { waitUntil: "domcontentloaded" })

  const sizeGroup = page.getByRole("group", { name: "Size" })
  await sizeGroup.getByRole("button", { name: size, exact: true }).click()

  const note = page.getByText(/^\d+ left$/)
  await expect(note).toBeVisible()
  return Number((await note.textContent())!.replace(/ left$/, ""))
}

test.describe("COD order via the storefront UI", () => {
  test("places the order, lands on COD confirmation, reserves stock", async ({
    page,
  }) => {
    // ── Before: reservation-adjusted availability of the variant we'll buy.
    const stockBefore = await pdpStockCount(page, UI_SIZE)

    // ── Add to bag (size already selected by pdpStockCount).
    await page.getByRole("button", { name: "Add to bag" }).click()
    await expect(page.getByText("Added to bag.")).toBeVisible()

    // ── Checkout: delivery details + COD + place order.
    await page.goto("/checkout", { waitUntil: "domcontentloaded" })
    // The checkout form is fully server-rendered, so it is fillable BEFORE
    // React hydrates — and pre-hydration input is lost to component state
    // (the button then never enables). The nav bag count renders only from
    // useCartCount's client-side effect, so its appearance proves the tree
    // is hydrated and interactive.
    await expect(page.getByRole("link", { name: "Bag, 1 item" })).toBeVisible()
    await page.locator("#delivery-full-name").fill("Test Three Cod")
    await page.locator("#delivery-phone").fill(randomPhone())
    await page.locator("#delivery-address").fill("St 03, Phnom Penh")
    await page.getByText("Cash on delivery", { exact: true }).click()
    // Valid phone ⇒ the CTA enables; assert it so a validation regression
    // fails here with a clear message instead of a click timeout.
    const placeOrder = page.getByRole("button", { name: "Place order" })
    await expect(placeOrder).toBeEnabled()
    await placeOrder.click()

    // ── Effect 1: the COD confirmation for a real order id.
    await page.waitForURL(/\/order\/[^/?]+\?.*status=cod/)
    await expect(
      page.getByRole("heading", { name: "Order placed" })
    ).toBeVisible()
    await expect(
      page.getByText("Our team will contact you to confirm", { exact: false })
    ).toBeVisible()

    const url = new URL(page.url())
    const orderId = decodeURIComponent(url.pathname.split("/").pop()!)
    await expect(page.getByText(orderId)).toBeVisible() // order reference shown

    // The invoice token only exists if BACKEND-04 returned one; a live 200
    // from the token-gated invoice proves the order exists server-side
    // (wrong token → 403, missing order → 404 — see BACKEND-06).
    const token = url.searchParams.get("token")
    expect(token).toBeTruthy()
    await expect(page.getByRole("link", { name: "View invoice" })).toBeVisible()
    const invoiceRes = await page.request.get(
      `/store/orders/${encodeURIComponent(
        orderId
      )}/invoice?token=${encodeURIComponent(token!)}`
    )
    expect(invoiceRes.status()).toBe(200)

    // ── Effect 3: availability dropped by exactly the ordered quantity.
    const stockAfter = await pdpStockCount(page, UI_SIZE)
    expect(stockAfter).toBe(stockBefore - 1)
  })
})

test.describe("COD endpoint contract (BACKEND-04)", () => {
  test("POST /store/orders/cod returns status pending_confirmation", async ({
    request,
  }) => {
    const publishableKey = readStorefrontEnv(
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"
    )
    expect(
      publishableKey,
      "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY missing (storefront env)"
    ).toBeTruthy()
    const headers = {
      "x-publishable-api-key": publishableKey!,
      "content-type": "application/json",
    }

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

    // The sweatpants variant for the contract test (different size from the
    // UI journey so parallel workers don't race stock counts).
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
    const variant = products[0]?.variants.find((v) => v.title === API_SIZE)
    expect(variant, `sweatpants variant "${API_SIZE}" not found`).toBeTruthy()

    // Cart prep — mirrors @lib/checkout's locked BACKEND-04 assumption:
    // line item + email + kh shipping address + first shipping option.
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

    const phone = randomPhone()
    const updateRes = await request.post(
      `${BACKEND_URL}/store/carts/${cartId}`,
      {
        headers,
        data: {
          email: `${phone}@guest.alistore.com`,
          shipping_address: {
            first_name: "Test Three Api",
            phone,
            address_1: "St 03, Phnom Penh",
            country_code: "kh",
          },
        },
      }
    )
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

    // ── Effect 1, observed literally: BACKEND-04's contract response.
    const codRes = await request.post(`${BACKEND_URL}/store/orders/cod`, {
      headers,
      data: {
        cart_id: cartId,
        phone,
        name: "Test Three Api",
        address: "St 03, Phnom Penh",
      },
    })
    expect(codRes.status()).toBe(200)
    const body = (await codRes.json()) as {
      order_id?: string
      status?: string
      invoice_token?: string
    }
    expect(body.status).toBe("pending_confirmation")
    expect(body.order_id).toBeTruthy()
    expect(body.invoice_token).toBeTruthy()
  })
})

test.describe("Telegram alert (INTEGRATION-10)", () => {
  // Effect 2 — deferred to UAT (user decision 2026-06-06). In dev the
  // subscriber no-ops: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are empty and
  // security.md hard-codes the Bot API host, so there is no mockable seam and
  // a bot cannot read back its own sent messages for programmatic assertion.
  // UAT procedure: set both secrets in backend/.env, restart the backend, run
  // this spec, then confirm (a) the backend log line
  // "[order-placed] Telegram alert sent for order <id>" and (b) the message
  // (order #, items, total, COD, customer fields) in the private team chat.
  test.fixme("posts the order alert to the private team chat", async () => {
    // Activated at UAT — see the procedure above.
  })
})
