/**
 * POST /store/payments/khpay/start — KHPAY-02.
 *
 * Starts a KHPAY Bakong KHQR payment for a cart and holds stock during the
 * payment window. Mirrors the payway start route (PAYWAY-03) exactly — same
 * native payment model (payment_collection + payment_session; the order is
 * created at cart completion after server-side verification), same response
 * contract — but the EMV QR comes from KHPAY's `POST /bakong/generate` (the
 * provider's `initiatePayment` makes that one outbound call). KHPAY's Bakong
 * rail returns no banking-app deeplink, so `deeplink` is always null (the pay
 * screen renders its deeplink CTA only when one exists).
 *
 * Body: `{ cart_id, currency }` → `{ qr, deeplink: null, reference, expires_at }`
 * (`reference` is the KHPAY `bk_…` transaction_id). Errors: 409 out-of-stock,
 * 502 KHPAY down/rejecting.
 *
 * Auth: guest checkout — the (non-guessable) `cart_id` is the capability, the
 * same ownership model as Medusa's native `/store/carts/:id`.
 *
 * Idempotency: repeated calls for the same cart reuse the existing,
 * non-expired KHPAY session instead of reserving stock / generating again —
 * a customer double-tapping "Pay" can't stack reservations or duplicate
 * KHPAY transactions.
 *
 * SECURITY: never log the cart, qr, transaction_id, or KHPAY bodies
 * (security.md).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  createReservationsWorkflow,
  deleteReservationsWorkflow,
} from "@medusajs/medusa/core-flows"
import { KHPAY_PROVIDER_ID } from "../../../../../modules/khpay-payment"
import { UnsafeKhpayUrlError } from "../../../../../modules/khpay-payment/lib/client"
import {
  fail,
  getClientIp,
  getRequestId,
  overLimit,
  txnCartKey,
  type CacheModule,
} from "../shared"
import type { StartKhpaySchema } from "./middlewares"

/** Rate limits (security.md): 5/min per client IP, 20/hour per cart. */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 5, ttl: 60 } as const
const SESSION_RATE_LIMIT = { windowMs: 3_600_000, limit: 20, ttl: 3600 } as const

/** Cart graph fields: totals, per-variant inventory, and any existing session. */
const CART_FIELDS = [
  "id",
  "currency_code",
  // `total` is COMPUTED: query.graph derives it from the selected line-item
  // amount fields — `items.unit_price` MUST be selected or `total` comes back
  // as 0 (see khqr/start for the full gotcha note).
  "total",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.provider_id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.data",
  "items.id",
  "items.quantity",
  "items.unit_price",
  "items.variant_id",
  "items.variant.manage_inventory",
  "items.variant.allow_backorder",
  "items.variant.inventory_items.inventory_item_id",
  "items.variant.inventory_items.required_quantity",
  "items.variant.inventory_items.inventory.location_levels.location_id",
  "items.variant.inventory_items.inventory.location_levels.stocked_quantity",
  "items.variant.inventory_items.inventory.location_levels.reserved_quantity",
]

/** Payment-session statuses that must NOT be reused for a fresh QR. */
const NON_REUSABLE_STATUSES = new Set([
  "authorized",
  "captured",
  "canceled",
  "error",
])

interface ReservationInput {
  inventory_item_id: string
  location_id: string
  quantity: number
  line_item_id: string
  description: string
}

interface ActiveSession {
  qr: string
  transactionId: string
  expiresAt: string | null
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

/** Per-IP (5/min) + per-cart/session (20/hr) fixed-window rate limit. */
async function isRateLimited(
  req: MedusaRequest,
  cartId: string
): Promise<boolean> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const ip = getClientIp(req)
  if (
    await overLimit(
      cache,
      `rl:khpay_start:ip:${ip}`,
      IP_RATE_LIMIT.windowMs,
      IP_RATE_LIMIT.limit,
      IP_RATE_LIMIT.ttl
    )
  ) {
    return true
  }
  return overLimit(
    cache,
    `rl:khpay_start:cart:${cartId}`,
    SESSION_RATE_LIMIT.windowMs,
    SESSION_RATE_LIMIT.limit,
    SESSION_RATE_LIMIT.ttl
  )
}

/**
 * Persist the transaction_id → cart mapping for the status endpoint. TTL
 * covers the payment window plus a few minutes so the final poll can still
 * resolve the cart. Best-effort: the reservation-expiry job is the backstop.
 */
async function mapTxnToCart(
  req: MedusaRequest,
  transactionId: string,
  cartId: string,
  expiresAt: string | null
): Promise<void> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const ttl = expiresAt
    ? Math.max(60, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000) + 300)
    : 1500
  await cache.set(txnCartKey(transactionId), cartId, ttl).catch(() => undefined)
}

/**
 * Find an existing KHPAY session on the cart that is still usable (has a QR,
 * not past its expiry, not already cancelled/captured). Reusing it makes
 * repeated `/start` calls idempotent — no stacked reservations, no duplicate
 * KHPAY transactions.
 */
function findActiveKhpaySession(cart: any): ActiveSession | null {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  const now = Date.now()
  for (const session of sessions) {
    if (session.provider_id !== KHPAY_PROVIDER_ID) continue
    if (session.status && NON_REUSABLE_STATUSES.has(session.status)) continue

    const data = (session.data ?? {}) as Record<string, unknown>
    const qr = data.qr as string | undefined
    const transactionId = data.transaction_id as string | undefined
    const expiresAt = data.expires_at as string | undefined
    if (!qr || !transactionId || !expiresAt) continue
    if (Date.parse(expiresAt) <= now) continue // expired — make a fresh one

    return { qr, transactionId, expiresAt }
  }
  return null
}

/**
 * Build reservations from the cart and detect out-of-stock line items.
 * Skips variants that don't manage inventory; honours backorder.
 */
