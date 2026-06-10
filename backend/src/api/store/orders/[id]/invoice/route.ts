/**
 * GET /store/orders/:id/invoice?token= — BACKEND-06.
 *
 * Returns a printable HTML invoice for one order. Auth is the per-order invoice
 * token (security.md "Invoice & order-token"): minted at order creation
 * (BACKEND-04 COD / BACKEND-03B KHQR finalize), stored on `order.metadata`, and
 * supplied back here as `?token=`. The token is compared in constant time
 * (`verifyInvoiceToken`); a missing/wrong/expired/revoked token → 403, an
 * unknown order → 404.
 *
 * This route also inherits Medusa's store publishable-key requirement (applied
 * to the whole `/store` namespace), so the storefront opens it via the JS SDK
 * (which attaches the key) — wiring is INTEGRATION-07's concern, not this task.
 *
 * SECURITY: every dynamic value is HTML-escaped in the template; the response
 * is `no-store` (it carries order details) and `nosniff`. A light per-IP rate
 * limit blunts token-guessing on top of the token's 256-bit entropy.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import { z } from "zod"
import { verifyInvoiceToken } from "../../../../../lib/order-token"
import {
  getInvoiceConfig,
  renderInvoiceHtml,
  type InvoiceContact,
  type InvoiceLineItem,
  type InvoiceOrder,
} from "../../../../../lib/invoice-template"

/** Path + query validation (security.md: validate before touching the layer). */
const ParamsSchema = z.object({ id: z.string().min(1).max(100) })
const QuerySchema = z.object({ token: z.string().min(1).max(200) })

/** Defense-in-depth per-IP limit (token brute-force is already infeasible). */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 60, ttl: 60 } as const

/**
 * Order graph fields: identity, totals, line items, and the token metadata.
 *
 * Two query.graph gotchas here, both caught live by TEST-07 (the same class
 * TEST-06 caught in the BACKEND-08 sales report):
 *  - computed money fields (`item_total`, `items.total`) are derived from
 *    what's loaded — without `summary` they silently resolve to 0, leaving
 *    the invoice with $0.00 lines and a shipping-only total.
 *  - a line item's `quantity` lives on the `items.detail` pivot
 *    (`order_item`); plain `items.quantity` never resolves through the
 *    cross-module graph, which rendered every quantity as 0.
 */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "currency_code",
  "metadata",
  "item_total",
  "shipping_total",
  "summary",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.quantity",
  "items.detail.quantity",
  "items.unit_price",
  "items.total",
]

type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
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

function getRequestId(req: MedusaRequest): string {
  const header = req.headers["x-request-id"]
  if (typeof header === "string" && header.length > 0) return header
  return randomUUID()
}

/** Trusted-hop client IP (see the COD/KHQR routes for the X-Forwarded-For rationale). */
function getClientIp(req: MedusaRequest): string {
  const socketIp = req.socket?.remoteAddress || req.ip || "unknown"
  const trusted = Math.max(
    0,
    Math.floor(Number(process.env.TRUSTED_PROXY_COUNT) || 0)
  )
  if (trusted === 0) return socketIp

  const fwd = req.headers["x-forwarded-for"]
  const chain = (Array.isArray(fwd) ? fwd.join(",") : fwd ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (chain.length === 0) return socketIp

  const addrs = [socketIp, ...chain.reverse()]
  return addrs[Math.min(trusted, addrs.length - 1)]
}

function fail(
  res: MedusaResponse,
  status: number,
  error: string,
  requestId: string
): void {
  res.status(status).json({ error, request_id: requestId })
}

/** Increment one fixed-window counter; returns true when already over limit. */
async function overLimit(
  cache: CacheModule,
  keyPrefix: string,
  windowMs: number,
  limit: number,
  ttl: number
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / windowMs)
  const key = `${keyPrefix}:${bucket}`
  const current = (await cache.get<number>(key)) ?? 0
  if (current >= limit) return true
  await cache.set(key, current + 1, ttl)
  return false
}

/** Build the line-item label from the product + variant titles. */
function lineTitle(item: {
  product_title?: string | null
  variant_title?: string | null
  title?: string | null
}): string {
  const product = item.product_title?.trim()
  const variant = item.variant_title?.trim()
  if (product) return variant ? `${product} — ${variant}` : product
  return (item.title ?? "").trim() || "Item"
}

/** Pull the optional buyer block from COD contact metadata (KHQR orders omit it). */
function readContact(
  metadata: Record<string, unknown>
): InvoiceContact | undefined {
  const contact = metadata.cod_contact
  if (!contact || typeof contact !== "object") return undefined
  const c = contact as Record<string, unknown>
  const pick = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v : undefined
  const result: InvoiceContact = {
    name: pick(c.name),
    phone: pick(c.phone),
    address: pick(c.address),
  }
  if (!result.name && !result.phone && !result.address) return undefined
  return result
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)

  const params = ParamsSchema.safeParse(req.params)
  const queryParams = QuerySchema.safeParse(req.query)
  if (!params.success || !queryParams.success) {
    return fail(res, 400, "invalid_request", requestId)
  }
  const { id } = params.data
  const { token } = queryParams.data

  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  if (
    await overLimit(
      cache,
      `rl:invoice:ip:${getClientIp(req)}`,
      IP_RATE_LIMIT.windowMs,
      IP_RATE_LIMIT.limit,
      IP_RATE_LIMIT.ttl
    )
  ) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    filters: { id },
  })
  const order = orders?.[0]
  if (!order) {
    return fail(res, 404, "order_not_found", requestId)
  }

  const metadata = (order.metadata ?? {}) as Record<string, unknown>
  if (!verifyInvoiceToken(metadata, token)) {
    return fail(res, 403, "invalid_token", requestId)
  }

  const items: InvoiceLineItem[] = (order.items ?? []).map((item: any) => ({
    title: lineTitle(item),
    // Quantity resolves on the `detail` pivot (see ORDER_FIELDS note); the
    // plain field is kept as a fallback should the graph gain it.
    quantity: toNumber(item.detail?.quantity ?? item.quantity) || 0,
    unitPrice: toNumber(item.unit_price),
    lineTotal: toNumber(item.total),
  }))

  const createdAt =
    order.created_at instanceof Date
      ? order.created_at.toISOString()
      : String(order.created_at ?? "")

  const invoiceOrder: InvoiceOrder = {
    displayId: Number(order.display_id) || 0,
    createdAt,
    currencyCode: String(order.currency_code ?? "usd").toUpperCase(),
    items,
    itemsSubtotal: toNumber(order.item_total),
    deliveryFee: toNumber(order.shipping_total),
    contact: readContact(metadata),
  }

  const html = renderInvoiceHtml(invoiceOrder, getInvoiceConfig())

  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("X-Content-Type-Options", "nosniff")
  res.send(html)
}
