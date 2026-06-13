/**
 * GET /admin/reports/sales?from=&to= — BACKEND-08.
 *
 * Period revenue/order summary for the single-operator shop's weekly check
 * (PRD §3.5). Aggregates qualifying orders whose `created_at` falls in the
 * `[from, to]` window and returns:
 *
 *   {
 *     from, to,                         // echo of the (validated) window, or null
 *     orders,                           // count of qualifying orders
 *     revenue: { <currency>: amount },  // total per currency (no conversion)
 *     top_variants: [{ variant_id, title, quantity }]  // best sellers by units
 *   }
 *
 * Which orders count ("paid/confirmed", locked this task): an order qualifies
 * when its payment is captured (paid — KHQR orders are created only after a
 * server-verified payment) OR its status is not `canceled` (a placed COD order
 * the team has not cancelled). Equivalently: every order except cancelled ones,
 * plus any captured order. Cancelled orders release stock and never count.
 *
 * Multi-currency (locked this task): revenue is grouped by `currency_code` —
 * summing USD and KHR totals into one scalar would be meaningless, so each
 * currency is reported separately with no exchange-rate conversion. Top variants
 * are ranked by units sold, which is currency-agnostic.
 *
 * `payment_status` is a computed (aggregated) order field and cannot be filtered
 * at the database layer, so the date window is applied in the query and the
 * paid/cancelled qualification is evaluated in code over the in-range set
 * (volume is small for a single-operator shop; orders are paged to be safe).
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

/** Rate limit (security.md): admin endpoints 60/min/admin-session. */
const ADMIN_RATE_LIMIT = { windowMs: 60_000, limit: 60, ttl: 60 } as const

/** Page size when sweeping orders in range (single-shop volumes are small). */
const PAGE_SIZE = 200

/** Number of best-selling variants returned in `top_variants`. */
const TOP_VARIANTS_LIMIT = 10

/** Medusa order status for a cancelled order (excluded unless captured). */
const CANCELED_STATUS = "canceled"

/** Medusa payment status for a fully captured (paid) order. */
const CAPTURED_PAYMENT_STATUS = "captured"

/**
 * Order graph fields: identity/status, currency, total, and line items.
 *
 * Two query.graph gotchas here, both caught live by TEST-06 (the same class
 * as the BACKEND-03 cart-total gotcha):
 *  - `total` is computed from what's loaded — without `summary` (plus the
 *    item price/quantity columns) it silently sums shipping only ($1.50 per
 *    order instead of the real total).
 *  - a line item's `quantity` lives on the `items.detail` pivot
 *    (`order_item`); plain `items.quantity` never resolves through the
 *    cross-module graph, which left `top_variants` empty.
 */
const ORDER_FIELDS = [
  "id",
  "status",
  "payment_status",
  "currency_code",
  "total",
  "summary",
  "created_at",
  "items.variant_id",
  "items.unit_price",
  "items.detail.quantity",
  "items.product_title",
  "items.variant_title",
  "items.title",
]

/**
 * Query schema (security.md: validate before touching the layer). `from`/`to`
 * are optional ISO date/datetime strings; when present they must be parseable
 * (a date-only value like `2026-06-01` is read as midnight UTC). Omitting both
 * reports across all time.
 */
