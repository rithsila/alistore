"use client"

import { useRouter } from "next/navigation"
import { ShoppingBag } from "@medusajs/icons"

import PillButton from "../ui/PillButton"
import { useCartCount } from "@lib/hooks/use-cart-count"

/**
 * Mobile cart/checkout bottom bar (DESIGN.md "persistent cart/checkout
 * pattern" / FRONTEND-21).
 *
 * - Item count (left): a `ShoppingBag` icon + a `body-strong` (16 / 500)
 *   count label, reusing the same bag affordance as TopNav. `aria-live`
 *   announces the count as it changes (same convention as the cart page
 *   quantity readout).
 * - Checkout (right): the ink `PillButton` primitive, navigating to
 *   `/checkout` via `useRouter().push` — the exact pattern the cart page's
 *   Checkout button uses. Disabled while the bag is empty so an empty
 *   checkout is never reachable.
 * - Mobile-only: hidden at ≥600px via `min-[600px]:hidden`, the project's
 *   1-up (≤599) boundary (TopNav / Footer use the same arbitrary variant).
 *
 * Sits in normal document flow with a single `border-t border-hairline`
 * separator (no `position: fixed`, no drop shadow — DESIGN.md / FRONTEND-21).
 *
 * Subscribes to the live cart count via `useCartCount` (INTEGRATION-02) — the
 * exact subscription TopNav's bag badge uses — so the count and the Checkout
 * button's enabled state update without a navigation, and server pages can
 * mount the bar without threading a count through.
 */

export default function BottomBar() {
  const router = useRouter()
  const itemCount = useCartCount()

  const isEmpty = itemCount <= 0
  const itemLabel = itemCount === 1 ? "item" : "items"

  return (
    <div className="flex items-center justify-between gap-4 border-t border-hairline bg-canvas px-4 py-3 min-[600px]:hidden">
      <div
        className="flex items-center gap-2 text-base font-medium leading-normal text-ink"
        aria-live="polite"
      >
        <ShoppingBag className="h-6 w-6" />
        <span>
          {itemCount} {itemLabel}
        </span>
      </div>

      <PillButton disabled={isEmpty} onClick={() => router.push("/checkout")}>
        Checkout
      </PillButton>
    </div>
  )
}
