import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STOCK_MOVEMENT_MODULE } from "../modules/stock-movement"

// TEST-05 dev verification helper (dev DB only — never run against production).
//
// Prints the backend-side evidence the stock-in E2E spec (storefront/tests/
// stock-in.spec.ts) asserts after posting an admin stock-in: every
// `stock_movement` ledger row matching the spec's unique per-run reason marker
// (the spec asserts EXACTLY ONE `in` row exists), and the variant's current
// stocked quantity summed across its inventory location levels (the same
// single-shop semantics as /admin/reports/stock). Output is one
// machine-readable line the spec extracts by marker:
//
//   STOCK_IN_VERIFY_RESULT {"movements":[...],"stocked_quantity":<n>}
//
// Run with:
//   npx medusa exec ./src/scripts/dev-verify-stock-in.ts <variant_id> <reason>

const RESULT_MARKER = "STOCK_IN_VERIFY_RESULT"

/** Minimal view of the stock-movement module's auto-generated CRUD. */
type StockMovementService = {
  listStockMovements(filters: Record<string, unknown>): Promise<
    Array<{
      id: string
      variant_id: string
      type: string
      quantity: number
      reason: string | null
      order_id: string | null
      created_by: string | null
    }>
  >
}

/** Coerce a Medusa BigNumberValue (number | string | { numeric }) to number. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (value && typeof value === "object" && "numeric" in value) {
    return Number((value as { numeric: unknown }).numeric)
  }
  return NaN
}

export default async function devVerifyStockIn({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const [variantId, reason] = args ?? []
  if (!variantId || !reason) {
    throw new Error(
      "usage: npx medusa exec ./src/scripts/dev-verify-stock-in.ts " +
        "<variant_id> <reason>"
    )
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Current stocked quantity — summed across the variant's inventory item
  // location levels (one level is the single-shop norm; matches the
  // /admin/reports/stock semantics).
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "inventory_items.inventory.location_levels.stocked_quantity",
    ],
    filters: { id: variantId },
  })
  const variant = variants?.[0]
  if (!variant) {
    throw new Error(`variant "${variantId}" not found`)
  }

  let stockedQuantity = 0
  for (const item of variant.inventory_items ?? []) {
    for (const level of item?.inventory?.location_levels ?? []) {
      const qty = toNumber(level?.stocked_quantity)
      if (Number.isFinite(qty)) {
        stockedQuantity += qty
      }
    }
  }

  // Ledger rows matching the spec's unique per-run reason marker — the spec
  // asserts this is exactly one `in` row.
  const stockMovements = container.resolve<StockMovementService>(
    STOCK_MOVEMENT_MODULE
  )
  const movements = await stockMovements.listStockMovements({
    variant_id: variantId,
    reason,
  })

  // No PII here: variant-level ledger rows + a stock count only.
  logger.info(
    `${RESULT_MARKER} ${JSON.stringify({
      movements,
      stocked_quantity: stockedQuantity,
    })}`
  )
}
