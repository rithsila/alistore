import { MedusaService } from "@medusajs/framework/utils"
import StockMovement from "./models/stock-movement"

// MedusaService auto-generates CRUD methods for StockMovement
// (createStockMovements, listStockMovements, retrieveStockMovement, ...).
// Business logic (inventory-level adjustment, auto stock-out on order) is
// added in BACKEND-07 via workflows — not here.
class StockMovementModuleService extends MedusaService({
  StockMovement,
}) {}

export default StockMovementModuleService
