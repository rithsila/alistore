import { MedusaService } from "@medusajs/framework/utils"
import StockMovement from "./models/stock-movement"

export type StockMovementType = "in" | "out" | "adjust"

/** Input for a single ledger write (BACKEND-07). */
export interface RecordMovementInput {
  variant_id: string
  type: StockMovementType
  quantity: number
  reason: string
  /** Admin user id (manual) or the system actor (auto stock-out). */
  created_by: string
  /** Set for automatic stock-out tied to an order; null for manual movements. */
  order_id?: string | null
}

/** Input for the auto stock-out helper reused by BACKEND-03B/04. */
export interface RecordStockOutInput {
  variant_id: string
  quantity: number
  order_id: string
  created_by: string
  reason?: string
}

// MedusaService auto-generates CRUD methods for StockMovement
// (createStockMovements, listStockMovements, retrieveStockMovement, ...).
// The methods below are thin, module-isolated wrappers around that CRUD — the
// stock ledger only records movements; it never reaches into the Inventory
// Module (the admin route owns the inventory-level adjustment).
class StockMovementModuleService extends MedusaService({
  StockMovement,
}) {
  /**
   * Write one stock-movement ledger row and return it. Used by the admin
   * `POST /admin/stock-movements` route for manual in/out/adjust.
   */
  async recordMovement(input: RecordMovementInput) {
    const [movement] = await this.createStockMovements([
      {
        variant_id: input.variant_id,
        type: input.type,
        quantity: input.quantity,
        reason: input.reason,
        order_id: input.order_id ?? null,
        created_by: input.created_by,
      },
    ])
    return movement
  }

  /**
   * Log an automatic stock-out on order commit (`type=out`, with `order_id` +
   * `created_by`). Reused by BACKEND-03B (KHQR paid) and BACKEND-04 (COD) when
   * an order is finalized; Medusa itself handles the inventory reservation, so
   * this only appends the audit row.
   */
  async recordStockOut(input: RecordStockOutInput) {
    return this.recordMovement({
      variant_id: input.variant_id,
      type: "out",
      quantity: input.quantity,
      reason: input.reason ?? "order",
      order_id: input.order_id,
      created_by: input.created_by,
    })
  }
}

export default StockMovementModuleService
