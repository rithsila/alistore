/**
 * GET /store/payments/khqr/status?reference= — BACKEND-03B.
 *
 * Confirms a Bakong KHQR payment and finalizes the order. The storefront polls
 * this while the customer pays; it returns `{ status: pending | paid | expired }`.
 *
 * Flow (PRD §4 locked decision — the order is created at cart completion, not
 * at /start):
 *  - resolve the cart from the (non-guessable) `reference` via the server-side
 *    mapping written by /start (the reference is the capability — same model as
 *    Medusa's native cart routes);
 *  - if an order already exists for the cart → `paid` (idempotent short-circuit);
 *  - if the QR window has passed → `expired`, and the /start reservation is
 *    released;
 *  - otherwise SERVER-SIDE verify by md5/reference through the in-Cambodia proxy
 *    (never trust a client-reported status — security.md "Payments"). On a
 *    confirmed payment: release the /start reservation, then `completeCart` to
 *    create the order (which re-reserves + authorizes/captures via the Bakong
 *    provider's own server verify), then write one `stock_movement(type=out)`.
 *
 * Reservation reconciliation: the /start reservation is released BEFORE
 * `completeCartWorkflow` runs, because completion creates its own order
 * reservations — releasing first avoids double-holding (and oversell) stock.
 *
 * SECURITY: `reference` and the proxy token/bodies are sensitive and never
 * logged; `paid` is set only after the server verify; verify is cached ≥3s and
 * rate-limited per reference.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { overLimitAtomic } from "../../../../../lib/rate-limit"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  deleteReservationsByLineItemsWorkflow,
} from "@medusajs/medusa/core-flows"
import { randomUUID } from "crypto"
import { z } from "zod"
import { ensureInvoiceToken } from "../../../../../lib/order-token"
import { BAKONG_PROVIDER_ID } from "../../../../../modules/bakong-payment"
import {
  checkTransactionByMd5,
  UnsafeProxyUrlError,
} from "../../../../../modules/bakong-payment/lib/proxy"
import { STOCK_MOVEMENT_MODULE } from "../../../../../modules/stock-movement"

/** The reference is `md5(qr)` — 32 lowercase hex chars. */
const ReferenceSchema = z.object({
  reference: z.string().regex(/^[a-f0-9]{32}$/),
})

/**
 * Rate limits (security.md): 60/min and 120/hour per reference (the guest's
 * polling key), plus a 60/min per-IP backstop. Fixed-window via the cache.
 */
const REF_PER_MIN = { windowMs: 60_000, limit: 60, ttl: 60 } as const
const REF_PER_HOUR = { windowMs: 3_600_000, limit: 120, ttl: 3600 } as const
const IP_PER_MIN = { windowMs: 60_000, limit: 60, ttl: 60 } as const

/** Cache verify result ≥3s server-side (security.md). */
const VERIFY_PENDING_TTL = 3
const VERIFY_PAID_TTL = 30

/** Reason recorded on the automatic stock-out ledger row. */
const STOCK_OUT_REASON = "KHQR payment"
const STOCK_OUT_ACTOR = "system"

type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
}

type QueryGraph = {
  graph<T = unknown>(config: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
  }): Promise<{ data: T[] }>
}

/** Minimal view of the stock-movement module's auto-generated CRUD. */
type StockMovementService = {
  listStockMovements(
    filters: Record<string, unknown>
  ): Promise<Array<{ id: string }>>
  createStockMovements(
    data: Array<{
      variant_id: string
      type: "in" | "out" | "adjust"
      quantity: number
      reason: string
      order_id: string
      created_by: string
    }>
  ): Promise<unknown>
}

interface CartItem {
  id: string
  variant_id?: string | null
  quantity?: number | null
}

interface PaymentSession {
  provider_id?: string
  status?: string
  data?: Record<string, unknown>
}

interface CartView {
  id: string
  completed_at?: string | null
  items?: CartItem[]
  payment_collection?: { payment_sessions?: PaymentSession[] }
}

const CART_FIELDS = [
  "id",
  "completed_at",
  "items.id",
  "items.variant_id",
  "items.quantity",
  "payment_collection.payment_sessions.provider_id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.data",
]

function referenceCartKey(reference: string): string {
  return `khqr:cart:${reference}`
}

function verifyCacheKey(reference: string): string {
  return `khqr:verify:${reference}`
}

