/**
 * Delivery pricing constants (CLARIFY-04, locked).
 *
 * Single source of truth for the storefront's delivery rule — a flat USD fee,
 * free once the subtotal reaches the threshold. Previously duplicated in
 * `app/cart/page.tsx` and `app/checkout/page.tsx`; both now import from here, as
 * does the `/delivery` info page (FRONTEND-23), so the displayed rule can never
 * drift between surfaces.
 *
 * USD major units (1.5 = $1.50). KHR display is derived at render time via the
 * shared `@lib/price` formatter; these values stay in USD.
 *
 * NOTE: server-side enforcement of the free-over-threshold rule lives in the
 * Medusa shipping option (backend), which is currently a flat fee — see
 * `backend/src/scripts/seed-shipping.ts`. These constants drive storefront
 * *display* only.
 */

/** Flat delivery fee in USD. */
export const DELIVERY_FEE = 1.5

/** Order subtotal (USD) at or above which delivery is free. */
export const FREE_DELIVERY_THRESHOLD = 50
