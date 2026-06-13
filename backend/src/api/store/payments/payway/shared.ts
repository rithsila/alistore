/**
 * Shared helpers for the ABA PayWay store routes (PAYWAY-03/03B/04).
 *
 * The start, status, and pushback routes all need the same request plumbing
 * (request id, trusted-hop client IP, error shape, fixed-window rate limit)
 * and — for status + pushback — the same "payment confirmed → finalize order"
 * sequence. Centralizing it keeps the two confirmation entry points (poll and
 * unsigned callback) running EXACTLY the same verified path.
 *
 * SECURITY: tran_id, credentials, QR strings, and PayWay bodies are never
 * logged (security.md "Payments"/"Logging").
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { overLimitAtomic } from "../../../../lib/rate-limit"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  deleteReservationsByLineItemsWorkflow,
} from "@medusajs/medusa/core-flows"
import { randomUUID } from "crypto"
import { ensureInvoiceToken } from "../../../../lib/order-token"
import {
  checkTransaction,
  payWayConfigFromEnv,
  PAYWAY_STATUS_CODE,
} from "../../../../modules/aba-payway/lib/client"
import { STOCK_MOVEMENT_MODULE } from "../../../../modules/stock-movement"

/** Reason recorded on the automatic stock-out ledger row. */
const STOCK_OUT_REASON = "KHQR payment (PayWay)"
const STOCK_OUT_ACTOR = "system"

/** Verify-result cache TTLs: ≥3s server-side (security.md). */
export const VERIFY_PENDING_TTL = 3
export const VERIFY_PAID_TTL = 30

export type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
}