const QuerySchema = z
  .object({
    from: z.string().trim().min(1).max(40).optional(),
    to: z.string().trim().min(1).max(40).optional(),
  })
  .superRefine((val, ctx) => {
    for (const key of ["from", "to"] as const) {
      const raw = val[key]
      if (raw !== undefined && !Number.isFinite(Date.parse(raw))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} must be a valid date`,
        })
      }
    }
    if (
      val.from !== undefined &&
      val.to !== undefined &&
      Number.isFinite(Date.parse(val.from)) &&
      Number.isFinite(Date.parse(val.to)) &&
      Date.parse(val.from) > Date.parse(val.to)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from"],
        message: "from must be on or before to",
      })
    }
  })

interface OrderLineItem {
  variant_id?: string | null
  quantity?: number | null
  /** The `order_item` pivot — where a line's quantity actually resolves. */
  detail?: { quantity?: unknown } | null
  product_title?: string | null
  variant_title?: string | null
  title?: string | null
}

interface OrderView {
  id: string
  status?: string | null
  payment_status?: string | null
  currency_code?: string | null
  total?: unknown
  created_at?: unknown
  items?: OrderLineItem[]
}

/** One aggregated best-seller row. */
interface TopVariant {
  variant_id: string
  title: string
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
    `rl:admin:reports-sales:${actorId}`,
    ADMIN_RATE_LIMIT.windowMs,
    ADMIN_RATE_LIMIT.limit,
    ADMIN_RATE_LIMIT.ttl
  )
}

/** "Paid OR not-cancelled" — the qualification locked for this report. */
function qualifies(order: OrderView): boolean {
  if (order.payment_status === CAPTURED_PAYMENT_STATUS) return true
  return order.status !== CANCELED_STATUS
}

/** Build the best-seller label from product + variant titles. */
function variantLabel(item: OrderLineItem): string {
  const product = item.product_title?.trim()
  const variant = item.variant_title?.trim()
  if (product) return variant ? `${product} — ${variant}` : product
  return (item.title ?? "").trim() || "Unknown variant"
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
  const { from, to } = parsed.data

  const actorId = req.auth_context?.actor_id
  if (!actorId) {
    // /admin/* is already authenticated; this is a defensive guard.
    return fail(res, 401, "unauthorized", requestId)
  }

  if (await isRateLimited(req, actorId)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const createdAt: Record<string, Date> = {}
  if (from !== undefined) createdAt.$gte = new Date(from)
  if (to !== undefined) createdAt.$lte = new Date(to)
  const filters =
    Object.keys(createdAt).length > 0 ? { created_at: createdAt } : undefined

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Sweep the in-range orders, paged, qualifying each in code (payment_status
  // is computed and cannot be filtered at the DB layer).
  let orderCount = 0
  const revenue: Record<string, number> = {}
  const variantQuantities = new Map<
    string,
    { title: string; quantity: number }
  >()

  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      ...(filters ? { filters } : {}),
      pagination: { skip, take: PAGE_SIZE },
    })
    const batch = (orders ?? []) as OrderView[]
    if (batch.length === 0) break

    for (const order of batch) {
      if (!qualifies(order)) continue

      orderCount += 1

      const currency = String(order.currency_code ?? "").toLowerCase() || "usd"
      const total = toNumber(order.total)
      if (Number.isFinite(total)) {
        revenue[currency] = (revenue[currency] ?? 0) + total
      }

      for (const item of order.items ?? []) {
        const variantId = item.variant_id
        // Quantity resolves on the `detail` pivot (see ORDER_FIELDS note);
        // the plain field is kept as a fallback should the graph gain it.
        const quantity = toNumber(item.detail?.quantity ?? item.quantity) || 0
        if (!variantId || quantity <= 0) continue
        const existing = variantQuantities.get(variantId)
        if (existing) {
          existing.quantity += quantity
        } else {
          variantQuantities.set(variantId, {
            title: variantLabel(item),
            quantity,
          })
        }
      }
    }

    if (batch.length < PAGE_SIZE) break
  }

  // Round per-currency revenue to whole cents to avoid float drift.
  for (const currency of Object.keys(revenue)) {
    revenue[currency] =
      Math.round((revenue[currency] + Number.EPSILON) * 100) / 100
  }

  const topVariants: TopVariant[] = Array.from(variantQuantities.entries())
    .map(([variant_id, { title, quantity }]) => ({
      variant_id,
      title,
      quantity,
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, TOP_VARIANTS_LIMIT)

  res.status(200).json({
    from: from ?? null,
    to: to ?? null,
    orders: orderCount,
    revenue,
    top_variants: topVariants,
  })
}