function getRequestId(req: MedusaRequest): string {
  const header = req.headers["x-request-id"]
  if (typeof header === "string" && header.length > 0) return header
  return randomUUID()
}

/** Trusted-hop client IP (see /start for the X-Forwarded-For rationale). */
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

/** Send a status body and return void (keeps the handler's `Promise<void>`). */
function ok(res: MedusaResponse, body: Record<string, unknown>): void {
  res.json(body)
}

/** Hosts allowlisted for the Bakong proxy (security.md SSRF), from env. */
function proxyAllowedHosts(): string[] | undefined {
  const raw = process.env.BAKONG_PROXY_ALLOWED_HOSTS
  if (!raw) return undefined
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  return hosts.length > 0 ? hosts : undefined
}

/** Increment one fixed-window counter; returns true when already over limit. */
async function overLimit(
  _cache: CacheModule,
  keyPrefix: string,
  windowMs: number,
  limit: number,
  ttl: number
): Promise<boolean> {
  // C-02 fix: atomic fixed-window counter (Redis INCR in prod, race-free
  // in-process fallback in dev). `_cache` is retained for call-site
  // compatibility but no longer used. See src/lib/rate-limit.ts.
  return overLimitAtomic(keyPrefix, windowMs, limit, ttl)
}

async function isRateLimited(
  cache: CacheModule,
  ip: string,
  reference: string
): Promise<boolean> {
  if (
    await overLimit(
      cache,
      `rl:khqr_status:ip:${ip}`,
      IP_PER_MIN.windowMs,
      IP_PER_MIN.limit,
      IP_PER_MIN.ttl
    )
  ) {
    return true
  }
  if (
    await overLimit(
      cache,
      `rl:khqr_status:refmin:${reference}`,
      REF_PER_MIN.windowMs,
      REF_PER_MIN.limit,
      REF_PER_MIN.ttl
    )
  ) {
    return true
  }
  return overLimit(
    cache,
    `rl:khqr_status:refhr:${reference}`,
    REF_PER_HOUR.windowMs,
    REF_PER_HOUR.limit,
    REF_PER_HOUR.ttl
  )
}

/** Locate the Bakong session on the cart that matches this reference. */
function findBakongSession(
  cart: CartView,
  reference: string
): PaymentSession | null {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  for (const session of sessions) {
    if (session.provider_id !== BAKONG_PROVIDER_ID) continue
    if ((session.data?.reference as string | undefined) === reference) {
      return session
    }
  }
  return null
}

/** Release the reservation /start created for these cart line items. */
async function releaseStartReservation(
  req: MedusaRequest,
  lineItemIds: string[]
): Promise<void> {
  if (lineItemIds.length === 0) return
  await deleteReservationsByLineItemsWorkflow(req.scope)
    .run({ input: { ids: lineItemIds } })
    .catch(() => undefined) // best-effort; expiry job (BACKEND-10) is the backstop
}

/**
 * Write one automatic stock-out ledger row per line item, once per order.
 * Idempotent: skips if out-movements already exist for the order, so retried
 * polls (cart completion is idempotent) don't double-count.
 *
 * NOTE (BACKEND-03B decision): written inline via the stock-movement module's
 * CRUD. BACKEND-07 introduces a shared stock-out service method; this is to be
 * reconciled to use it then.
 */
