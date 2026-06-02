"use client"

import { Scan } from "@medusajs/icons"

import PillButton from "../ui/PillButton"

/**
 * PDP action block — price + buy actions (FRONTEND-14).
 *
 * - Price row mirrors `ProductCard`: full-price items show a single ink price;
 *   sale items show the struck-through original in `mute` followed by the sale
 *   price in `accent` (accent is one of its only two permitted uses — sale price
 *   text and the KHQR CTA below).
 * - "Add to bag" reuses the `PillButton` primitive (ink primary).
 * - "Pay with KHQR" is the outline accent CTA (the design's second sanctioned
 *   accent use). It matches `PillButton`'s geometry (48px pill, button-md type)
 *   but renders as an accent-bordered outline with the `Scan` icon — there is no
 *   outline-button primitive, so this one-off CTA lives inline in its own
 *   deliverable rather than introducing a new `ui/` primitive.
 * - Free-delivery note (caption-sm, mute): free over $50 (the v1 threshold cited
 *   across FRONTEND-14/15/16).
 *
 * Both CTAs are enabled only when a variant is selected (`hasSelectedVariant`),
 * driven by the parent PDP page from `VariantPicker` (FRONTEND-13). Presentational:
 * prices arrive display-ready (already formatted/currency-applied).
 */

interface BuyBoxProps {
  /** Display-ready current price (e.g. "$29.00"). */
  price: string
  /**
   * Display-ready original price. When provided the block is treated as on
   * sale: the original is struck through in mute and `price` renders in accent.
   */
  originalPrice?: string
  /** Buy actions are enabled only when a variant is selected. */
  hasSelectedVariant: boolean
  onAddToBag?: () => void
  onPayWithKhqr?: () => void
}

const PRICE_TYPE = "text-2xl font-medium leading-normal"

// Outline accent CTA: same geometry as PillButton, accent border + text.
const KHQR_BUTTON =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-pill border border-accent bg-canvas px-6 py-3 text-base font-medium leading-normal text-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

export default function BuyBox({
  price,
  originalPrice,
  hasSelectedVariant,
  onAddToBag,
  onPayWithKhqr,
}: BuyBoxProps) {
  const isOnSale = originalPrice !== undefined

  return (
    <div className="flex flex-col gap-6">
      {isOnSale ? (
        <div className="flex items-center gap-2">
          <span className={`${PRICE_TYPE} text-mute line-through`}>
            {originalPrice}
          </span>
          <span className={`${PRICE_TYPE} text-accent`}>{price}</span>
        </div>
      ) : (
        <span className={`${PRICE_TYPE} text-ink`}>{price}</span>
      )}

      <div className="flex flex-col gap-3">
        <PillButton
          className="w-full"
          disabled={!hasSelectedVariant}
          onClick={onAddToBag}
        >
          Add to bag
        </PillButton>

        <button
          type="button"
          disabled={!hasSelectedVariant}
          onClick={onPayWithKhqr}
          className={KHQR_BUTTON}
        >
          <Scan className="h-5 w-5" />
          Pay with KHQR
        </button>
      </div>

      <p className="text-xs font-medium leading-normal text-mute">
        Free delivery over $50
      </p>
    </div>
  )
}
