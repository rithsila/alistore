import { model } from "@medusajs/framework/utils"

// Stock ledger: one row per inventory change (manual stock-in/adjust or
// automatic stock-out on an order). Fields match ImplementPlan SETUP-06.
//
// `created_at` (plus `updated_at` and `deleted_at`) is added automatically by
// model.define — it must NOT be declared explicitly here.
const StockMovement = model.define("stock_movement", {
  id: model.id().primaryKey(),
  variant_id: model.text(),
  type: model.enum(["in", "out", "adjust"]),
  quantity: model.number(),
  reason: model.text(),
  order_id: model.text().nullable(),
  created_by: model.text(),
})

export default StockMovement
