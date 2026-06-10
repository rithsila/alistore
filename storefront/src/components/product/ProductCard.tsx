import Image from "next/image"
import Link from "next/link"

import Price from "../ui/Price"

/**
 * Catalog product tile (DESIGN.md product-card / FRONTEND-05).
 *
 * - 1:1 product image, full-bleed on `soft-cloud`, no radius (driven by the
 *   grid via `next/image` `fill` + explicit `sizes`; no fixed pixel size).
 * - Zero card padding; metadata rows sit directly below the image with an
 *   8px gap (DESIGN.md "Card internal padding").
 * - Product ID = mute caption-sm (12/500); name = body-strong (16/500).
 * - Price block: full-price items show a single ink price; sale items show the
 *   struck-through original in `mute` followed by the sale price in `accent`
 *   (accent is one of its only two permitted uses — sale price text).
 *
 * Prices are passed in as raw USD amounts and rendered through the
 * currency-reactive `ui/Price` island, so each tile switches between USD and KHR
 * the instant the nav toggle flips while the card itself stays server-rendered.
 */

interface ProductCardProps {
  /** Style number / product reference shown as the mute caption-sm line. */
  productId: string
  /** Product handle — the whole tile links to `/product/[handle]`. */
  handle: string
  /** Product name (body-strong). */
  name: string
  /** Square product image URL. */
  imageSrc: string
  /** Accessible alt text for the product image. */
  imageAlt: string
  /** Current price in USD major units (e.g. `29` = $29.00). */
  amount: number
  /**
   * Original price in USD major units. When provided the tile is treated as on
   * sale: the original is struck through in mute and `amount` renders in accent.
   * A discount-percent badge is computed and shown on the image automatically.
   */
  originalAmount?: number
  /** When true, renders a "NEW" badge on the image. */
  isNew?: boolean
}

// Matches the FRONTEND-06 grid: 4-up (≥1440) / 3-up (desktop) / 2-up (≤1023) / 1-up (≤599).
const IMAGE_SIZES =
  "(min-width: 1440px) 25vw, (min-width: 1024px) 33vw, (min-width: 600px) 50vw, 100vw"

const PRICE_TYPE = "text-base font-medium leading-normal"

const BADGE =
  "rounded-base bg-ink px-2 py-1 text-xs font-medium leading-none text-canvas"

export default function ProductCard({
  productId,
  handle,
  name,
  imageSrc,
  imageAlt,
  amount,
  originalAmount,
  isNew = false,
}: ProductCardProps) {
  const isOnSale = originalAmount !== undefined
  const discountPercent = isOnSale
    ? Math.round((1 - amount / originalAmount!) * 100)
    : undefined

  return (
    <Link href={`/product/${handle}`} className="flex flex-col">
      <div className="relative aspect-square w-full bg-soft-cloud">
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          sizes={IMAGE_SIZES}
          className="object-cover"
        />
        {(isNew || discountPercent !== undefined) && (
          <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
            {isNew && <span className={BADGE}>NEW</span>}
            {discountPercent !== undefined && (
              <span className={BADGE}>-{discountPercent}%</span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <span className="text-xs font-medium leading-normal text-mute">
          {productId}
        </span>
        <h3 className={`${PRICE_TYPE} text-ink`}>{name}</h3>

        {isOnSale ? (
          <div className="flex items-center gap-2">
            <Price
              amount={originalAmount}
              className={`${PRICE_TYPE} text-mute line-through`}
            />
            <Price amount={amount} className={`${PRICE_TYPE} text-accent`} />
          </div>
        ) : (
          <Price amount={amount} className={`${PRICE_TYPE} text-ink`} />
        )}
      </div>
    </Link>
  )
}
