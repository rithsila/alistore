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
})