function planReservations(cart: any): {
  reservations: ReservationInput[]
  insufficient: boolean
} {
  const reservations: ReservationInput[] = []
  let insufficient = false

  for (const item of cart.items ?? []) {
    const variant = item.variant
    if (!variant || variant.manage_inventory === false) continue

    for (const ii of variant.inventory_items ?? []) {
      const perUnit = toNumber(ii.required_quantity)
      const required =
        toNumber(item.quantity) *
        (Number.isFinite(perUnit) && perUnit > 0 ? perUnit : 1)

      let best: any = null
      let bestAvailable = -Infinity
      for (const lvl of ii.inventory?.location_levels ?? []) {
        const available =
          toNumber(lvl.stocked_quantity) - toNumber(lvl.reserved_quantity)
        if (available > bestAvailable) {
          bestAvailable = available
          best = lvl
        }
      }

      if (
        !best ||
        (bestAvailable < required && variant.allow_backorder !== true)
      ) {
        insufficient = true
        continue
      }

      reservations.push({
        inventory_item_id: ii.inventory_item_id,
        location_id: best.location_id,
        quantity: required,
        line_item_id: item.id,
        description: "KHQR payment hold (KHPAY)",
      })
    }
  }

  return { reservations, insufficient }
}

export async function POST(
  req: MedusaRequest<StartKhpaySchema>,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  // `currency` stays in the contract (the storefront sends the display toggle)
  // but KHPAY accepts USD only — confirmed live ("currency must be USD",
  // VALIDATION_ERROR). The QR is always charged in USD (the cart's base
  // denomination); KHR remains a display-layer concern.
  const { cart_id } = req.validatedBody

  if (await isRateLimited(req, cart_id)) {
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
  if (!cart.items?.length) {
    return fail(res, 400, "empty_cart", requestId)
  }

  // Amount in the selected currency. Cart is USD-denominated (SETUP-04 locked
  // USD as the store default); KHR is derived via USD_KHR_RATE, whole riel.
  const usdTotal = toNumber(cart.total)
  if (!Number.isFinite(usdTotal) || usdTotal <= 0) {
    return fail(res, 400, "invalid_cart_total", requestId)
  }

  const respond = async (session: ActiveSession): Promise<void> => {
    // Record transaction_id → cart so /khpay/status can resolve this cart.
    await mapTxnToCart(req, session.transactionId, cart_id, session.expiresAt)
    res.json({
      qr: session.qr,
      // KHPAY's Bakong rail has no banking-app deeplink; the contract keeps
      // the field (nullable) so the pay screen is unchanged.
      deeplink: null,
      reference: session.transactionId,
      expires_at: session.expiresAt,
    })
  }

  // Idempotency: reuse an existing, non-expired KHPAY session for this cart.
  const existing = findActiveKhpaySession(cart)
  if (existing) {
    return respond(existing)
  }

  // Availability + stock hold for the payment window.
  const { reservations, insufficient } = planReservations(cart)
  if (insufficient) {
    return fail(res, 409, "out_of_stock", requestId)
  }

  // Payment collection (reuse the cart's existing one — creating a second
  // throws in core-flows).
  let paymentCollectionId: string | undefined = cart.payment_collection?.id
  if (!paymentCollectionId) {
    const { result } = await createPaymentCollectionForCartWorkflow(
      req.scope
    ).run({ input: { cart_id } })
    paymentCollectionId = result.id
  }

  // Reserve first, then create the session. Track the created reservation ids
  // so we can release them if the KHPAY generate fails — otherwise the stock
  // is orphaned (held with no session) until the expiry job.
  let createdReservationIds: string[] = []
  if (reservations.length > 0) {
    const { result } = await createReservationsWorkflow(req.scope).run({
      input: { reservations },
    })
    createdReservationIds = ((result ?? []) as Array<{ id: string }>)
      .map((r) => r.id)
      .filter(Boolean)
  }

  const releaseReservations = async (): Promise<void> => {
    if (createdReservationIds.length === 0) return
    await deleteReservationsWorkflow(req.scope)
      .run({ input: { ids: createdReservationIds } })
      .catch(() => undefined) // best-effort cleanup; expiry job is the backstop
  }

  // KHPAY payment session — the provider's initiatePayment performs the
  // outbound /bakong/generate call and stores qr/transaction_id on session.data.
  let session: { data?: Record<string, unknown> }
  try {
    const { result } = await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: paymentCollectionId!,
        provider_id: KHPAY_PROVIDER_ID,
        data: {
          khpayAmount: Math.round(usdTotal * 100) / 100,
          khpayCurrency: "USD",
        },
      },
    })
    session = result as { data?: Record<string, unknown> }
  } catch (err) {
    await releaseReservations()
    if (err instanceof UnsafeKhpayUrlError) {
      logger.error(
        `[khpay/start] KHPAY_BASE_URL failed SSRF validation (request_id=${requestId})`
      )
    } else {
      // KHPAY rejected or was unreachable — gateway failure, not our 500.
      logger.warn(
        `[khpay/start] KHPAY generate failed (request_id=${requestId})`
      )
    }
    return fail(res, 502, "payment_gateway_unavailable", requestId)
  }

  const sessionData = (session.data ?? {}) as Record<string, unknown>
  const qr = sessionData.qr as string | undefined
  const transactionId = sessionData.transaction_id as string | undefined
  const expiresAt = (sessionData.expires_at as string | undefined) ?? null
  if (!qr || !transactionId) {
    await releaseReservations()
    logger.error(
      `[khpay/start] QR missing from session data (request_id=${requestId})`
    )
    return fail(res, 500, "qr_generation_failed", requestId)
  }

  return respond({ qr, transactionId, expiresAt })
}
