/**
 * GET /admin/reports/stock?low_threshold=5 — BACKEND-08B.
 *
 * Current stock + low-stock list for the single-operator shop's reorder check
 * (PRD §3.4: "current quantity per variant + low-stock list"). Sweeps every
 * stock-tracked variant, reads its inventory level(s), and returns:
 *
 *   {
 *     threshold,            // the effective low-stock threshold used
 *     levels: [{ variant_id, title, sku, quantity }],     // current stock, all variants
 *     low_stock: [{ variant_id, title, sku, quantity }]   // subset where quantity <= threshold
 *   }
 *
 * `quantity` is the variant's stocked quantity — PRD §4 defines `inventory_level`
 * as "stocked qty per variant per location (the stock truth)", and §3.4 shows the
 * report as the current quantity per variant. A variant linked to more than one
 * inventory item / location level (not the single-shop norm) is summed across them.
 *
 * Threshold: from the `low_threshold` query param when supplied, otherwise the
 * configured default (`LOW_STOCK_THRESHOLD`, default 5 — BACKEND-01 settings). A
 * variant is low stock when its current quantity is at or below the threshold.
 *
 * Only stock-tracked variants appear: a variant with no inventory level has no
 * stock truth, so it is omitted rather than reported as zero (which would falsely
 * flag it as low stock).
 *
 * AUTH: `/admin/*` is admin-only (Medusa).
 * SECURITY (security.md): query is zod-validated; admin-session rate limit
 * (60/min/actor); errors return `{ error, request_id }` only.
 */
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { overLimitAtomic } from "../../../../lib/rate-limit"
import { randomUUID } from "crypto"
import { z } from "zod"
import { getLowStockThreshold } from "../../../../lib/settings"

/** Rate limit (security.md): admin endpoints 60/min/admin-session. */
const ADMIN_RATE_LIMIT = { windowMs: 60_000, limit: 60, ttl: 60 } as const

/** Page size when sweeping variants (single-shop catalogues are small). */
const PAGE_SIZE = 200

/** Variant graph fields: identity + the linked inventory item location levels. */
const VARIANT_FIELDS = [
  "id",
  "title",
  "sku",
  "manage_inventory",
  "product.title",
  "inventory_items.inventory_item_id",
  "inventory_items.inventory.location_levels.stocked_quantity",
]

/**
 * Query schema (security.md: validate before touching the layer). `low_threshold`
 * is an optional non-negative integer (digits only — rejects negatives and junk);
 * when omitted the configured default is used.
 */
const QuerySchema = z.object({
  low_threshold: z
    .string()
    .trim()
    .regex(/^\d+$/, "low_threshold must be a non-negative integer")
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n), "low_threshold out of range")
    .optional(),
})

interface InventoryLevel {
  stocked_quantity?: unknown
}

interface VariantInventoryItem {
  inventory_item_id?: string | null
  inventory?: { location_levels?: InventoryLevel[] | null } | null
}

interface VariantView {
  id: string
  title?: string | null
  sku?: string | null
  manage_inventory?: boolean | null
  product?: { title?: string | null } | null
  inventory_items?: VariantInventoryItem[] | null
}

/** One stock-report row. */
interface StockLevel {
  variant_id: string
  title: string
  sku: string | null
  quantity: number
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
    `rl:admin:reports-stock:${actorId}`,
    ADMIN_RATE_LIMIT.windowMs,
    ADMIN_RATE_LIMIT.limit,
    ADMIN_RATE_LIMIT.ttl
  )
}

/** Build a readable label from product + variant titles. */
function variantLabel(variant: VariantView): string {
  const product = variant.product?.title?.trim()
  const title = variant.title?.trim()
  if (product) return title ? `${product} — ${title}` : product
  return title || "Unknown variant"
}

/**
 * Sum a variant's stocked quantity across its inventory item location levels.
 * Returns `null` when the variant has no stock-tracked level at all.
 */
function stockedQuantity(variant: VariantView): number | null {
  let total = 0
  let hasLevel = false
  for (const item of variant.inventory_items ?? []) {
    for (const level of item.inventory?.location_levels ?? []) {
      const qty = toNumber(level.stocked_quantity)
      if (Number.isFinite(qty)) {
        total += qty
        hasLevel = true
      }
    }
  }
  return hasLevel ? total : null
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)

  const parsed = QuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return fail(res, 400, "invalid_request", requestId)
  }
  const threshold = parsed.data.low_threshold ?? getLowStockThreshold()

  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    // /admin/* is already authenticated; this is a defensive guard.
    return fail(res, 401, "unauthorized", requestId)
  }

  if (await isRateLimited(req, actorId)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Sweep all variants, paged, collecting stock-tracked ones.
  const levels: StockLevel[] = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: VARIANT_FIELDS,
      pagination: { skip, take: PAGE_SIZE },
    })
    const batch = (variants ?? []) as VariantView[]
    if (batch.length === 0) break

    for (const variant of batch) {
      const quantity = stockedQuantity(variant)
      if (quantity === null) continue // not stock-tracked → no stock truth
      levels.push({
        variant_id: variant.id,
        title: variantLabel(variant),
        sku: variant.sku?.trim() || null,
        quantity,
      })
    }

    if (batch.length < PAGE_SIZE) break
  }

  // Most-urgent first, then alphabetical for ties.
  levels.sort((a, b) => a.quantity - b.quantity || a.title.localeCompare(b.title))

  const lowStock = levels.filter((level) => level.quantity <= threshold)

  res.status(200).json({
    threshold,
    levels,
    low_stock: lowStock,
  })
}
