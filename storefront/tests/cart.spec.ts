import { expect, Page, test } from "@playwright/test"

import { formatPrice, formatUsd, usdToKhr } from "../src/lib/price"

/**
 * TEST-02 — Cart math (totals + delivery logic).
 *
 * Asserts the four Requirements:
 *   1. Subtotal            — single line and mixed lines (full-price + sale
 *                            fixture) sum correctly on the cart page.
 *   2. Delivery fee        — flat $1.50 below the threshold (CLARIFY-04).
 *   3. Free-over-threshold — "Free" exactly at $50 and above it; fee returns
 *                            the moment the subtotal is below.
 *   4. KHR rounding        — FRONTEND-22 formatter (`src/lib/price.ts`): whole
 *                            riel, no decimals. Asserted at the formatter
 *                            because no storefront surface renders a KHR price
 *                            string yet — the toggle drives the KHQR *amount*
 *                            (INTEGRATION-08), which TEST-04 covers end-to-end.
 *
 * Prerequisites (see playwright.config.ts):
 *   - backend on :9000 and storefront on :8000 are running, and
 *   - dev fixtures applied (backend/src/scripts/dev-seed-catalog-fixtures.ts):
 *     "shorts" on sale at $7 (USD base $15). 1×$15 + 5×$7 = exactly $50 lets
 *     the spec hit the free-delivery boundary precisely.
 *
 * Each test runs in a fresh browser context (no cookies) → a fresh cart.
 */

const FULL_PRICE_HANDLE = "sweatshirt" // $15.00 (USD base)
const SALE_HANDLE = "shorts" // $7.00 (sale fixture; base $15)
const SIZE = "M"

// CLARIFY-04 (locked): flat $1.50 delivery, free once subtotal ≥ $50.
const DELIVERY_FEE_TEXT = "$1.50"
const FREE_TEXT = "Free"
const THRESHOLD_NOTE = "Free delivery over $50"

/** Add one unit of `handle` (size `SIZE`) to the bag via the real PDP flow. */
async function addToBag(page: Page, handle: string): Promise<void> {
  await page.goto(`/product/${handle}`, { waitUntil: "domcontentloaded" })

  const sizeGroup = page.getByRole("group", { name: "Size" })
  await sizeGroup.getByRole("button", { name: SIZE, exact: true }).click()
  await page.getByRole("button", { name: "Add to bag" }).click()

  // The PDP confirms the server action landed before we move on.
  await expect(page.getByText("Added to bag.")).toBeVisible()
}

/** The value span of an order-summary row ("Subtotal" / "Delivery" / "Total"). */
function summaryValue(page: Page, label: string) {
  return page
    .getByRole("region", { name: "Order summary" })
    .locator("div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("span")
    .last()
}

/** Assert the three summary rows in one go. */
async function expectSummary(
  page: Page,
  subtotal: string,
  delivery: string,
  total: string
): Promise<void> {
  await expect(summaryValue(page, "Subtotal")).toHaveText(subtotal)
  await expect(summaryValue(page, "Delivery")).toHaveText(delivery)
  await expect(summaryValue(page, "Total")).toHaveText(total)
}

/** Click the "+" stepper on a cart line until its quantity reads `target`. */
async function increaseQuantityTo(
  page: Page,
  lineNamePattern: RegExp,
  from: number,
  target: number
): Promise<void> {
  const stepper = page.getByRole("group", { name: lineNamePattern })
  for (let quantity = from + 1; quantity <= target; quantity++) {
    await stepper.getByRole("button", { name: "Increase quantity" }).click()
    // Serialize on the live quantity so each server round-trip settles.
    await expect(
      stepper.getByText(String(quantity), { exact: true })
    ).toBeVisible()
  }
}

test.describe("delivery fee below threshold", () => {
  test("single $15 line: subtotal + $1.50 fee = $16.50 total", async ({
    page,
  }) => {
    await addToBag(page, FULL_PRICE_HANDLE)
    await page.goto("/cart", { waitUntil: "domcontentloaded" })

    await expectSummary(page, "$15.00", DELIVERY_FEE_TEXT, "$16.50")
    await expect(page.getByText(THRESHOLD_NOTE)).toBeVisible()
  })
})

test.describe("free-over-threshold boundary", () => {
  test("mixed lines: fee below $50, Free at exactly $50 and above", async ({
    page,
  }) => {
    // 1 × sweatshirt ($15) + 1 × sale shorts ($7) = $22 — below threshold.
    await addToBag(page, FULL_PRICE_HANDLE)
    await addToBag(page, SALE_HANDLE)
    await page.goto("/cart", { waitUntil: "domcontentloaded" })

    await expectSummary(page, "$22.00", DELIVERY_FEE_TEXT, "$23.50")

    // Step shorts 1 → 5: $15 + 5×$7 = exactly $50.00 — boundary hits Free.
    await increaseQuantityTo(page, /Quantity for .*Shorts/i, 1, 5)
    await expectSummary(page, "$50.00", FREE_TEXT, "$50.00")

    // One more ($57.00) — still free above the threshold.
    await increaseQuantityTo(page, /Quantity for .*Shorts/i, 5, 6)
    await expectSummary(page, "$57.00", FREE_TEXT, "$57.00")
  })
})

test.describe("KHR rounding (FRONTEND-22 formatter)", () => {
  // Whole-riel KHR with the ៛ prefix, en-US grouping, and no decimal point.
  const WHOLE_RIEL = /^៛\d{1,3}(,\d{3})*$/

  test("usdToKhr always returns a whole-riel integer", () => {
    // Locked dev rate (4100): the below-threshold cart total from above.
    expect(usdToKhr(16.5, 4100)).toBe(67650)
    expect(Number.isInteger(usdToKhr(16.5, 4100))).toBe(true)

    // A rate that produces fractional riel (16.5 × 4061.37 = 67,012.605)
    // must round to a whole riel, never leak decimals.
    expect(usdToKhr(16.5, 4061.37)).toBe(67013)
    expect(Number.isInteger(usdToKhr(16.5, 4061.37))).toBe(true)
  })

  test("KHR formats with no decimals; USD keeps two", () => {
    expect(formatPrice(16.5, "KHR", { usdKhrRate: 4100 })).toBe("៛67,650")
    expect(formatPrice(50, "KHR", { usdKhrRate: 4100 })).toBe("៛205,000")

    expect(formatPrice(16.5, "KHR", { usdKhrRate: 4100 })).toMatch(WHOLE_RIEL)
    expect(formatPrice(16.5, "KHR", { usdKhrRate: 4061.37 })).toMatch(
      WHOLE_RIEL
    )

    // Contrast: the USD path keeps exactly two decimals.
    expect(formatUsd(16.5)).toBe("$16.50")
    expect(formatPrice(16.5, "USD")).toBe("$16.50")
  })
})