async function writeStockOut(
  req: MedusaRequest,
  orderId: string,
  items: CartItem[]
): Promise<void> {
  const svc = req.scope.resolve<StockMovementService>(STOCK_MOVEMENT_MODULE)

  const existing = await svc.listStockMovements({
    order_id: orderId,
    type: "out",
  })
  if (existing?.length) return

  const rows = items
    .filter((it) => it.variant_id && Number(it.quantity) > 0)
    .map((it) => ({
      variant_id: it.variant_id as string,
      type: "out" as const,
      quantity: Number(it.quantity),
      reason: STOCK_OUT_REASON,
      order_id: orderId,
      created_by: STOCK_OUT_ACTOR,
    }))
  if (rows.length === 0) return

  await svc.createStockMovements(rows)
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  // Mint (or reuse) the invoice order-token for the finalized order — BACKEND-06.
  // Best-effort: the payment is already confirmed, so a token-mint hiccup must
  // not turn a `paid` response into an error; the next poll retries (idempotent).
  const issueInvoiceToken = async (oid: string): Promise<string | undefined> => {
    try {
      return await ensureInvoiceToken(req.scope, oid)
    } catch {
      logger.error(
        `[khqr/status] invoice token mint failed (request_id=${requestId})`
      )
      return undefined
    }
  }

  const parsed = ReferenceSchema.safeParse(req.query)
  if (!parsed.success) {
    return fail(res, 400, "invalid_reference", requestId)
  }
  const { reference } = parsed.data

  const cache = req.scope.resolve(Modules.CACHE) as CacheModule

  if (await isRateLimited(cache, getClientIp(req), reference)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  // Resolve the cart from the reference (mapping written by /start).
  const cartId = await cache.get<string>(referenceCartKey(reference))
  if (!cartId) {
    return fail(res, 404, "reference_not_found", requestId)
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const { data: carts } = await query.graph<CartView>({
    entity: "cart",
    fields: CART_FIELDS,
    filters: { id: cartId },
  })
  const cart = carts?.[0]
  if (!cart) {
    return fail(res, 404, "reference_not_found", requestId)
  }

  // Confirm the reference really belongs to a Bakong session on this cart.
  const session = findBakongSession(cart, reference)
  if (!session) {
    return fail(res, 404, "reference_not_found", requestId)
  }

  const lineItemIds = (cart.items ?? []).map((i) => i.id).filter(Boolean)

  // Already finalized? An order_cart link means the order exists → paid.
  const { data: orderCarts } = await query.graph<{ order_id?: string }>({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { cart_id: cartId },
  })
  const existingOrderId = orderCarts?.[0]?.order_id
  if (existingOrderId) {
    const invoiceToken = await issueInvoiceToken(existingOrderId)
    return ok(res, {
      status: "paid",
      order_id: existingOrderId,
      invoice_token: invoiceToken,
    })
  }

  // Expired QR window: release the hold and tell the client to stop polling.
  const expiresAt = session.data?.expires_at as string | undefined
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    await releaseStartReservation(req, lineItemIds)
    return ok(res, { status: "expired" })
  }

  // Server-side verify (cached ≥3s to avoid hammering the proxy on fast polls).
  let paid: boolean
  const cached = await cache.get<string>(verifyCacheKey(reference))
  if (cached === "paid") {
    paid = true
  } else if (cached === "pending") {
    paid = false
  } else {
    const proxyBaseUrl = process.env.BAKONG_PROXY_URL
    const token = process.env.BAKONG_TOKEN
    if (!proxyBaseUrl || !token) {
      // Sandbox / not configured: we cannot confirm — never fabricate "paid".
      await cache.set(verifyCacheKey(reference), "pending", VERIFY_PENDING_TTL)
      return ok(res, { status: "pending" })
    }
    try {
      paid = await checkTransactionByMd5({
        proxyBaseUrl,
        token,
        reference,
        allowedHosts: proxyAllowedHosts(),
      })
      await cache.set(
        verifyCacheKey(reference),
        paid ? "paid" : "pending",
        paid ? VERIFY_PAID_TTL : VERIFY_PENDING_TTL
      )
    } catch (err) {
      if (err instanceof UnsafeProxyUrlError) {
        logger.error(
          `[khqr/status] BAKONG_PROXY_URL failed SSRF validation (request_id=${requestId})`
        )
      } else {
        logger.warn(
          `[khqr/status] Bakong proxy unavailable (request_id=${requestId})`
        )
      }
      return fail(res, 502, "payment_gateway_unavailable", requestId)
    }
  }

  if (!paid) {
    return ok(res, { status: "pending" })
  }

  // PAID → finalize. Release the /start reservation BEFORE completing the cart
  // so completion's own reservation step doesn't double-hold stock.
  await releaseStartReservation(req, lineItemIds)

  let orderId: string | undefined
  try {
    const { result } = await completeCartWorkflow(req.scope).run({
      input: { id: cartId },
    })
    orderId = (result as { id?: string })?.id
  } catch {
    // Provider couldn't authorize yet (transient proxy issue) — completion is
    // idempotent, so report pending and let the next poll retry.
    logger.warn(
      `[khqr/status] cart completion deferred (request_id=${requestId})`
    )
    return ok(res, { status: "pending" })
  }

  if (!orderId) {
    return ok(res, { status: "pending" })
  }

  await writeStockOut(req, orderId, cart.items ?? [])

  const invoiceToken = await issueInvoiceToken(orderId)
  return ok(res, { status: "paid", order_id: orderId, invoice_token: invoiceToken })
}
