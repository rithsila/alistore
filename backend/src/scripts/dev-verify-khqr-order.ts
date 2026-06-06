import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STOCK_MOVEMENT_MODULE } from "../modules/stock-movement"

// TEST-04 dev verification helper (dev DB only — never run against production).
//
// Prints the backend-side evidence the KHQR E2E spec (storefront/tests/
// khqr.spec.ts) asserts after the simulated paid flip: the order's computed
// `payment_status` ("captured" = paid, the same field BACKEND-08 reads) and the
// `stock_movement` ledger rows recorded for the order (BACKEND-03B writes
// exactly one `out` row per line item). Output is one machine-readable line the
// spec extracts by marker:
//
//   KHQR_VERIFY_RESULT {"order":{...}|null,"movements":[...]}
//
// Run with: npx medusa exec ./src/scripts/dev-verify-khqr-order.ts <order_id>

const RESULT_MARKER = "KHQR_VERIFY_RESULT"

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

export default async function devVerifyKhqrOrder({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const orderId = args?.[0]
  if (!orderId) {
    throw new Error(
      "usage: npx medusa exec ./src/scripts/dev-verify-khqr-order.ts <order_id>"
    )
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // NOTE: the computed `payment_status` convenience field is resolved in
  // Medusa's HTTP layer, not by raw query.graph (it comes back undefined
  // here) — so the authoritative "paid" evidence is the payment row itself:
  // `captured_at` is stamped when the payment is captured.
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "status",
      "payment_collections.status",
      "payment_collections.payments.id",
      "payment_collections.payments.captured_at",
    ],
    filters: { id: orderId },
  })

  const stockMovements = container.resolve<StockMovementService>(
    STOCK_MOVEMENT_MODULE
  )
  const movements = await stockMovements.listStockMovements({
    order_id: orderId,
  })

  // No PII here: order id/status + variant-level ledger rows only.
  logger.info(
    `${RESULT_MARKER} ${JSON.stringify({
      order: orders?.[0] ?? null,
      movements,
    })}`
  )
}
