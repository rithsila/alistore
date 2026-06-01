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
 * SECURITY: never log the cart, qr, reference, or proxy bodies (security.md).
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  createReservationsWorkflow,
} from "@medusajs/medusa/core-flows"
import { randomBytes, randomUUID } from "crypto"
import { usdToKhr } from "../../../../../lib/settings"
import { BAKONG_PROVIDER_ID } from "../../../../../modules/bakong-payment"
import { generateDeeplink } from "../../../../../modules/bakong-payment/lib/proxy"
import type { StartKhqrSchema } from "./middlewares"

/** App name embedded in the Bakong deeplink (shown in banking apps). */
const SOURCE_APP_NAME = "Ali Store"

/** Rate limits for this endpoint (security.md): 5/min and 20/hour per IP. */
const RATE_LIMITS = [
  { suffix: "m", windowMs: 60_000, limit: 5, ttl: 60 },
  { suffix: "h", windowMs: 3_600_000, limit: 20, ttl: 3600 },
] as const

/** Cart graph fields: totals + per-variant inventory for availability/reserve. */
const CART_FIELDS = [
  "id",
  "currency_code",
  "total",
  "payment_collection.id",
  "items.id",
  "items.quantity",
  "items.variant_id",
  "items.variant.manage_inventory",
  "items.variant.allow_backorder",
  "items.variant.inventory_items.inventory_item_id",
  "items.variant.inventory_items.required_quantity",
  "items.variant.inventory_items.inventory.location_levels.location_id",
  "items.variant.inventory_items.inventory.location_levels.stocked_quantity",
  "items.variant.inventory_items.inventory.location_levels.reserved_quantity",
]

interface ReservationInput {
  inventory_item_id: string
  location_id: string
  quantity: number
  line_item_id: string
  description: string
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

function getClientIp(req: MedusaRequest): string {
  const fwd = req.headers["x-forwarded-for"]
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim()
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0]
  return req.ip || req.socket?.remoteAddress || "unknown"
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

/** Fixed-window rate limiter backed by the cache module (Redis in prod). */
async function isRateLimited(req: MedusaRequest): Promise<boolean> {
  const cache = req.scope.resolve(Modules.CACHE) as {
    get<T>(key: string): Promise<T | null>
    set(key: string, data: unknown, ttl?: number): Promise<void>
  }
  const ip = getClientIp(req)
  const now = Date.now()

  for (const w of RATE_LIMITS) {
    const bucket = Math.floor(now / w.windowMs)
    const key = `rl:khqr_start:${ip}:${w.suffix}${bucket}`
    const current = (await cache.get<number>(key)) ?? 0
    if (current >= w.limit) return true
    await cache.set(key, current + 1, w.ttl)
  }
  return false
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

  if (await isRateLimited(req)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const { cart_id, currency } = req.validatedBody
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
  const khqrAmount =
    currency === "KHR" ? usdToKhr(usdTotal) : Math.round(usdTotal * 100) / 100

  // Availability + stock hold for the payment window.
  const { reservations, insufficient } = planReservations(cart)
  if (insufficient) {
    return fail(res, 409, "out_of_stock", requestId)
  }
  if (reservations.length > 0) {
    await createReservationsWorkflow(req.scope).run({
      input: { reservations },
    })
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

  // Unique bill number per QR (also keeps each md5 reference distinct).
  const billNumber = `ALI${randomBytes(5).toString("hex")}`

  // Bakong payment session — the provider generates the QR into session.data.
  const { result: session } = await createPaymentSessionsWorkflow(
    req.scope
  ).run({
    input: {
      payment_collection_id: paymentCollectionId!,
      provider_id: BAKONG_PROVIDER_ID,
      data: { khqrAmount, khqrCurrency: currency, billNumber },
    },
  })

  const sessionData = (session.data ?? {}) as Record<string, unknown>
  const qr = sessionData.qr as string | undefined
  const reference = sessionData.reference as string | undefined
  const expiresAt = sessionData.expires_at as string | undefined
  if (!qr || !reference) {
    return fail(res, 500, "qr_generation_failed", requestId)
  }

  // Deeplink via the in-Cambodia proxy. Best-effort in sandbox: when the proxy
  // isn't configured (creds are deploy-time secrets) the QR alone is returned;
  // when it IS configured but unreachable, that's a 502 per the contract.
  let deeplink: string | null = null
  const proxyBaseUrl = process.env.BAKONG_PROXY_URL
  const token = process.env.BAKONG_TOKEN
  if (proxyBaseUrl && token) {
    try {
      deeplink = await generateDeeplink({
        proxyBaseUrl,
        token,
        qr,
        sourceInfo: { appName: SOURCE_APP_NAME },
        allowedHosts: proxyAllowedHosts(),
      })
    } catch {
      // Proxy/Bakong down or misconfigured — never leak details to the client.
      return fail(res, 502, "payment_gateway_unavailable", requestId)
    }
  }

  res.json({ qr, deeplink, reference, expires_at: expiresAt })
}
