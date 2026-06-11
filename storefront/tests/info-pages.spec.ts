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

  test("footer links navigate to the info pages", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" })
    const footer = page.locator("footer")
    await expect(footer.getByRole("link", { name: "FAQ" })).toHaveAttribute(
      "href",
      "/faq"
    )
    await expect(
      footer.getByRole("link", { name: "Delivery Info" })
    ).toHaveAttribute("href", "/delivery")
    await expect(footer.getByRole("link", { name: "Returns" })).toHaveAttribute(
      "href",
      "/returns"
    )
  })

  test("each info page has exactly one h1", async ({ page }) => {
    for (const path of ["/faq", "/delivery", "/returns"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" })
      await expect(
        page.getByRole("heading", { level: 1 }),
        `${path} should have exactly one h1`
      ).toHaveCount(1)
    }
  })

  test("info pages have no horizontal overflow at 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 })
    for (const path of ["/faq", "/delivery", "/returns"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" })
      const overflows = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      )
      expect(overflows, `${path} should not overflow at 360px`).toBe(false)
    }
  })
})
