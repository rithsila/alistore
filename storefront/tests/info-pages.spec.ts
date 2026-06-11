import { expect, test } from "@playwright/test"

/**
 * FRONTEND-23 — static footer info pages (FAQ / Delivery / Returns).
 *
 * Runs against the storefront dev server (:8000). The pages fetch no data, so
 * the backend is optional. Viewports are set per-test where a breakpoint matters
 * (DESIGN.md: mobile baseline is 360px).
 */
test.describe("footer info pages (FRONTEND-23)", () => {
  test("FAQ page renders its heading and questions", async ({ page }) => {
    await page.goto("/faq", { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("heading", { level: 1, name: "Frequently Asked Questions" })
    ).toBeVisible()
    await expect(page.getByText("How do I order?")).toBeVisible()
  })

  test("Delivery page shows the fee and the free-over-threshold", async ({
    page,
  }) => {
    await page.goto("/delivery", { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("heading", { level: 1, name: "Delivery Information" })
    ).toBeVisible()
    // Flat $1.50, free over $50 — the locked CLARIFY-04 rule.
    await expect(page.getByText("$1.50")).toBeVisible()
    await expect(page.getByText(/\$50/)).toBeVisible()
  })

  test("Returns page states the 3-day exchange policy", async ({ page }) => {
    await page.goto("/returns", { waitUntil: "domcontentloaded" })
    await expect(
      page.getByRole("heading", { level: 1, name: "Returns & Exchanges" })
    ).toBeVisible()
    await expect(page.getByText(/within 3 days/)).toBeVisible()
  })
})
