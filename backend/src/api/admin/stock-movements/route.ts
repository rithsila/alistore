/**
 * POST /admin/stock-movements — BACKEND-07.
 *
 * Manual stock-in / stock-out / adjust for a single variant. In one request it
 * adjusts the variant's inventory level (via the built-in
 * `updateInventoryLevelsWorkflow`) and writes one `stock_movement` ledger row.
 *
 * Body: `{ variant_id, type: "in"|"out"|"adjust", quantity, reason }`
 *   → `{ stock_movement, inventory_level: { inventory_item_id, location_id, stocked_quantity } }`.
 *
 * Quantity semantics (the model stores a single `quantity`; `type` disambiguates):
 *   - `in`     → raise the stocked quantity by `quantity` (quantity ≥ 1).
 *   - `out`    → lower the stocked quantity by `quantity` (quantity ≥ 1);
 *                rejected with 400 `insufficient_stock` if it would go negative.
 *   - `adjust` → set the stocked quantity to `quantity` (absolute recount, ≥ 0).
 * The ledger row stores `quantity` exactly as submitted.
 *
 * AUTH: `/admin/*` is admin-only (Medusa); `created_by` is the admin actor id.
 * SECURITY (security.md): zod-validated body; admin-session rate limit
 * (60/min/actor); errors return `{ error, request_id }` only.
 */
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { overLimitAtomic } from "../../../lib/rate-limit"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { randomUUID } from "crypto"
import { z } from "zod"
import { STOCK_MOVEMENT_MODULE } from "../../../modules/stock-movement"
import type StockMovementModuleService from "../../../modules/stock-movement/service"

/** Body schema (security.md: validate every body with zod before the service). */
const MovementSchema = z
  .object({
    // Medusa variant ids are short ULIDs (`variant_…`); cap length to reject junk.
    variant_id: z.string().trim().min(1).max(100),
    type: z.enum(["in", "out", "adjust"]),
    quantity: z.number().int(),
    reason: z.string().trim().min(1).max(500),
  })
  .superRefine((val, ctx) => {
    // in/out are positive magnitudes (direction comes from `type`); adjust is an
    // absolute recount that may be zeroed out but never negative.
    if ((val.type === "in" || val.type === "out") && val.quantity < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "quantity must be >= 1 for in/out",
      })
    }
    if (val.type === "adjust" && val.quantity < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "quantity must be >= 0 for adjust",
      })
    }
  })
type MovementSchema = z.infer<typeof MovementSchema>

/** Rate limit (security.md): admin endpoints 60/min/admin-session. */
const ADMIN_RATE_LIMIT = { windowMs: 60_000, limit: 60, ttl: 60 } as const

/** Variant graph fields: the linked inventory item + its location levels. */
const VARIANT_FIELDS = [
  "id",
  "manage_inventory",
  "inventory_items.inventory_item_id",
  "inventory_items.inventory.location_levels.id",
  "inventory_items.inventory.location_levels.location_id",
  "inventory_items.inventory.location_levels.stocked_quantity",
]

/** Coerce a Medusa BigNumberValue (number | string | { numeric }) to number. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (value && typeof value === "object" && "numeric" in value) {
    return Number((value as { numeric: unknown }).numeric)
  }
  return NaN
}

function getRequestId(req: AuthenticatedMedusaRequest): string {
  const header = req.headers["x-request-id"]
  if (typeof header === "string" && header.length > 0) return header
  return randomUUID()
}

function fail(
  res: MedusaResponse,
  status: number,
  error: string,
  requestId: string
): void {
  res.status(status).json({ error, request_id: requestId })
}

/** Per-admin-session fixed-window rate limit (60/min). Returns true when over. */
async function isRateLimited(
  req: AuthenticatedMedusaRequest,
  actorId: string
): Promise<boolean> {
  // C-02 fix: atomic fixed-window counter; see src/lib/rate-limit.ts.
  return overLimitAtomic(
    `rl:admin:stock-movements:${actorId}`,
    ADMIN_RATE_LIMIT.windowMs,
    ADMIN_RATE_LIMIT.limit,
    ADMIN_RATE_LIMIT.ttl
  )
}

/** Resolve the target absolute stocked quantity for the given movement type. */
function targetQuantity(
  type: MovementSchema["type"],
  current: number,
  quantity: number
): number {
  if (type === "in") return current + quantity
  if (type === "out") return current - quantity
  return quantity // adjust → absolute recount
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  const parsed = MovementSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, "invalid_request", requestId)
  }
  const { variant_id, type, quantity, reason } = parsed.data

  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    // /admin/* is already authenticated; this is a defensive guard.
    return fail(res, 401, "unauthorized", requestId)
  }

  if (await isRateLimited(req, actorId)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: variants } = await query.graph({
    entity: "variant",
    filters: { id: variant_id },
    fields: VARIANT_FIELDS,
  })
  const variant = variants?.[0]
  if (!variant) {
    return fail(res, 404, "variant_not_found", requestId)
  }

  // Resolve the variant's inventory item + its (single-shop) location level.
  const inventoryItem = (variant.inventory_items ?? [])[0]
  const inventoryItemId = inventoryItem?.inventory_item_id
  const level = (inventoryItem?.inventory?.location_levels ?? [])[0]
  if (!inventoryItemId || !level?.location_id) {
    return fail(res, 400, "no_inventory_level", requestId)
  }

  const current = toNumber(level.stocked_quantity)
  if (!Number.isFinite(current)) {
    logger.error(
      `[admin/stock-movements] unreadable stocked_quantity (request_id=${requestId})`
    )
    return fail(res, 500, "inventory_read_failed", requestId)
  }

  const target = targetQuantity(type, current, quantity)
  if (target < 0) {
    return fail(res, 400, "insufficient_stock", requestId)
  }

  // Adjust the inventory level first (authoritative state), then append the
  // ledger row. Both are awaited; a failure surfaces as 500.
  try {
    await updateInventoryLevelsWorkflow(req.scope).run({
      input: {
        updates: [
          {
            inventory_item_id: inventoryItemId,
            location_id: level.location_id,
            stocked_quantity: target,
          },
        ],
      },
    })
  } catch {
    logger.error(
      `[admin/stock-movements] inventory update failed (request_id=${requestId})`
    )
    return fail(res, 500, "inventory_update_failed", requestId)
  }

  const stockMovementService = req.scope.resolve<StockMovementModuleService>(
    STOCK_MOVEMENT_MODULE
  )

  let movement
  try {
    movement = await stockMovementService.recordMovement({
      variant_id,
      type,
      quantity,
      reason,
      created_by: actorId,
    })
  } catch {
    logger.error(
      `[admin/stock-movements] ledger write failed after inventory update (request_id=${requestId})`
    )
    return fail(res, 500, "movement_write_failed", requestId)
  }

  res.status(200).json({
    stock_movement: movement,
    inventory_level: {
      inventory_item_id: inventoryItemId,
      location_id: level.location_id,
      stocked_quantity: target,
    },
  })
}
