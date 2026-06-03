"use client"

import { useEffect, useState } from "react"

import { getCartItemCount } from "@lib/cart"
import { subscribeCartChanged } from "@lib/cart-events"

/**
 * Live cart item count for nav surfaces (the `TopNav` bag badge) — INTEGRATION-02.
 *
 * Reads the session cart's item count via the `@lib/cart` server action on mount
 * and again whenever a cart change is announced (`@lib/cart-events`), so adding
 * from the PDP updates the badge without a navigation. Returns `0` until the
 * first read resolves and on any read failure (the badge simply stays hidden).
 */
export function useCartCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true

    const refresh = (): void => {
      getCartItemCount()
        .then((next) => {
          if (active) {
            setCount(next)
          }
        })
        .catch(() => {
          // Count is non-critical chrome; leave the last known value.
        })
    }

    refresh()
    const unsubscribe = subscribeCartChanged(refresh)

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return count
}
