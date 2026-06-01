/**
 * POST /store/orders/cod — BACKEND-04.
 *
 * Places a cash-on-delivery order from a checkout cart. Unlike the KHQR flow
 * (BACKEND-03/03B) there is no payment window: the order is created immediately
 * and left UNPAID — the shop confirms by phone and collects cash on delivery.
 *
 * Body: `{ cart_id, phone, name, address, note? }`
 *   → `{ order_id, status: "pending_confirmation" }`.
 * Errors: 404 cart_not_found, 400 empty_cart, 409 out_of_stock, 429 rate_limited.
 *
 * Flow (locked decision — the storefront preps the cart's email, shipping
 * address, and shipping method via the standard SDK before calling this route,
 * the same assumption the KHQR flow makes; this endpoint only adds the COD
 * contact details + an unpaid payment, then finalizes):
 *  - pre-check per-variant availability and 409 on any shortfall (a clean error
 *    before any mutation; `completeCartWorkflow` is the authoritative re-check);
 *  - persist the submitted contact (`name/phone/address/note`) onto the cart
 *    metadata — `completeCartWorkflow` copies cart metadata onto the order, so
 *    the single-operator admin sees the delivery details;
 *  - attach a manual (`pp_system_default`) payment session: it is authorized,
 *    never captured server-side, so the order's payment status stays unpaid;
 *  - `completeCartWorkflow` then creates the order, reserves inventory, and
 *    emits `order.placed` (consumed by BACKEND-09 for the Telegram alert).
 *
 * Idempotency: a re-submit for an already-completed cart returns the existing
 * order instead of placing a second one (cart double-tap safety).
 *
 * SECURITY (security.md): the phone is PII — never logged, and rate-limit keys
 * use a hash of it, not the raw value. Body is zod-validated (Cambodian phone
 * regex) before any service call; errors return `{ error, request_id }` only.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { createHash, randomUUID } from "crypto"
import { z } from "zod"
import { ensureInvoiceToken } from "../../../../lib/order-token"

/**
 * Medusa's built-in manual payment provider. A COD payment is *authorized* via
 * this provider but never captured by the server — the shop captures cash on
 * delivery — so the order's payment status remains unpaid (PRD: COD path).
 */
const MANUAL_PAYMENT_PROVIDER_ID = "pp_system_default"

/**
 * Storefront-facing status returned for a freshly placed COD order. It signals
 * "we'll call you to confirm"; the underlying Medusa order status is `pending`.
 * Also stamped onto order metadata so admin/reporting can read it back.
 */
const COD_STATUS = "pending_confirmation"

/** Cambodian phone format (security.md) — the guest-checkout identifier. */
const PHONE_REGEX = /^(\+855|0)[1-9]\d{7,8}$/

/** Body schema (security.md: validate every body with zod before the service). */
const CodSchema = z.object({
  // Medusa cart ids are short ULIDs (`cart_…`); cap length to reject obvious
  // junk before it reaches the query layer.
  cart_id: z.string().min(1).max(100),
  phone: z.string().regex(PHONE_REGEX),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  note: z.string().trim().max(1000).optional(),
})
type CodSchema = z.infer<typeof CodSchema>

/** Rate limits (security.md): 3/min per IP, 10/hour per phone. */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 3, ttl: 60 } as const
const PHONE_RATE_LIMIT = { windowMs: 3_600_000, limit: 10, ttl: 3600 } as const

