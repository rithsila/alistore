"use client"

import { useMemo, useState } from "react"

import Chip from "../ui/Chip"

/**
 * PDP variant picker — color + size + live stock (FRONTEND-13; real inventory
 * wired in INTEGRATION-03).
 *
 * Driven by real Medusa per-variant inventory: `getProductDetail` (`@lib/medusa`)
 * supplies each variant's live available count as `stock`, so sold-out variants
 * from the DB render struck/disabled here. `stock` of `Infinity` marks a variant
 * that doesn't manage inventory / allows backorder (always purchasable) and is
 * shown as available without a count.
 *
 * - Color swatch dots (DESIGN.md `swatch-dot` / `swatch-dot-active`): each dot is
 *   filled with the colorway's actual product color (passed in as data via
 *   `colorHex` — the design spec defines swatch fills as product data extracted at
 *   runtime, not a chrome token). Inactive dots carry a 1px `hairline` ring so
 *   light/white colorways stay visible; the active dot gets the spec'd concentric
 *   ring — a 2px `ink` outer ring with a 2px `canvas` interior gap (Tailwind
 *   `ring` + `ring-offset`, the design's documented selected-state, not a
 *   decorative shadow).
 * - Size pills reuse the `Chip` primitive (active = ink fill). A size with no
 *   in-stock variant for the selected color is disabled + struck through.
 * - Stock note (caption-sm, mute): "{n} left" once an in-stock size is chosen
 *   (or "In stock" when the variant is unlimited), prompting "Select a size"
 *   until then; sold-out sizes are conveyed by the struck pills.
 *
 * Purely presentational: it owns the color/size selection state and surfaces the
 * resolved (in-stock) variant via `onVariantChange` so the PDP action block
 * (FRONTEND-14) can enable buy actions only when a variant is selected. Swatch
 * touch targets are 44px to stay accessible while keeping the visible dot small.
 *
 * Client component because selection is local interactive state.
 */

export interface VariantOption {
  /** Variant id (maps to a Medusa product variant). */
  id: string
  /** Colorway name, e.g. "Black". */
  color: string
  /** The colorway's actual product color, used as the swatch fill. */
  colorHex: string
  /** Size label, e.g. "M". */
  size: string
  /**
   * Available inventory for this variant: real units left, `0` (or less) for
   * sold out, or `Infinity` for an unlimited (unmanaged/backorder) variant.
   */
  stock: number
}

interface VariantPickerProps {
  variants: VariantOption[]
  /** Fires with the resolved in-stock variant, or null when none is selected. */
  onVariantChange?: (variant: VariantOption | null) => void
}

// heading-md (DESIGN.md): 16 / 500 / 1.75 — matches the FilterSidebar group label.
const GROUP_LABEL = "text-base font-medium leading-7 text-ink"

export default function VariantPicker({
  variants,
  onVariantChange,
}: VariantPickerProps) {
  // Unique colors in first-seen order, each carrying its swatch fill. Blank
  // color names are skipped so products with no colorway option (size-only)
  // render the size group alone instead of an empty swatch.
  const colors = useMemo(() => {
    const seen = new Map<string, string>()
    for (const variant of variants) {
      const color = variant.color.trim()
      if (color && !seen.has(color)) {
        seen.set(color, variant.colorHex)
      }
    }
    return Array.from(seen, ([color, colorHex]) => ({ color, colorHex }))
  }, [variants])

  // Unique sizes in first-seen order.
  const sizes = useMemo(() => {
    const seen = new Set<string>()
    for (const variant of variants) {
      seen.add(variant.size)
    }
    return Array.from(seen)
  }, [variants])

  const [selectedColor, setSelectedColor] = useState<string>(
    colors[0]?.color ?? ""
  )
  const [selectedSize, setSelectedSize] = useState<string | null>(null)

  const findVariant = (color: string, size: string): VariantOption | null =>
    variants.find((v) => v.color === color && v.size === size) ?? null

  const stockFor = (color: string, size: string): number =>
    findVariant(color, size)?.stock ?? 0

  // A size is only ever selectable when in stock, so a set selection resolves to
  // an in-stock variant; otherwise emit null so the PDP keeps buy actions off.
  const emitChange = (color: string, size: string | null): void => {
    const variant = size ? findVariant(color, size) : null
    onVariantChange?.(variant && variant.stock > 0 ? variant : null)
  }

  const handleColorSelect = (color: string): void => {
    // Keep the chosen size only if it's still in stock for the new color.
    const nextSize =
      selectedSize && stockFor(color, selectedSize) > 0 ? selectedSize : null
    setSelectedColor(color)
    setSelectedSize(nextSize)
    emitChange(color, nextSize)
  }

  const handleSizeSelect = (size: string): void => {
    if (stockFor(selectedColor, size) <= 0) {
      return
    }
    setSelectedSize(size)
    emitChange(selectedColor, size)
  }

  const selectedVariant = selectedSize
    ? findVariant(selectedColor, selectedSize)
    : null

  let stockNote: string
  if (!selectedSize) {
    stockNote = "Select a size"
  } else if (!selectedVariant || selectedVariant.stock <= 0) {
    stockNote = "Sold out"
  } else if (Number.isFinite(selectedVariant.stock)) {
    stockNote = `${selectedVariant.stock} left`
  } else {
    stockNote = "In stock"
  }

  return (
    <div className="flex flex-col gap-6">
      {colors.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className={GROUP_LABEL}>Color</span>
            {selectedColor ? (
              <span className="text-base font-normal leading-normal text-mute">
                {selectedColor}
              </span>
            ) : null}
          </div>
          <div role="group" aria-label="Color" className="flex flex-wrap gap-2">
            {colors.map(({ color, colorHex }) => {
              const isActive = color === selectedColor
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  aria-pressed={isActive}
                  onClick={() => handleColorSelect(color)}
                  className="inline-flex h-11 w-11 items-center justify-center"
                >
                  <span
                    className={`block h-8 w-8 rounded-full ${
                      isActive
                        ? "ring-2 ring-ink ring-offset-2 ring-offset-canvas"
                        : "ring-1 ring-hairline"
                    }`}
                    style={{ backgroundColor: colorHex }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {sizes.length > 0 ? (
        <div className="flex flex-col gap-3">
          <span className={GROUP_LABEL}>Size</span>
          <div role="group" aria-label="Size" className="flex flex-wrap gap-2">
            {sizes.map((size) => {
              const soldOut = stockFor(selectedColor, size) <= 0
              return (
                <Chip
                  key={size}
                  active={size === selectedSize}
                  disabled={soldOut}
                  aria-label={soldOut ? `${size}, sold out` : size}
                  className={
                    soldOut ? "cursor-not-allowed line-through opacity-50" : ""
                  }
                  onClick={() => handleSizeSelect(size)}
                >
                  {size}
                </Chip>
              )
            })}
          </div>
          <p
            aria-live="polite"
            className="text-xs font-medium leading-normal text-mute"
          >
            {stockNote}
          </p>
        </div>
      ) : null}
    </div>
  )
}
