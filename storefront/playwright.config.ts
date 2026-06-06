import { defineConfig } from "@playwright/test"

/**
 * Playwright config for the storefront E2E specs (TEST phase).
 *
 * The specs run against the real dev stack — both servers must be up first:
 *   - backend:    `npx medusa develop`  (http://localhost:9000)
 *   - storefront: `npm run dev`         (http://localhost:8000)
 *
 * Dev-data fixtures expected by the specs are applied with:
 *   backend> npx medusa exec ./src/scripts/dev-seed-catalog-fixtures.ts
 *
 * Viewports are set per-test (the specs assert DESIGN.md breakpoints
 * explicitly), so a single default Chromium project is enough.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // CI gets retries to absorb dev-stack flake; local runs fail fast.
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.STOREFRONT_URL ?? "http://localhost:8000",
    trace: "retain-on-failure",
    // Next dev compiles routes on first hit — allow for the cold compile.
    navigationTimeout: 60_000,
  },
})
