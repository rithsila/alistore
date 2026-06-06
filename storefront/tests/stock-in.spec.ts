import { execSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { expect, Page, test } from "@playwright/test"

/**
 * TEST-05 — Stock-in flow (receiving + availability).
 *
 * Chain under test: admin stock-in → inventory level rises by N → one
 * `stock_movement(in)` ledger row → the storefront PDP reflects the new stock.
 * This is the authenticated "+N + one row" observation BACKEND-07 deferred.
 *
 * ── Admin auth (user-approved approach, 2026-06-06) ──────────────────────────
 * Dev has no admin MFA (SETUP-01C deferred — the OSS dashboard ships no TOTP
 * UI), so admin auth is plain emailpass JWT. The spec creates a THROWAWAY
 * admin per run (`npx medusa user`, random [a-z0-9] email + password — no
 * credentials in code or env), logs in via `POST /auth/user/emailpass`, and
 * calls the real admin endpoints with the Bearer token. The created user is
 * inert but stays in the dev DB after the run.
 *
 * ── State restoration ────────────────────────────────────────────────────────
 * The +N stock-in is compensated at the end with a `type=out` movement of the
 * same quantity (both via the real admin endpoint), so repeated runs and the
 * other specs' stock expectations stay stable. The ledger keeps both rows —
 * it is an append-only history; only the level is restored.
 *
 * Prerequisites (see playwright.config.ts): backend :9000 + storefront :8000
 * running, TEST-01 fixtures applied.
 *
 * Rate limits (security.md): admin endpoints allow 60/min/admin-session — this
 * spec makes 4 admin calls on a fresh session, far under the window.
 *
 * Variant choice: shorts size L — the sweatpants sizes are owned by the other
 * specs (S khqr, M/L cod, XL zeroed by the TEST-01 fixtures) and cart.spec
 * only ever carts sweatshirt/shorts size M, so no parallel spec counts or
 * orders shorts L.
 */

const PDP_PATH = "/product/shorts"
const PRODUCT_HANDLE = "shorts"
const STOCK_IN_SIZE = "L"
/** N — the received quantity the acceptance criterion's "+N" refers to. */
const STOCK_IN_QTY = 7

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

// ── Shared helpers (cod.spec.ts / khqr.spec.ts precedents) ────────────────────

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
 * `npx medusa user` / `medusa exec` shell commands without quoting (execSync
 * needs a shell for `npx` on Windows; see khqr.spec.ts).
 */
function randomToken(bytes: number): string {
  return randomBytes(bytes).toString("hex")
}

/**
 * Select `size` on the PDP and read the reservation-adjusted availability from
 * the "N left" stock note (INTEGRATION-03). Fails loudly if the variant
 * reports unmanaged/unlimited stock — the +N assertion needs a finite count.
 */
async function pdpStockCount(page: Page, size: string): Promise<number> {
  await page.goto(PDP_PATH, { waitUntil: "domcontentloaded" })

  const sizeGroup = page.getByRole("group", { name: "Size" })
  await sizeGroup.getByRole("button", { name: size, exact: true }).click()

  const note = page.getByText(/^\d+ left$/)
  await expect(note).toBeVisible()
  return Number((await note.textContent())!.replace(/ left$/, ""))
}

/** BACKEND-07 response shape. */
interface StockMovementResponse {
  stock_movement: {
    id: string
    variant_id: string
    type: string
    quantity: number
    reason: string | null
    order_id: string | null
    created_by: string | null
  }
  inventory_level: {
    inventory_item_id: string
    location_id: string
    stocked_quantity: number
  }
}

test.describe("Stock-in flow (TEST-05)", () => {
  test("admin stock-in: level +N, one `in` row, PDP reflects new stock", async ({
    page,
    request,
  }) => {
    // Two `npx medusa` CLI boots (throwaway admin + DB verify) + UI work.
    test.setTimeout(600_000)

    // ── Throwaway admin: create + login (header: user-approved approach).
    const runId = randomToken(6)
    const adminEmail = `test-admin-${runId}@alistore.dev`
    const adminPassword = randomToken(24)
    // Hard character-class guard before shelling out (khqr.spec.ts pattern):
    // both values are hex + a fixed safe shape — no shell metacharacters.
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

    const loginRes = await request.post(
      `${BACKEND_URL}/auth/user/emailpass`,
      {
        headers: { "content-type": "application/json" },
        data: { email: adminEmail, password: adminPassword },
      }
    )
    expect(loginRes.status(), "emailpass login for the throwaway admin").toBe(
      200
    )
    const { token } = (await loginRes.json()) as { token?: string }
    expect(token, "no JWT from /auth/user/emailpass").toBeTruthy()
    const adminHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    }

    // ── Resolve the shorts L variant id via the store API.
    const storeHeaders = publishableKeyHeaders()

    // Cambodia region — never regions[0] (the seed's first region is EUR).
    const regionsRes = await request.get(
      `${BACKEND_URL}/store/regions?fields=*countries`,
      { headers: storeHeaders }
    )
    expect(regionsRes.ok()).toBeTruthy()
    const { regions } = (await regionsRes.json()) as {
      regions: Array<{ id: string; countries?: Array<{ iso_2: string }> }>
    }
    const region = regions.find((r) =>
      (r.countries ?? []).some((c) => c.iso_2 === "kh")
    )
    expect(region, "no region containing Cambodia (kh)").toBeTruthy()

    const productRes = await request.get(
      `${BACKEND_URL}/store/products?handle=${PRODUCT_HANDLE}&region_id=${
        region!.id
      }&fields=*variants`,
      { headers: storeHeaders }
    )
    expect(productRes.ok()).toBeTruthy()
    const { products } = (await productRes.json()) as {
      products: Array<{
        variants: Array<{ id: string; title?: string | null }>
      }>
    }
    const variant = products[0]?.variants.find(
      (v) => v.title === STOCK_IN_SIZE
    )
    expect(
      variant,
      `${PRODUCT_HANDLE} variant "${STOCK_IN_SIZE}" not found`
    ).toBeTruthy()
    const variantId = variant!.id

    // ── Before: storefront availability ("N left", reservation-adjusted) and
    // the raw stocked quantity from the independent admin report (BACKEND-08B).
    const pdpBefore = await pdpStockCount(page, STOCK_IN_SIZE)

    const reportBeforeRes = await request.get(
      `${BACKEND_URL}/admin/reports/stock`,
      { headers: adminHeaders }
    )
    expect(reportBeforeRes.status()).toBe(200)
    const reportBefore = (await reportBeforeRes.json()) as {
      levels: Array<{ variant_id: string; quantity: number }>
    }
    const rawBefore = reportBefore.levels.find(
      (l) => l.variant_id === variantId
    )?.quantity
    expect(
      rawBefore,
      "variant missing from /admin/reports/stock levels[]"
    ).toBeDefined()

    // ── Admin stock-in (+N) with a unique per-run reason marker the DB verify
    // step keys on.
    const reasonMarker = `TEST-05-stock-in-${runId}`
    const stockInRes = await request.post(
      `${BACKEND_URL}/admin/stock-movements`,
      {
        headers: adminHeaders,
        data: {
          variant_id: variantId,
          type: "in",
          quantity: STOCK_IN_QTY,
          reason: reasonMarker,
        },
      }
    )
    expect(stockInRes.status()).toBe(200)
    const stockIn = (await stockInRes.json()) as StockMovementResponse

    // Restore the level even when an assertion below fails (a compensating
    // `out` via the same admin endpoint) so repeated runs and the parallel
    // specs' stock expectations stay stable. A restore failure must not mask
    // the original test error — it is captured and re-thrown only afterwards.
    let restoreError: unknown
    try {
      // ── Effect 1: level +N — from the endpoint response…
      expect(stockIn.inventory_level.stocked_quantity).toBe(
        rawBefore! + STOCK_IN_QTY
      )
      // …and the created ledger row comes back as submitted.
      expect(stockIn.stock_movement.id).toBeTruthy()
      expect(stockIn.stock_movement.variant_id).toBe(variantId)
      expect(stockIn.stock_movement.type).toBe("in")
      expect(Number(stockIn.stock_movement.quantity)).toBe(STOCK_IN_QTY)
      expect(stockIn.stock_movement.reason).toBe(reasonMarker)
      expect(stockIn.stock_movement.order_id).toBeNull()
      expect(stockIn.stock_movement.created_by).toBeTruthy()

      // …and independently via the admin stock report (BACKEND-08B).
      const reportAfterRes = await request.get(
        `${BACKEND_URL}/admin/reports/stock`,
        { headers: adminHeaders }
      )
      expect(reportAfterRes.status()).toBe(200)
      const reportAfter = (await reportAfterRes.json()) as {
        levels: Array<{ variant_id: string; quantity: number }>
      }
      expect(
        reportAfter.levels.find((l) => l.variant_id === variantId)?.quantity
      ).toBe(rawBefore! + STOCK_IN_QTY)

      // ── Effect 3: the PDP reflects the new stock (+N on the "N left" note).
      const pdpAfter = await pdpStockCount(page, STOCK_IN_SIZE)
      expect(pdpAfter).toBe(pdpBefore + STOCK_IN_QTY)

      // ── Effect 2: exactly ONE `in` ledger row, straight from the DB.
      // (No public API lists movements — the dev helper prints them.) Hard
      // character-class guards before shelling out (khqr.spec.ts pattern).
      if (!/^variant_[A-Za-z0-9]+$/.test(variantId)) {
        throw new Error("unsafe variant id — refusing to shell out")
      }
      if (!/^TEST-05-stock-in-[a-f0-9]+$/.test(reasonMarker)) {
        throw new Error("unsafe reason marker — refusing to shell out")
      }
      const verifyOut = execSync(
        `npx medusa exec ./src/scripts/dev-verify-stock-in.ts ${variantId} ${reasonMarker}`,
        {
          cwd: BACKEND_DIR,
          encoding: "utf8",
          timeout: 240_000,
          maxBuffer: 10 * 1024 * 1024,
        }
      )
      const marker = verifyOut.match(/STOCK_IN_VERIFY_RESULT (\{.*\})/)
      expect(
        marker,
        "no STOCK_IN_VERIFY_RESULT line in medusa exec output"
      ).toBeTruthy()
      const verified = JSON.parse(marker![1]) as {
        movements: Array<{
          variant_id: string
          type: string
          quantity: number
          reason: string | null
          order_id: string | null
          created_by: string | null
        }>
        stocked_quantity: number
      }

      expect(verified.movements).toHaveLength(1)
      expect(verified.movements[0].variant_id).toBe(variantId)
      expect(verified.movements[0].type).toBe("in")
      expect(Number(verified.movements[0].quantity)).toBe(STOCK_IN_QTY)
      expect(verified.movements[0].order_id).toBeNull()
      expect(verified.movements[0].created_by).toBeTruthy()
      expect(verified.stocked_quantity).toBe(rawBefore! + STOCK_IN_QTY)
    } finally {
      try {
        const restoreRes = await request.post(
          `${BACKEND_URL}/admin/stock-movements`,
          {
            headers: adminHeaders,
            data: {
              variant_id: variantId,
              type: "out",
              quantity: STOCK_IN_QTY,
              reason: `TEST-05-restore-${runId}`,
            },
          }
        )
        if (restoreRes.status() !== 200) {
          restoreError = new Error(
            `level restore failed (${restoreRes.status()}) — ` +
              `${PRODUCT_HANDLE} ${STOCK_IN_SIZE} is left at +${STOCK_IN_QTY}`
          )
        } else {
          const restored = (await restoreRes.json()) as StockMovementResponse
          if (restored.inventory_level.stocked_quantity !== rawBefore) {
            restoreError = new Error(
              `level restore mismatch: expected ${rawBefore}, got ` +
                `${restored.inventory_level.stocked_quantity}`
            )
          }
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
