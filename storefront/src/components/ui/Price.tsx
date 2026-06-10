"use client"

/**
 * Currency-reactive price (FRONTEND-22).
 *
 * A small client island that turns a USD-base amount into a display-ready string
 * in the currency the customer picked with the nav toggle, and re-renders the
 * instant the toggle flips (via `useCurrency`). Server components (e.g.
 * `ProductCard`) embed it so they stay server-rendered while their prices still
 * react to the toggle; client surfaces (cart, checkout) that already hold the raw
 * amounts can call `formatPrice` with `useCurrency` directly instead.
 *
 * Presentational: callers pass the raw USD major-unit amount and the text class;
 * all conversion + formatting lives in `@lib/price`.
 */

import { useCurrency } from "@lib/currency-context"
import { formatPrice } from "@lib/price"

interface PriceProps {
  /** Price in USD major units (e.g. `29` = $29.00). */
  amount: number
  /** Text/utility classes for the rendered amount. */
  className?: string
}

export default function Price({ amount, className }: PriceProps) {
  const { currency } = useCurrency()
  return <span className={className}>{formatPrice(amount, currency)}</span>
}
