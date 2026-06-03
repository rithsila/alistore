/**
 * Cart-change notifier — INTEGRATION-02 (consumer wiring).
 *
 * The cart-operations layer (`@lib/cart`) runs as server actions; the cart id
 * lives in an `HttpOnly` cookie. Client surfaces that show a cart summary (the
 * `TopNav` bag count) can't observe a mutation made on another route, so after
 * any client-triggered cart change (add on the PDP, qty change / remove on the
 * cart page) we emit a same-tab event and interested components re-read the
 * count via the server action. A plain DOM event keeps this dependency-free and
 * avoids a global provider for one small piece of shared state.
 */

const CART_CHANGED_EVENT = "alistore:cart-changed"

/** Notify same-tab listeners that the cart changed (no-op on the server). */
export function emitCartChanged(): void {
  if (typeof window === "undefined") {
    return
  }
  window.dispatchEvent(new Event(CART_CHANGED_EVENT))
}

/**
 * Subscribe to cart-change notifications. Returns an unsubscribe function;
 * a no-op on the server so it's safe to call during SSR setup.
 */
export function subscribeCartChanged(handler: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }
  window.addEventListener(CART_CHANGED_EVENT, handler)
  return () => window.removeEventListener(CART_CHANGED_EVENT, handler)
}
