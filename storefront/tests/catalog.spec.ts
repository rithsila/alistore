import { expect, Page, test } from "@playwright/test"

/**
 * TEST-01 — Catalog & PDP render (browse + variant states).
 *
 * Asserts the three Requirements against the real dev stack:
 *   1. Grid reflow      — ProductGrid column count at the DESIGN.md
 *                         breakpoints: 1-up ≤599 / 2-up ≥600 / 3-up ≥1024 /
 *                         4-up ≥1440 (FRONTEND-06).
 *   2. Sale-price       — sale card shows the struck original in mute and the
 *                         sale price in accent coral; full-price cards show a
 *                         single ink price (FRONTEND-05 / DESIGN.md).
 *   3. Variant stock    — sold-out size renders as a struck, disabled chip;
 *                         an in-stock size is selectable and surfaces the
 *                         stock note (FRONTEND-13 / INTEGRATION-03).
 *
 * Prerequisites (see playwright.config.ts):
 *   - backend on :9000 and storefront on :8000 are running, and
 *   - dev fixtures applied (backend/src/scripts/dev-seed-catalog-fixtures.ts):
 *     "shorts" on sale at $7 (USD base $15); "sweatpants" size XL stocked at 0.
 */

const SALE_HANDLE = "shorts"
const SALE_PRICE = "$7.00"
const SALE_ORIGINAL_PRICE = "$15.00"
const FULL_PRICE_HANDLE = "sweatshirt"
const SOLD_OUT_PDP = "/product/sweatpants"
const SOLD_OUT_SIZE = "XL"
const IN_STOCK_SIZE = "M"

// DESIGN.md accent coral #C0461F — sale price is one of its two permitted uses.
const ACCENT_RGB = "rgb(192, 70, 31)"

/** The ProductGrid container on the catalog/home page (FRONTEND-06). */
function catalogGrid(page: Page) {
  return page.locator("main section div.grid").first()
}

/** Count of rendered grid columns from the computed style. */
function gridColumnCount(page: Page): Promise<number> {
  return catalogGrid(page).evaluate(
    (grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length
  )
}

test.describe("catalog grid reflow (DESIGN.md breakpoints)", () => {
  const breakpoints = [
    { width: 360, columns: 1 }, // 1-up ≤599 (mobile baseline)
    { width: 768, columns: 2 }, // 2-up ≥600
    { width: 1100, columns: 3 }, // 3-up ≥1024
    { width: 1440, columns: 4 }, // 4-up ≥1440
  ]

  for (const { width, columns } of breakpoints) {
    test(`renders ${columns}-up at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/", { waitUntil: "domcontentloaded" })

      await expect(catalogGrid(page)).toBeVisible()
      expect(await gridColumnCount(page)).toBe(columns)
    })
  }
})

test.describe("sale-price treatment (product card)", () => {
  test("sale card shows struck mute original + accent sale price", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })

    const saleCard = page
      .locator(`main a[href="/product/${SALE_HANDLE}"]`)
      .first()
    await expect(saleCard).toBeVisible()

    // Struck-through original price in mute.
    const original = saleCard.locator("span.line-through")
    await expect(original).toHaveText(SALE_ORIGINAL_PRICE)
    await expect(original).toHaveClass(/text-mute/)
    await expect(original).toHaveCSS("text-decoration-line", "line-through")

    // Sale price in accent coral (#C0461F).
    const sale = saleCard.locator("span.text-accent")
    await expect(sale).toHaveText(SALE_PRICE)
    await expect(sale).toHaveCSS("color", ACCENT_RGB)
  })

  test("full-price card shows a single price with no strike-through", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })

    const fullPriceCard = page
      .locator(`main a[href="/product/${FULL_PRICE_HANDLE}"]`)
      .first()
    await expect(fullPriceCard).toBeVisible()

    await expect(fullPriceCard.locator("span.line-through")).toHaveCount(0)
    await expect(fullPriceCard.locator("span.text-accent")).toHaveCount(0)
  })
})

test.describe("variant stock states (PDP)", () => {
  test("sold-out size is struck and disabled", async ({ page }) => {
    await page.goto(SOLD_OUT_PDP, { waitUntil: "domcontentloaded" })

    const sizeGroup = page.getByRole("group", { name: "Size" })
    await expect(sizeGroup).toBeVisible()

    // The zero-stock size renders as a struck, disabled chip with the
    // accessible "sold out" label (FRONTEND-13).
    const soldOutChip = sizeGroup.getByRole("button", {
      name: `${SOLD_OUT_SIZE}, sold out`,
    })
    await expect(soldOutChip).toBeDisabled()
    await expect(soldOutChip).toHaveClass(/line-through/)
    await expect(soldOutChip).toHaveCSS("text-decoration-line", "line-through")
  })

  test("in-stock size is selectable and surfaces the stock note", async ({
    page,
  }) => {
    await page.goto(SOLD_OUT_PDP, { waitUntil: "domcontentloaded" })

    const sizeGroup = page.getByRole("group", { name: "Size" })
    await expect(sizeGroup).toBeVisible()

    // Before any selection the picker prompts for a size.
    await expect(page.getByText("Select a size")).toBeVisible()

    const inStockChip = sizeGroup.getByRole("button", {
      name: IN_STOCK_SIZE,
      exact: true,
    })
    await expect(inStockChip).toBeEnabled()
    await inStockChip.click()

    // Selecting an in-stock size resolves a variant: chip goes active and the
    // stock note shows the live count (or "In stock" for unlimited variants).
    await expect(inStockChip).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByText(/^(\d+ left|In stock)$/)).toBeVisible()
  })
})
