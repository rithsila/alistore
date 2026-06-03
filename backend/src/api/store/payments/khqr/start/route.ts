/**
 * POST /store/payments/khqr/start — BACKEND-03.
 *
 * Generates a dynamic Bakong KHQR + deeplink for a cart and holds stock during
 * the payment window. Native payment model (PRD §4, locked decision): this
 * creates a `payment_collection` + a Bakong `payment_session` (the custom
 * provider generates the QR) and reserves inventory. The order itself is
 * created at cart completion after server-side verification — BACKEND-03B.
 *
 * Body: `{ cart_id, currency }` → `{ qr, deeplink, reference, expires_at }`.
 * Errors: 409 out-of-stock, 502 proxy/Bakong down.
 *
 * Auth: guest checkout — the (non-guessable) `cart_id` is the capability, the
 * same ownership model as Medusa's native `/store/carts/:id`.
 *
 * Idempotency: repeated calls for the same cart reuse the existing, non-expired
 * Bakong session instead of reserving stock / creating a session again — so a
 * customer double-tapping "Pay" can't stack inventory reservations.
 *
 * SECURITY: never log the cart, qr, reference, or proxy bodies (security.md).
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
import { randomBytes, randomUUID } from "crypto"
import { usdToKhr } from "../../../../../lib/settings"
import { BAKONG_PROVIDER_ID } from "../../../../../modules/bakong-payment"
import {
  generateDeeplink,
  UnsafeProxyUrlError,
} from "../../../../../modules/bakong-payment/lib/proxy"
import type { StartKhqrSchema } from "./middlewares"

/** App name embedded in the Bakong deeplink (shown in banking apps). */
const SOURCE_APP_NAME = "Ali Store"

/**
 * Rate limits (security.md): 5/min per client IP, 20/hour per checkout session.
 * The "session" for guest checkout is the cart — see `getClientIp` for why the
 * IP itself can't be the only key.
 */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 5, ttl: 60 } as const
const SESSION_RATE_LIMIT = { windowMs: 3_600_000, limit: 20, ttl: 3600 } as const

/** Cart graph fields: totals, per-variant inventory, and any existing session. */
const CART_FIELDS = [
  "id",
  "currency_code",
  // `total` is a COMPUTED field: query.graph derives it from the selected
  // line-item amount fields via the cart totals decorator. `items.unit_price`
  // MUST be selected or the decorator has no amounts to sum and `total` comes
  // back as 0 (→ a spurious `invalid_cart_total`). v1 has no promotions and tax
  // is off, so unit_price × quantity is the whole total; add adjustment/tax
  // line fields here if those are ever enabled.
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
  reference: string
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

/** KHQR amount in the selected currency (KHR is whole riel; USD 2dp). */
function resolveAmount(
  currency: StartKhqrSchema["currency"],
  usdTotal: number
): number {
  return currency === "KHR"
    ? usdToKhr(usdTotal)
    : Math.round(usdTotal * 100) / 100
}

/**
 * Resolve the client IP from a *trusted* hop only. `X-Forwarded-For` is
 * attacker-controlled, so it is ignored entirely unless `TRUSTED_PROXY_COUNT`
 * is set to the number of reverse proxies in front of the backend (e.g. 1 for
 * Cloudflare). With N trusted proxies the client IP is the N-th hop back from
 * the socket — the same semantics as Express's `trust proxy = N`. Default 0 =
 * use the direct socket address, so a spoofed XFF can't evade the rate limiter.
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

  // addrs[0] = nearest hop (the socket), last = furthest claimed client.
  const addrs = [socketIp, ...chain.reverse()]
  return addrs[Math.min(trusted, addrs.length - 1)]
}

function getRequestId(req: MedusaRequest): string {
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

/** Hosts allowlisted for the Bakong proxy (security.md SSRF), from env. */
function proxyAllowedHosts(): string[] | undefined {
  const raw = process.env.BAKONG_PROXY_ALLOWED_HOSTS
  if (!raw) return undefined
  return raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
}

/**
 * Cache key mapping a KHQR md5 `reference` → its `cart_id`, read by the status
 * endpoint (BACKEND-03B). The status poll only carries the (non-guessable)
 * reference; this server-side mapping is what lets it resolve the cart to
 * verify and complete. The same key format is used by `/khqr/status`.
 */
function referenceCartKey(reference: string): string {
  return `khqr:cart:${reference}`
}

/**
 * Persist the reference → cart mapping for the status endpoint. TTL covers the
 * QR window plus a few minutes so the final poll (which may flip the status to
 * "expired") can still resolve the cart. Best-effort: the reservation-expiry
 * job (BACKEND-10) is the backstop, so a cache miss never blocks checkout.
 */
async function mapReferenceToCart(
  req: MedusaRequest,
  reference: string,
  cartId: string,
  expiresAt: string | null
): Promise<void> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const ttl = expiresAt
    ? Math.max(60, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000) + 300)
    : 1500
  await cache.set(referenceCartKey(reference), cartId, ttl).catch(() => undefined)
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
      `rl:khqr_start:ip:${ip}`,
      IP_RATE_LIMIT.windowMs,
      IP_RATE_LIMIT.limit,
      IP_RATE_LIMIT.ttl
    )
  ) {
    return true
  }
  return overLimit(
    cache,
    `rl:khqr_start:cart:${cartId}`,
    SESSION_RATE_LIMIT.windowMs,
    SESSION_RATE_LIMIT.limit,
    SESSION_RATE_LIMIT.ttl
  )
}

