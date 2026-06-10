/**
 * POST /hooks/payway/pushback — PAYWAY-04.
 *
 * Lives under `/hooks` (not `/store`) because Medusa requires the publishable
 * API key on all `/store/*` routes and ABA's callback cannot send one; the
 * `api/hooks/` tree is this repo's convention for external server callbacks.
 *
 * PayWay's server callback (return_url): after the customer pays, PayWay
 * POSTs `{ tran_id, apv, status, return_params }` here. This completes orders
 * even when the customer pays in the ABA app and never returns to the poll
 * screen.
 *
 * THE PAYLOAD IS UNSIGNED — PayWay provides no HMAC on the pushback. It is
 * therefore treated purely as a wake-up signal: the body NEVER drives a state
 * change. On receipt we re-verify via check-transaction-2 (the same
 * `verifyPaywayPaid` the poll route uses) and only a confirmed APPROVED runs
 * the shared finalize sequence. A forged pushback for an unpaid tran_id
 * verifies as pending and does nothing.
 *
 * Responses are always 200 with `{ received: true }` (when the shape is
 * valid) so PayWay does not retry storms; unknown tran_ids return the same
 * body to avoid acting as an existence oracle. Double delivery (pushback +
 * poll racing) is safe: the order_cart short-circuit + Medusa's idempotent
 * completion yield exactly one order.
 *
 * SECURITY: tran_id/apv are never logged; rate-limited per IP and per tran_id.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "zod"
import { TRAN_ID_PATTERN } from "../../../../modules/aba-payway/lib/client"
import {
  fail,
  findExistingOrderId,
  finalizePaidCart,
  getClientIp,
  getRequestId,
  loadCartForTran,
  overLimit,
  verifyPaywayPaid,
} from "../../../store/payments/payway/shared"

/**
 * PayWay pushback shape (docs/aba-payway-integration-guide.md §3.4). Only
 * tran_id is load-bearing (and only as a lookup key); everything else is
 * accepted leniently and ignored — verification comes from PayWay directly.
 */
const PushbackSchema = z.object({
  tran_id: z.string().regex(TRAN_ID_PATTERN),
  apv: z.string().max(50).optional(),
  status: z.union([z.string().max(10), z.number()]).optional(),
  return_params: z.string().max(500).optional(),
})

/** Rate limits: 30/min per IP (callback source), 10/min per tran_id. */
const IP_PER_MIN = { windowMs: 60_000, limit: 30, ttl: 60 } as const
const TRAN_PER_MIN = { windowMs: 60_000, limit: 10, ttl: 60 } as const

/** Uniform acknowledgement — never reveals whether the tran_id exists. */
function acknowledge(res: MedusaResponse): void {
  res.status(200).json({ received: true })
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  const parsed = PushbackSchema.safeParse(req.body)
  if (!parsed.success) {
    return fail(res, 400, "invalid_pushback", requestId)
  }
  const tranId = parsed.data.tran_id

  const { cache, query, cartId, cart } = await loadCartForTran(req, tranId)

  if (
    (await overLimit(
      cache,
      `rl:payway_pushback:ip:${getClientIp(req)}`,
      IP_PER_MIN.windowMs,
      IP_PER_MIN.limit,
      IP_PER_MIN.ttl
    )) ||
    (await overLimit(
      cache,
      `rl:payway_pushback:tran:${tranId}`,
      TRAN_PER_MIN.windowMs,
      TRAN_PER_MIN.limit,
      TRAN_PER_MIN.ttl
    ))
  ) {
    return fail(res, 429, "rate_limited", requestId)
  }

  // Unknown/expired mapping: acknowledge and stop — same body as success so
  // the route can't be probed for valid tran_ids.
  if (!cartId || !cart) {
    return acknowledge(res)
  }

  // Already finalized (poll won the race): nothing to do.
  const existingOrderId = await findExistingOrderId(query, cartId)
  if (existingOrderId) {
    return acknowledge(res)
  }

  // Re-verify server-side — the unsigned body proves nothing.
  const outcome = await verifyPaywayPaid(cache, tranId)
  if (outcome !== "paid") {
    if (outcome === "unavailable") {
      logger.warn(
        `[payway/pushback] verify unavailable, deferring to poll (request_id=${requestId})`
      )
    }
    // pending/failed/unavailable: acknowledge; the poll route (or PayWay's
    // retry) drives any further state change.
    return acknowledge(res)
  }

  const result = await finalizePaidCart(req, cartId, cart.items ?? [], requestId)
  if (result.status === "paid") {
    logger.info(
      `[payway/pushback] order finalized via pushback (request_id=${requestId})`
    )
  }
  return acknowledge(res)
}
