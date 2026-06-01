/**
 * Invoice order-token — BACKEND-06.
 *
 * A stored, per-order capability that authorizes `GET /store/orders/:id/invoice`.
 * Implements security.md "Invoice & order-token":
 *  - ≥128-bit entropy: `crypto.randomBytes(32)` (256-bit) → base64url.
 *  - compared with `crypto.timingSafeEqual`, never `===`.
 *  - single-purpose (invoice only), expirable (30 days), admin-revocable.
 *
 * The token is minted once at order creation — both the COD path (BACKEND-04)
 * and the KHQR finalize path (BACKEND-03B) call {@link ensureInvoiceToken}
 * right after the order exists — persisted onto `order.metadata`, and handed
 * back to the buyer in that same response so the confirmation page
 * (FRONTEND-19 / INTEGRATION-07) can build the invoice link. It is never
 * exposed through any unauthenticated read path: order metadata is only
 * reachable behind Medusa's authenticated store/admin order routes, and the
 * invoice route itself returns the token only by validating a supplied copy.
 */
import { randomBytes, timingSafeEqual } from "crypto"
import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

/** Invoice link lifetime (security.md: expirable, 30 days). */
export const INVOICE_TOKEN_TTL_DAYS = 30
const TTL_MS = INVOICE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000

/** Metadata keys the token + its lifecycle live under on the order. */
export const INVOICE_TOKEN_KEY = "invoice_token"
export const INVOICE_TOKEN_EXPIRES_KEY = "invoice_token_expires_at"
/** Set `true` by an admin to revoke an issued invoice link (security.md). */
export const INVOICE_TOKEN_REVOKED_KEY = "invoice_token_revoked"

type OrderMetadata = Record<string, unknown> | null | undefined

/** Minimal view of the Order module's auto-generated service we rely on. */
type OrderModuleService = {
  retrieveOrder(
    orderId: string,
    config?: { select?: string[] }
  ): Promise<{ id: string; metadata?: OrderMetadata }>
  updateOrders(
    orderId: string,
    data: { metadata: Record<string, unknown> }
  ): Promise<unknown>
}

/** Mint a fresh 256-bit token, URL-safe so it rides cleanly in a query string. */
function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

/**
 * Ensure the order carries an invoice token, minting one on first call and
 * persisting it (merged into existing metadata, never clobbering the COD
 * contact details). Idempotent: a re-run — a COD double-submit returning the
 * existing order, or a retried KHQR poll — returns the already-stored token
 * rather than rotating it, so links handed out earlier keep working.
 *
 * Returns the token to hand back to the buyer in the order-creation response.
 */
export async function ensureInvoiceToken(
  container: MedusaContainer,
  orderId: string
): Promise<string> {
  const orderModule = container.resolve(
    Modules.ORDER
  ) as unknown as OrderModuleService

  const order = await orderModule.retrieveOrder(orderId, {
    select: ["id", "metadata"],
  })
  const metadata = (order.metadata ?? {}) as Record<string, unknown>

  const existing = metadata[INVOICE_TOKEN_KEY]
  if (typeof existing === "string" && existing.length > 0) {
    return existing
  }

  const token = generateToken()
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
  await orderModule.updateOrders(orderId, {
    metadata: {
      ...metadata,
      [INVOICE_TOKEN_KEY]: token,
      [INVOICE_TOKEN_EXPIRES_KEY]: expiresAt,
    },
  })
  return token
}

/**
 * Constant-time check of a supplied invoice token against the order's stored
 * token. Returns false (never throws) on a missing/revoked/expired token or any
 * mismatch — the caller maps false to a 403. The length pre-check is required
 * because `timingSafeEqual` throws on differing buffer lengths; the stored
 * token has fixed length, so a wrong-length supply is simply a mismatch.
 */
export function verifyInvoiceToken(
  metadata: OrderMetadata,
  supplied: string
): boolean {
  const meta = (metadata ?? {}) as Record<string, unknown>

  if (meta[INVOICE_TOKEN_REVOKED_KEY] === true) return false

  const stored = meta[INVOICE_TOKEN_KEY]
  if (typeof stored !== "string" || stored.length === 0) return false

  const expiresAt = meta[INVOICE_TOKEN_EXPIRES_KEY]
  if (typeof expiresAt === "string") {
    const exp = Date.parse(expiresAt)
    if (Number.isFinite(exp) && Date.now() > exp) return false
  }

  const storedBuf = Buffer.from(stored)
  const suppliedBuf = Buffer.from(supplied)
  if (storedBuf.length !== suppliedBuf.length) return false
  return timingSafeEqual(storedBuf, suppliedBuf)
}
