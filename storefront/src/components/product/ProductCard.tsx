import Image from "next/image"
import Link from "next/link"

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
 * Prices are passed in display-ready (already formatted/currency-applied) so
 * the card stays purely presentational; currency formatting is out of scope.
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
  /** Display-ready current price (e.g. "$29.00"). */
  price: string
  /**
   * Display-ready original price. When provided the tile is treated as on
   * sale: the original is struck through in mute and `price` renders in accent.
   */
  originalPrice?: string
}

// Matches the FRONTEND-06 grid: 4-up (≥1440) / 3-up (desktop) / 2-up (≤1023) / 1-up (≤599).
const IMAGE_SIZES =
  "(min-width: 1440px) 25vw, (min-width: 1024px) 33vw, (min-width: 600px) 50vw, 100vw"

const PRICE_TYPE = "text-base font-medium leading-normal"

export default function ProductCard({
  productId,
  handle,
  name,
  imageSrc,
  imageAlt,
  price,
  originalPrice,
}: ProductCardProps) {
  const isOnSale = originalPrice !== undefined

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
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <span className="text-xs font-medium leading-normal text-mute">
          {productId}
        </span>
        <h3 className={`${PRICE_TYPE} text-ink`}>{name}</h3>

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
      </div>
    </Link>
  )
}