/** Cart graph fields: metadata, existing payment session, per-variant inventory. */
const CART_FIELDS = [
  "id",
  "completed_at",
  "metadata",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.provider_id",
  "items.id",
  "items.quantity",
  "items.variant_id",
  "items.variant.manage_inventory",
  "items.variant.allow_backorder",
  "items.variant.inventory_items.inventory_item_id",
  "items.variant.inventory_items.required_quantity",
  "items.variant.inventory_items.inventory.location_levels.stocked_quantity",
  "items.variant.inventory_items.inventory.location_levels.reserved_quantity",
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

/**
 * Resolve the client IP from a *trusted* hop only. `X-Forwarded-For` is
 * attacker-controlled, so it is ignored unless `TRUSTED_PROXY_COUNT` is set to
 * the number of reverse proxies in front of the backend (see the KHQR routes
 * for the full rationale). Default 0 = use the direct socket address.
 */
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

/** Stable, non-reversible rate-limit key for a phone (raw PII never cached). */
function phoneKey(phone: string): string {
  return createHash("sha256").update(phone).digest("hex").slice(0, 16)
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

/** Per-IP (3/min) + per-phone (10/hr) fixed-window rate limit. */
async function isRateLimited(
  req: MedusaRequest,
  phone: string
): Promise<boolean> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const ip = getClientIp(req)
  if (
    await overLimit(
      cache,
      `rl:cod:ip:${ip}`,
      IP_RATE_LIMIT.windowMs,
      IP_RATE_LIMIT.limit,
      IP_RATE_LIMIT.ttl
    )
  ) {
    return true
  }
  return overLimit(
    cache,
    `rl:cod:phone:${phoneKey(phone)}`,
    PHONE_RATE_LIMIT.windowMs,
    PHONE_RATE_LIMIT.limit,
    PHONE_RATE_LIMIT.ttl
  )
}

/**
 * True when any line item can't be fully satisfied from stock (honours
 * `manage_inventory=false` and `allow_backorder`). Mirrors the KHQR /start
 * availability check so COD returns the same clean 409 before any mutation.
 */
function hasInsufficientStock(cart: any): boolean {
  for (const item of cart.items ?? []) {
    const variant = item.variant
    if (!variant || variant.manage_inventory === false) continue
    if (variant.allow_backorder === true) continue

    for (const ii of variant.inventory_items ?? []) {
      const perUnit = toNumber(ii.required_quantity)
      const required =
        toNumber(item.quantity) *
        (Number.isFinite(perUnit) && perUnit > 0 ? perUnit : 1)

      let bestAvailable = -Infinity
      for (const lvl of ii.inventory?.location_levels ?? []) {
        const available =
          toNumber(lvl.stocked_quantity) - toNumber(lvl.reserved_quantity)
        if (available > bestAvailable) bestAvailable = available
      }

      if (bestAvailable < required) return true
    }
  }
  return false
}

/** True when the collection already carries a manual (COD) payment session. */
function hasManualSession(cart: any): boolean {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  return sessions.some(
    (s: { provider_id?: string }) =>
      s.provider_id === MANUAL_PAYMENT_PROVIDER_ID
  )
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  // Mint (or reuse) the invoice order-token for a placed order — BACKEND-06.
  // Best-effort: the order is already committed, so a token-mint hiccup must not
  // fail the response; the customer just gets no invoice link this round.
  const issueInvoiceToken = async (oid: string): Promise<string | undefined> => {
    try {
      return await ensureInvoiceToken(req.scope, oid)
    } catch {
      logger.error(
        `[orders/cod] invoice token mint failed (request_id=${requestId})`
      )
      return undefined
    }
  }

  const parsed = CodSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, "invalid_request", requestId)
  }
  const { cart_id, phone, name, address, note } = parsed.data

  if (await isRateLimited(req, phone)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: carts } = await query.graph({
    entity: "cart",
    filters: { id: cart_id },
    fields: CART_FIELDS,
  })
  const cart = carts?.[0]
  if (!cart) {
    return fail(res, 404, "cart_not_found", requestId)
  }

  // Idempotency: if this cart already produced an order, return it rather than
  // placing a second one (a customer double-tapping "Place order").
  const { data: orderCarts } = await query.graph({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { cart_id },
  })
  const existingOrderId = orderCarts?.[0]?.order_id
  if (existingOrderId) {
    const invoiceToken = await issueInvoiceToken(existingOrderId)
    res.json({
      order_id: existingOrderId,
      status: COD_STATUS,
      invoice_token: invoiceToken,
    })
    return
  }

  if (!cart.items?.length) {
    return fail(res, 400, "empty_cart", requestId)
  }

  // Clean 409 before any mutation; completion re-checks authoritatively.
  if (hasInsufficientStock(cart)) {
    return fail(res, 409, "out_of_stock", requestId)
  }

  // Persist the COD contact onto cart metadata — copied onto the order by
  // completeCartWorkflow, so the delivery details ride along with the order.
  const existingMetadata = (cart.metadata ?? {}) as Record<string, unknown>
  await updateCartWorkflow(req.scope).run({
    input: {
      id: cart_id,
      metadata: {
        ...existingMetadata,
        payment_method: "cod",
        confirmation_status: COD_STATUS,
        cod_contact: { name, phone, address, note: note ?? null },
      },
    },
  })

  // Payment collection (reuse the cart's — creating a second throws).
  let paymentCollectionId: string | undefined = cart.payment_collection?.id
  if (!paymentCollectionId) {
    const { result } = await createPaymentCollectionForCartWorkflow(
      req.scope
    ).run({ input: { cart_id } })
    paymentCollectionId = result.id
  }

  // Manual (unpaid) payment session — authorized at completion, never captured.
  if (!hasManualSession(cart)) {
    await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: paymentCollectionId!,
        provider_id: MANUAL_PAYMENT_PROVIDER_ID,
      },
    })
  }

  // Finalize: creates the order, reserves inventory, emits `order.placed`.
  let orderId: string | undefined
  try {
    const { result } = await completeCartWorkflow(req.scope).run({
      input: { id: cart_id },
    })
    orderId = (result as { id?: string })?.id
  } catch (err) {
    const message = err instanceof Error ? err.message : ""
    // A stock shortfall that slipped past the pre-check (concurrent buyer).
    if (/inventory|stock|not enough|reservation/i.test(message)) {
      return fail(res, 409, "out_of_stock", requestId)
    }
    logger.error(
      `[orders/cod] cart completion failed (request_id=${requestId})`
    )
    return fail(res, 500, "order_failed", requestId)
  }

  if (!orderId) {
    logger.error(
      `[orders/cod] cart completion returned no order (request_id=${requestId})`
    )
    return fail(res, 500, "order_failed", requestId)
  }

  const invoiceToken = await issueInvoiceToken(orderId)
  res.json({ order_id: orderId, status: COD_STATUS, invoice_token: invoiceToken })
}
