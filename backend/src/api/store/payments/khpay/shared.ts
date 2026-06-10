/**
 * Shared helpers for the KHPAY store routes (KHPAY-02/03).
 *
 * Per-provider copy following the repo precedent (`payway/shared.ts` mirrors
 * the khqr routes' plumbing): request id, trusted-hop client IP, error shape,
 * fixed-window rate limit, and the "payment confirmed → finalize order"
 * sequence. Confirmation is polling-only for KHPAY, so the status route is the
 * single confirmation entry point.
 *
 * SECURITY: transaction ids, credentials, QR strings, and KHPAY bodies are
 * never logged (security.md "Payments"/"Logging").
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  deleteReservationsByLineItemsWorkflow,
} from "@medusajs/medusa/core-flows"
import { randomUUID } from "crypto"
import { ensureInvoiceToken } from "../../../../lib/order-token"
import {
  checkBakongPayment,
  khpayConfigFromEnv,
} from "../../../../modules/khpay-payment/lib/client"
import { STOCK_MOVEMENT_MODULE } from "../../../../modules/stock-movement"

/** Reason recorded on the automatic stock-out ledger row. */
const STOCK_OUT_REASON = "KHQR payment (KHPAY)"
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

/** Cache key mapping a KHPAY `transaction_id` → its `cart_id` (written by /start). */
export function txnCartKey(transactionId: string): string {
  return `khpay:cart:${transactionId}`
}

/** Cache key for the ≥3s verify-result cache. */
export function verifyCacheKey(transactionId: string): string {
  return `khpay:verify:${transactionId}`
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

export type VerifyOutcome = "paid" | "pending" | "failed" | "unavailable"

/**
 * Server-side KHPAY verify with the ≥3s result cache. The ONLY source of
 * truth for "paid" — the poll route never trusts client-reported status.
 *
 * "failed" = KHPAY says expired/failed (terminal — stop polling);
 * "unavailable" = gateway/config problem (route maps to 502 or retries).
 */
export async function verifyKhpayPaid(
  cache: CacheModule,
  transactionId: string
): Promise<VerifyOutcome> {
  const cached = await cache.get<string>(verifyCacheKey(transactionId))
  if (cached === "paid" || cached === "pending" || cached === "failed") {
    return cached
  }

  const config = khpayConfigFromEnv()
  if (!config) {
    // Not configured: we cannot confirm — never fabricate "paid".
    await cache.set(verifyCacheKey(transactionId), "pending", VERIFY_PENDING_TTL)
    return "pending"
  }

  let outcome: VerifyOutcome
  try {
    const result = await checkBakongPayment(config, transactionId)
    if (result.paid) {
      outcome = "paid"
    } else if (result.status === "expired" || result.status === "failed") {
      outcome = "failed"
    } else {
      // pending / not-found-yet: our own expires_at gate reports `expired`
      // once the payment window passes, so notFound stays pending here.
      outcome = "pending"
    }
  } catch {
    return "unavailable" // not cached — the caller decides how to surface it
  }

  await cache.set(
    verifyCacheKey(transactionId),
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
    logger.error(`[khpay] invoice token mint failed (request_id=${requestId})`)
    return undefined
  }
}

export type FinalizeResult =
  | { status: "paid"; order_id: string; invoice_token?: string }
  | { status: "pending" }

/**
 * Finalize a VERIFIED-paid cart: release the /start reservation (completion
 * creates its own order reservations — releasing first avoids double-holding),
 * complete the cart (the provider's `authorizePayment` re-verifies via KHPAY
 * — second independent confirmation), write the stock-out ledger rows, and
 * mint the invoice token. Idempotent: the caller's order_cart short-circuit
 * plus Medusa's idempotent completion make repeated polls yield exactly one
 * order.
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
    logger.warn(`[khpay] cart completion deferred (request_id=${requestId})`)
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
export async function loadCartForTxn(
  req: MedusaRequest,
  transactionId: string
): Promise<{
  cache: CacheModule
  query: QueryGraph
  cartId: string | null
  cart: CartView | null
}> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryGraph

  const cartId = await cache.get<string>(txnCartKey(transactionId))
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
