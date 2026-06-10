/**
 * GET /store/payments/khpay/status?reference= — KHPAY-03.
 *
 * Confirms a KHPAY Bakong KHQR payment and finalizes the order. The storefront
 * polls this while the customer pays; it returns
 * `{ status: pending | paid | expired }` — the same contract as the khqr and
 * payway status routes so the storefront cutover is a URL change. Polling is
 * the ONLY confirmation path for KHPAY (locked decision — no webhook).
 *
 * Flow (order created at cart completion, not at /start):
 *  - resolve the cart from the (non-guessable) `reference`/transaction_id via
 *    the server-side mapping written by /start;
 *  - if an order already exists for the cart → `paid` (idempotent short-circuit);
 *  - if the payment window has passed → `expired`, reservation released;
 *  - otherwise SERVER-SIDE verify via KHPAY /bakong/check (never trust a
 *    client-reported status). expired/failed from KHPAY also release the hold
 *    and report `expired` (terminal — the storefront stops polling). On paid:
 *    finalize via the shared sequence (release hold → completeCart, whose
 *    provider authorize re-verifies → stock-out ledger → invoice token).
 *
 * SECURITY: transaction ids and KHPAY bodies are never logged; `paid` is set
 * only after the server verify; verify is cached ≥3s and rate-limited per
 * reference.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { KHPAY_PROVIDER_ID } from "../../../../../modules/khpay-payment"
import { KHPAY_REFERENCE_PATTERN } from "../../../../../modules/khpay-payment/lib/client"
import {
  fail,
  findExistingOrderId,
  finalizePaidCart,
  getClientIp,
  getRequestId,
  issueInvoiceToken,
  loadCartForTxn,
  overLimit,
  releaseStartReservation,
  verifyKhpayPaid,
  type CartView,
  type PaymentSession,
} from "../shared"

/** The reference is the KHPAY transaction id — `bk_` + alphanumerics. */
const ReferenceSchema = z.object({
  reference: z.string().regex(KHPAY_REFERENCE_PATTERN),
})

/**
 * Rate limits (security.md): 60/min and 120/hour per reference (the guest's
 * polling key), plus a 60/min per-IP backstop. Fixed-window via the cache.
 */
const REF_PER_MIN = { windowMs: 60_000, limit: 60, ttl: 60 } as const
const REF_PER_HOUR = { windowMs: 3_600_000, limit: 120, ttl: 3600 } as const
const IP_PER_MIN = { windowMs: 60_000, limit: 60, ttl: 60 } as const

function ok(res: MedusaResponse, body: Record<string, unknown>): void {
  res.json(body)
}

/** Locate the KHPAY session on the cart that matches this transaction_id. */
function findKhpaySession(
  cart: CartView,
  transactionId: string
): PaymentSession | null {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  for (const session of sessions) {
    if (session.provider_id !== KHPAY_PROVIDER_ID) continue
    if ((session.data?.transaction_id as string | undefined) === transactionId) {
      return session
    }
  }
  return null
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  const parsed = ReferenceSchema.safeParse(req.query)
  if (!parsed.success) {
    return fail(res, 400, "invalid_reference", requestId)
  }
  const { reference } = parsed.data

  const { cache, query, cartId, cart } = await loadCartForTxn(req, reference)

  if (
    (await overLimit(
      cache,
      `rl:khpay_status:ip:${getClientIp(req)}`,
      IP_PER_MIN.windowMs,
      IP_PER_MIN.limit,
      IP_PER_MIN.ttl
    )) ||
    (await overLimit(
      cache,
      `rl:khpay_status:refmin:${reference}`,
      REF_PER_MIN.windowMs,
      REF_PER_MIN.limit,
      REF_PER_MIN.ttl
    )) ||
    (await overLimit(
      cache,
      `rl:khpay_status:refhr:${reference}`,
      REF_PER_HOUR.windowMs,
      REF_PER_HOUR.limit,
      REF_PER_HOUR.ttl
    ))
  ) {
    return fail(res, 429, "rate_limited", requestId)
  }

  if (!cartId || !cart) {
    return fail(res, 404, "reference_not_found", requestId)
  }

  // Confirm the reference really belongs to a KHPAY session on this cart.
  const session = findKhpaySession(cart, reference)
  if (!session) {
    return fail(res, 404, "reference_not_found", requestId)
  }

  const lineItemIds = (cart.items ?? []).map((i) => i.id).filter(Boolean)

  // Already finalized? An order_cart link means the order exists → paid.
  // Only the invoice token is (re)minted here — never re-run completion.
  const existingOrderId = await findExistingOrderId(query, cartId)
  if (existingOrderId) {
    const invoiceToken = await issueInvoiceToken(req, existingOrderId, requestId)
    return ok(res, {
      status: "paid",
      order_id: existingOrderId,
      invoice_token: invoiceToken,
    })
  }

  // Expired payment window: release the hold and tell the client to stop.
  const expiresAt = session.data?.expires_at as string | undefined
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    await releaseStartReservation(req, lineItemIds)
    return ok(res, { status: "expired" })
  }

  // Server-side verify (cached ≥3s to avoid hammering KHPAY on fast polls).
  const outcome = await verifyKhpayPaid(cache, reference)
  if (outcome === "unavailable") {
    logger.warn(`[khpay/status] KHPAY unavailable (request_id=${requestId})`)
    return fail(res, 502, "payment_gateway_unavailable", requestId)
  }
  if (outcome === "failed") {
    // expired/failed at KHPAY — terminal: release the hold, stop the poll loop.
    await releaseStartReservation(req, lineItemIds)
    return ok(res, { status: "expired" })
  }
  if (outcome === "pending") {
    return ok(res, { status: "pending" })
  }

  // PAID → finalize via the shared verified sequence.
  const result = await finalizePaidCart(req, cartId, cart.items ?? [], requestId)
  if (result.status !== "paid") {
    return ok(res, { status: "pending" })
  }
  return ok(res, {
    status: "paid",
    order_id: result.order_id,
    invoice_token: result.invoice_token,
  })
}
