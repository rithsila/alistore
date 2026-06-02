"use client"

import { useState } from "react"
import Image from "next/image"

/**
 * PDP image gallery (FRONTEND-12).
 *
 * - Large 1:1 main image, full-bleed on `soft-cloud`, no radius (`next/image`
 *   `fill` + explicit `sizes`; same image treatment as `ProductCard`).
 * - Thumbnail strip below the main image: a horizontally scrollable row of 1:1
 *   thumbnails on `soft-cloud`. Selecting a thumbnail swaps the main image.
 * - The active thumbnail is marked with a 1px ink border (other thumbnails keep
 *   a transparent border so selection doesn't shift layout). Ink — not accent —
 *   per the design rule that accent is reserved for sale price + the KHQR CTA.
 *
 * Client component because the active-thumbnail selection is local interactive
 * state. The strip is hidden when there's a single image.
 */

interface GalleryImage {
  /** Square image URL. */
  src: string
  /** Accessible alt text. */
  alt: string
}

interface GalleryProps {
  images: GalleryImage[]
}

// Main image spans full width on mobile, ~half the viewport on desktop PDP.
const MAIN_SIZES = "(min-width: 1024px) 50vw, 100vw"

// Thumbnails are a fixed 64px square (8px-grid aligned via `h-16 w-16`).
const THUMB_SIZES = "64px"

export default function Gallery({ images }: GalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  const activeImage = images[activeIndex]

  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-square w-full bg-soft-cloud">
        {activeImage ? (
          <Image
            src={activeImage.src}
            alt={activeImage.alt}
            fill
            sizes={MAIN_SIZES}
            priority
            className="object-cover"
          />
        ) : null}
      </div>

      {images.length > 1 ? (
        <ul
          aria-label="Product image thumbnails"
          className="flex gap-2 overflow-x-auto"
        >
          {images.map((image, index) => {
            const isActive = index === activeIndex
            return (
              <li key={image.src} className="shrink-0">
                <button
                  type="button"
                  aria-label={`Show image ${index + 1}`}
                  aria-pressed={isActive}
                  onClick={() => setActiveIndex(index)}
                  className={`relative block h-16 w-16 overflow-hidden bg-soft-cloud border ${
                    isActive ? "border-ink" : "border-transparent"
                  }`}
                >
                  <Image
                    src={image.src}
                    alt={image.alt}
                    fill
                    sizes={THUMB_SIZES}
                    className="object-cover"
                  />
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
