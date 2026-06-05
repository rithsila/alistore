import {
  ArrowUpRightOnBox,
  BellAlert,
  ChatBubbleLeftRight,
  CheckCircle,
  DocumentText,
} from "@medusajs/icons"

import TopNav from "../../../components/layout/TopNav"

/**
 * Order confirmation (FRONTEND-19) — route `/order/[id]`.
 *
 * The post-checkout screen for both payment paths (PRD §3.2 / §3.4):
 *
 * - **Paid (KHQR)** → a receipt: payment-confirmed header, the order reference,
 *   and an invoice link.
 * - **COD** → "Our team will contact you to confirm" plus a Facebook page and a
 *   Telegram support button (the human follow-up the COD flow hands off to), and
 *   the same invoice link.
 *
 * Server Component (Stack.md: Server Components by default; this screen is static
 * content + links with no interactivity). `TopNav` — a Client Component — renders
 * fine as a child, matching the `checkout` / `checkout/khqr` siblings.
 *
 * Accent is NOT used here: design.md reserves the coral accent for the sale price
 * and the "Pay with KHQR" CTA only. The invoice and contact actions are ink, and
 * follow the established anchor-as-pill precedent from `FacebookLogin` and the
 * KHQR deeplink CTA (the `ui/` primitives cover `<button>`, not links).
 *
 * Scope (matches the FRONTEND-16 / FRONTEND-18 placeholder precedent): this task
 * delivers the SCREEN. Fetching the real order and deriving the variant from its
 * **server-verified** payment status is INTEGRATION work — INTEGRATION-04 routes
 * COD orders here, INTEGRATION-05 routes paid KHQR orders here. Until then the
 * seam below drives the screen, choosing the variant from an optional `?status=`
 * hint so both variants are verifiable now. The seam NEVER fabricates a "paid"
 * receipt from anything client-supplied (security.md: `paid` reflects backend
 * verification only) — INTEGRATION replaces the seam body with the real order
 * lookup and drops the `?status=` hint entirely.
 */

// ── INTEGRATION seam ─────────────────────────────────────────────────────────

/** Payment state that selects which confirmation variant to render. */
type OrderPaymentState = "paid" | "pending_confirmation"

/** Shape the INTEGRATION order lookup resolves to (drives the screen). */
interface OrderConfirmation {
  /** Order reference shown to the customer (PRD: non-sequential UUID/ULID). */
  id: string
  /** Backend-verified payment state — never a client-reported value. */
  state: OrderPaymentState
  /**
   * Printable VAT-ready invoice URL (`GET /store/orders/:id/invoice`, BACKEND-06).
   * That endpoint is order-token authed (security.md), so the URL carries the
   * order's invoice token as `?token=` — handed to the buyer in the COD /
   * KHQR-status response and routed here as a query param (INTEGRATION-07). It's
   * a same-origin relative path (the storefront has no client-readable backend
   * origin — see `FacebookLogin`); the storefront middleware proxies
   * `/store/orders/:id/invoice` to the backend, injecting the publishable key
   * the gate requires. `null` (and so no link) when no token was supplied, since
   * a tokenless invoice request can only 403.
   */
  invoiceUrl: string | null
}

/**
 * Placeholder order lookup until the Medusa SDK is wired (INTEGRATION-04/05).
 *
 * Resolves the variant from the optional `statusHint` so a reviewer can exercise
 * BOTH variants now (`/order/<id>` → paid receipt; `/order/<id>?status=cod` →
 * COD follow-up). It never asserts "paid" from anything trustworthy — the real
 * implementation fetches the order and reads its server-verified payment status.
 *
 * INTEGRATION-07: the invoice link carries the order's invoice token, supplied
 * here as the `token` query param (the COD redirect appends it from BACKEND-04's
 * response; the KHQR path will do the same via INTEGRATION-05). The token is
 * never minted or guessed client-side — only a token that already arrived on the
 * URL is forwarded to the (token-gated) invoice route, which 403s a wrong one.
 */
function fetchOrderConfirmation(
  id: string,
  statusHint?: string,
  token?: string
): Promise<OrderConfirmation> {
  const isCod = statusHint === "cod" || statusHint === "pending_confirmation"
  const invoiceToken = token?.trim()
  return Promise.resolve({
    id,
    state: isCod ? "pending_confirmation" : "paid",
    invoiceUrl: invoiceToken
      ? `/store/orders/${encodeURIComponent(
          id
        )}/invoice?token=${encodeURIComponent(invoiceToken)}`
      : null,
  })
}

// ── Contact links (COD follow-up) ────────────────────────────────────────────

/**
 * Public shop contact destinations for the COD follow-up. These are public
 * marketing URLs (not secrets); the shop's real Facebook page and Telegram
 * support handle are config values supplied at INTEGRATION — placeholders here,
 * matching the placeholder nav links in `TopNav`.
 */
const FACEBOOK_PAGE_URL = "https://facebook.com"
const TELEGRAM_SUPPORT_URL = "https://t.me"

// ── Styles ───────────────────────────────────────────────────────────────────

// Ink outline pill (PillButton geometry; ink, never accent) — the FacebookLogin
// precedent for an anchor styled as a pill.
const PILL_OUTLINE =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill border border-ink bg-canvas px-6 py-3 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-90"

// ── Screen ───────────────────────────────────────────────────────────────────

interface OrderConfirmationPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; token?: string }>
}

function InvoiceLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 text-base font-medium leading-normal text-ink underline underline-offset-4 transition-opacity hover:opacity-70"
    >
      <DocumentText className="h-5 w-5" />
      View invoice
    </a>
  )
}

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: OrderConfirmationPageProps) {
  const { id } = await params
  const { status, token } = await searchParams
  const order = await fetchOrderConfirmation(id, status, token)

  const isPaid = order.state === "paid"

  return (
    <>
      <TopNav />

      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-section text-center min-[600px]:px-6">
        {isPaid ? (
          <CheckCircle className="h-12 w-12 text-ink" />
        ) : (
          <BellAlert className="h-12 w-12 text-ink" />
        )}

        <h1 className="mt-6 text-3xl font-medium uppercase text-ink">
          {isPaid ? "Payment confirmed" : "Order placed"}
        </h1>

        <p className="mt-4 text-base font-medium leading-normal text-mute">
          {isPaid
            ? "Thank you — your payment is confirmed and your order is on its way."
            : "Our team will contact you to confirm your order and arrange delivery."}
        </p>

        <p className="mt-6 text-xs font-medium leading-normal text-mute">
          Order reference
        </p>
        <p className="mt-1 text-base font-medium leading-normal text-ink">
          {order.id}
        </p>

        {!isPaid && (
          <div className="mt-section flex w-full flex-col gap-3">
            <a
              href={FACEBOOK_PAGE_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={PILL_OUTLINE}
            >
              <ArrowUpRightOnBox className="h-5 w-5" />
              Message us on Facebook
            </a>
            <a
              href={TELEGRAM_SUPPORT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className={PILL_OUTLINE}
            >
              <ChatBubbleLeftRight className="h-5 w-5" />
              Chat on Telegram
            </a>
          </div>
        )}

        {order.invoiceUrl && (
          <div className="mt-section">
            <InvoiceLink href={order.invoiceUrl} />
          </div>
        )}

        <a
          href="/"
          className="mt-section text-xs font-medium leading-normal text-mute underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Continue shopping
        </a>
      </main>
    </>
  )
}
