/**
 * Reservation expiry job — BACKEND-10.
 *
 * Backstop that releases stock held for KHQR checkouts the customer never
 * finished. `/store/payments/khqr/start` reserves inventory and creates a
 * Bakong `payment_session` (status `pending`, `data.expires_at` = QR lifetime);
 * the order itself is created only at cart completion AFTER a server-side
 * payment verify (PRD §4 locked decision — see `khqr/status/route.ts`). So
 * during the payment window there is NO order to cancel: the held state is a
 * not-yet-completed cart + an inventory reservation + a pending Bakong session.
 *
 * `/khqr/status` releases the hold when a poll arrives after expiry, but a
 * customer who closes the tab never triggers that poll. This job is the
 * scheduled backstop both `/start` and `/status` refer to: it finds carts past
 * their KHQR `expires_at` that were never paid and, for each:
 *   1. releases the `/start` reservation (stock returns to available), and
 *   2. deletes the stale pending Bakong session (the "cancel" analog — there is
 *      no order; deleting just this session, not the payment collection, lets a
 *      returning customer re-run `/start` and get a fresh QR).
 *
 * Safety: only carts with `completed_at = null` are considered, and any Bakong
 * session already `authorized`/`captured`/`canceled`/`error` is skipped — so a
 * paid order's committed stock can never be released. The job is idempotent: a
 * cleaned cart no longer has a usable Bakong session, so re-runs are no-ops.
 *
 * SECURITY (security.md): never logs the cart id, reference, QR, or any PII —
 * only aggregate counts.
 */
import type { Logger, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  deletePaymentSessionsWorkflow,
  deleteReservationsByLineItemsWorkflow,
} from "@medusajs/medusa/core-flows"
import { BAKONG_PROVIDER_ID } from "../modules/bakong-payment"
import { PAYWAY_PROVIDER_ID } from "../modules/aba-payway"
import { KHPAY_PROVIDER_ID } from "../modules/khpay-payment"

/**
 * KHQR-style providers this job cleans up after (PAYWAY-05, KHPAY-04). All
 * write `data.expires_at` aligned with the reservation TTL (20 min), so one
 * expiry rule covers them.
 */
const KHQR_PROVIDER_IDS = new Set([
  BAKONG_PROVIDER_ID,
  PAYWAY_PROVIDER_ID,
  KHPAY_PROVIDER_ID,
])

/**
 * Session statuses that mean "do not touch": paid (authorized/captured) or
 * already terminal (canceled/error). Mirrors `/khqr/start`'s non-reusable set —
 * keeping them aligned ensures the job never releases stock for a session the
 * start route would still consider live/paid.
 */
const SKIP_STATUSES = new Set(["authorized", "captured", "canceled", "error"])

/** Page size for scanning incomplete carts (bounded, paginated — no silent cap). */
const PAGE_SIZE = 200

const CART_FIELDS = [
  "id",
  "items.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.provider_id",
  "payment_collection.payment_sessions.status",
  "payment_collection.payment_sessions.data",
]

interface PaymentSessionView {
  id?: string
  provider_id?: string
  status?: string
  data?: Record<string, unknown> | null
}

interface CartView {
  id: string
  items?: Array<{ id: string }>
  payment_collection?: { payment_sessions?: PaymentSessionView[] } | null
}

/**
 * Find a Bakong/PayWay session on the cart whose payment window has passed and
 * that is still pending (not paid/terminal). Returns its id, or null when
 * nothing on the cart is eligible for release.
 */
function findExpiredPendingKhqrSession(
  cart: CartView,
  nowMs: number
): string | null {
  const sessions = cart.payment_collection?.payment_sessions ?? []
  for (const session of sessions) {
    if (!session.provider_id || !KHQR_PROVIDER_IDS.has(session.provider_id)) {
      continue
    }
    if (session.status && SKIP_STATUSES.has(session.status)) continue
    if (!session.id) continue

    const expiresAt = (session.data?.expires_at as string | undefined) ?? null
    if (!expiresAt) continue
    const expiresMs = Date.parse(expiresAt)
    if (!Number.isFinite(expiresMs) || expiresMs > nowMs) continue // not expired

    return session.id
  }
  return null
}

export default async function expireReservationsJob(
  container: MedusaContainer
): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const nowMs = Date.now()
  let scanned = 0
  let cleaned = 0

  try {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      const { data: carts } = await query.graph({
        entity: "cart",
        fields: CART_FIELDS,
        // Paid carts are marked completed by completeCartWorkflow, so
        // `completed_at: null` excludes every order-bearing cart — the core
        // guard against releasing committed stock.
        filters: { completed_at: null },
        pagination: { skip, take: PAGE_SIZE },
      })

      const batch = (carts ?? []) as CartView[]
      if (batch.length === 0) break
      scanned += batch.length

      for (const cart of batch) {
        const sessionId = findExpiredPendingKhqrSession(cart, nowMs)
        if (!sessionId) continue

        const lineItemIds = (cart.items ?? [])
          .map((i) => i.id)
          .filter(Boolean) as string[]

        // 1. Release the /start reservation → stock returns to available.
        if (lineItemIds.length > 0) {
          await deleteReservationsByLineItemsWorkflow(container)
            .run({ input: { ids: lineItemIds } })
            .catch((err: unknown) => {
              logger.warn(
                `[expire-reservations] reservation release failed: ${
                  err instanceof Error ? err.message : "unknown"
                }`
              )
            })
        }

        // 2. Delete the stale pending Bakong/PayWay session (the order never
        // existed; this is the "cancel" step). Leaves the payment collection
        // intact so a returning customer can re-run /start.
        await deletePaymentSessionsWorkflow(container)
          .run({ input: { ids: [sessionId] } })
          .catch((err: unknown) => {
            logger.warn(
              `[expire-reservations] session delete failed: ${
                err instanceof Error ? err.message : "unknown"
              }`
            )
          })

        cleaned += 1
      }

      if (batch.length < PAGE_SIZE) break
    }

    logger.info(
      `[expire-reservations] scanned ${scanned} open cart(s), released ${cleaned} expired KHQR hold(s)`
    )
  } catch (err: unknown) {
    // Don't throw — let the job complete and retry on the next schedule.
    logger.error(
      `[expire-reservations] job failed: ${
        err instanceof Error ? err.message : "unknown"
      }`
    )
  }
}

export const config = {
  name: "expire-khqr-reservations",
  // Every 5 minutes: the QR/reservation TTL is ~20 min (security.md "stop
  // polling after reservation TTL"), so released stock returns within a few
  // minutes of expiry without hammering the database.
  schedule: "*/5 * * * *",
}