export type QueryGraph = {
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

export interface CartItem {
  id: string
  variant_id?: string | null
  quantity?: number | null
}

export interface PaymentSession {
  provider_id?: string
  status?: string
  data?: Record<string, unknown>
}

export interface CartView {
  id: string
  completed_at?: string | null
  items?: CartItem[]
  payment_collection?: { payment_sessions?: PaymentSession[] }
}

/** Cache key mapping a minted `tran_id` → its `cart_id` (written by /start). */
export function tranCartKey(tranId: string): string {
  return `payway:cart:${tranId}`
}

/** Cache key for the ≥3s verify-result cache. */
export function verifyCacheKey(tranId: string): string {
  return `payway:verify:${tranId}`
}

export function getRequestId(req: MedusaRequest): string {
  const header = req.headers["x-request-id"]
  if (typeof header === "string" && header.length > 0) return header
  return randomUUID()
}

/** Trusted-hop client IP (see khqr/start for the X-Forwarded-For rationale). */
export function getClientIp(req: MedusaRequest): string {
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

export function fail(
  res: MedusaResponse,
  status: number,
  error: string,
  requestId: string
): void {
  res.status(status).json({ error, request_id: requestId })
}

/** Increment one fixed-window counter; returns true when already over limit. */
export async function overLimit(
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

export type VerifyOutcome = "paid" | "pending" | "failed" | "unavailable"

/**
 * Server-side PayWay verify with the ≥3s result cache. The ONLY source of
 * truth for "paid" — both the poll route and the (unsigned) pushback route go
 * through here; neither ever trusts client/callback-reported status.
 *
 * "failed" = PayWay says DECLINED/CANCELLED (terminal — stop polling);
 * "unavailable" = gateway/config problem (route maps to 502 or retries).
 */
export async function verifyPaywayPaid(
  cache: CacheModule,
  tranId: string
): Promise<VerifyOutcome> {
  const cached = await cache.get<string>(verifyCacheKey(tranId))
  if (cached === "paid" || cached === "pending" || cached === "failed") {
    return cached
  }

  const config = payWayConfigFromEnv()
  if (!config) {
    // Not configured: we cannot confirm — never fabricate "paid".
    await cache.set(verifyCacheKey(tranId), "pending", VERIFY_PENDING_TTL)
    return "pending"
  }

  let outcome: VerifyOutcome
  try {
    const result = await checkTransaction(config, tranId)
    if (result.paid) {
      outcome = "paid"
    } else if (
      result.paymentStatusCode === PAYWAY_STATUS_CODE.DECLINED ||
      result.paymentStatusCode === PAYWAY_STATUS_CODE.CANCELLED
    ) {
      outcome = "failed"
    } else {
      outcome = "pending" // PENDING / not-found-yet
    }
  } catch {
    return "unavailable" // not cached — the caller decides how to surface it
  }

  await cache.set(
    verifyCacheKey(tranId),
    outcome,
    outcome === "paid" ? VERIFY_PAID_TTL : VERIFY_PENDING_TTL
  )
  return outcome
}

/** Release the reservation /start created for these cart line items. */
export async function releaseStartReservation(
  req: MedusaRequest,
  lineItemIds: string[]
): Promise<void> {
  if (lineItemIds.length === 0) return
  await deleteReservationsByLineItemsWorkflow(req.scope)
    .run({ input: { ids: lineItemIds } })
    .catch(() => undefined) // best-effort; expiry job is the backstop
}

/**
 * Write one automatic stock-out ledger row per line item, once per order.
 * Idempotent: skips if out-movements already exist for the order.
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

/**
 * Mint (or reuse) the invoice order-token for a finalized order. Best-effort:
 * the payment is already confirmed, so a token-mint hiccup must not turn a
 * `paid` response into an error; the next poll retries (idempotent).
 */
export async function issueInvoiceToken(
  req: MedusaRequest,
  orderId: string,
  requestId: string
): Promise<string | undefined> {
  try {
    return await ensureInvoiceToken(req.scope, orderId)
  } catch {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as {
      error(msg: string): void
    }
    logger.error(`[payway] invoice token mint failed (request_id=${requestId})`)
    return undefined
  }
}

export type FinalizeResult =
  | { status: "paid"; order_id: string; invoice_token?: string }
  | { status: "pending" }

/**
 * Finalize a VERIFIED-paid cart: release the /start reservation (completion
 * creates its own order reservations — releasing first avoids double-holding),
 * complete the cart (the provider's `authorizePayment` re-verifies via PayWay
 * — second independent confirmation), write the stock-out ledger rows, and
 * mint the invoice token. Idempotent: poll + pushback may both land here; the
 * caller's order_cart short-circuit plus Medusa's idempotent completion make
 * double delivery yield exactly one order.
 */
export async function finalizePaidCart(
  req: MedusaRequest,
  cartId: string,
  items: CartItem[],
  requestId: string
): Promise<FinalizeResult> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as {
    warn(msg: string): void
    error(msg: string): void
  }

  await releaseStartReservation(req, items.map((i) => i.id).filter(Boolean))

  let orderId: string | undefined
  try {
    const { result } = await completeCartWorkflow(req.scope).run({
      input: { id: cartId },
    })
    orderId = (result as { id?: string })?.id
  } catch {
    // Provider couldn't authorize yet (transient gateway issue) — completion
    // is idempotent, so report pending and let the next attempt retry.
    logger.warn(`[payway] cart completion deferred (request_id=${requestId})`)
    return { status: "pending" }
  }
  if (!orderId) {
    return { status: "pending" }
  }

  await writeStockOut(req, orderId, items)

  const invoiceToken = await issueInvoiceToken(req, orderId, requestId)

  return { status: "paid", order_id: orderId, invoice_token: invoiceToken }
}

/** Resolve a cart view + the cache/query services for a confirmation route. */
export async function loadCartForTran(
  req: MedusaRequest,
  tranId: string
): Promise<{
  cache: CacheModule
  query: QueryGraph
  cartId: string | null
  cart: CartView | null
}> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const cartId = await cache.get<string>(tranCartKey(tranId))
  if (!cartId) {
    return { cache, query, cartId: null, cart: null }
  }

  const { data: carts } = await query.graph<CartView>({
    entity: "cart",
    fields: [
      "id",
      "completed_at",
      "items.id",
      "items.variant_id",
      "items.quantity",
      "payment_collection.payment_sessions.provider_id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.data",
    ],
    filters: { id: cartId },
  })
  return { cache, query, cartId, cart: carts?.[0] ?? null }
}

/** Already finalized? An order_cart link means the order exists → paid. */
export async function findExistingOrderId(
  query: QueryGraph,
  cartId: string
): Promise<string | undefined> {
  const { data: orderCarts } = await query.graph<{ order_id?: string }>({
    entity: "order_cart",
    fields: ["order_id", "cart_id"],
    filters: { cart_id: cartId },
  })
  return orderCarts?.[0]?.order_id
}