/**
 * Find an existing Bakong session on the cart that is still usable (has a QR,
 * not past its expiry, and not already cancelled/captured). Reusing it makes
 * repeated `/start` calls idempotent and stops reservations from stacking.
 */
function findActiveBakongSession(cart: any): ActiveSession | null {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  const now = Date.now()
  for (const session of sessions) {
    if (session.provider_id !== BAKONG_PROVIDER_ID) continue
    if (session.status && NON_REUSABLE_STATUSES.has(session.status)) continue

    const data = (session.data ?? {}) as Record<string, unknown>
    const qr = data.qr as string | undefined
    const reference = data.reference as string | undefined
    const expiresAt = data.expires_at as string | undefined
    if (!qr || !reference || !expiresAt) continue
    if (Date.parse(expiresAt) <= now) continue // expired — make a fresh one

    return { qr, reference, expiresAt }
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
        description: "KHQR payment hold",
      })
    }
  }

  return { reservations, insufficient }
}

export async function POST(
  req: MedusaRequest<StartKhqrSchema>,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const { cart_id, currency } = req.validatedBody

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

  /**
   * Resolve the deeplink for a QR via the in-Cambodia proxy and respond.
   * Best-effort in sandbox: when the proxy isn't configured (creds are
   * deploy-time secrets) the QR alone is returned. When it IS configured but
   * the call fails — or the proxy URL is unsafe — that's a 502 per the
   * contract, logged server-side (without the QR / token / reference).
   */
  const respondWithDeeplink = async (
    qr: string,
    reference: string,
    expiresAt: string | null
  ): Promise<void> => {
    // Record reference → cart so /khqr/status can resolve this cart later.
    await mapReferenceToCart(req, reference, cart_id, expiresAt)

    const proxyBaseUrl = process.env.BAKONG_PROXY_URL
    const token = process.env.BAKONG_TOKEN
    if (!proxyBaseUrl || !token) {
      res.json({ qr, deeplink: null, reference, expires_at: expiresAt })
      return
    }
    try {
      const deeplink = await generateDeeplink({
        proxyBaseUrl,
        token,
        qr,
        sourceInfo: { appName: SOURCE_APP_NAME },
        allowedHosts: proxyAllowedHosts(),
      })
      res.json({ qr, deeplink, reference, expires_at: expiresAt })
    } catch (err) {
      if (err instanceof UnsafeProxyUrlError) {
        logger.error(
          `[khqr/start] BAKONG_PROXY_URL failed SSRF validation (request_id=${requestId})`
        )
      } else {
        logger.warn(
          `[khqr/start] Bakong proxy unavailable (request_id=${requestId})`
        )
      }
      fail(res, 502, "payment_gateway_unavailable", requestId)
    }
  }

  // Idempotency: reuse an existing, non-expired Bakong session for this cart
  // rather than reserving stock and creating a session again (H2).
  const existing = findActiveBakongSession(cart)
  if (existing) {
    return respondWithDeeplink(
      existing.qr,
      existing.reference,
      existing.expiresAt
    )
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
  // so we can release them if session creation fails — otherwise the stock is
  // orphaned (held with no session) until the expiry job (M1 / BACKEND-10).
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

  // Unique bill number per QR (also keeps each md5 reference distinct).
  const billNumber = `ALI${randomBytes(5).toString("hex")}`

  // Bakong payment session — the provider generates the QR into session.data.
  let session: { data?: Record<string, unknown> }
  try {
    const { result } = await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: paymentCollectionId!,
        provider_id: BAKONG_PROVIDER_ID,
        data: {
          khqrAmount: resolveAmount(currency, usdTotal),
          khqrCurrency: currency,
          billNumber,
        },
      },
    })
    session = result as { data?: Record<string, unknown> }
  } catch {
    await releaseReservations()
    logger.error(
      `[khqr/start] payment session creation failed (request_id=${requestId})`
    )
    return fail(res, 500, "qr_generation_failed", requestId)
  }

  const sessionData = (session.data ?? {}) as Record<string, unknown>
  const qr = sessionData.qr as string | undefined
  const reference = sessionData.reference as string | undefined
  const expiresAt = (sessionData.expires_at as string | undefined) ?? null
  if (!qr || !reference) {
    await releaseReservations()
    logger.error(
      `[khqr/start] QR missing from session data (request_id=${requestId})`
    )
    return fail(res, 500, "qr_generation_failed", requestId)
  }

  return respondWithDeeplink(qr, reference, expiresAt)
}
