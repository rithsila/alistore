import { Module } from "@medusajs/framework/utils"
import StockMovementModuleService from "./service"

// Module name is camelCase (never kebab-case) — it becomes the container
// resolution key, e.g. container.resolve(STOCK_MOVEMENT_MODULE).
export const STOCK_MOVEMENT_MODULE = "stockMovement"

export default Module(STOCK_MOVEMENT_MODULE, {
  service: StockMovementModuleService,
})
