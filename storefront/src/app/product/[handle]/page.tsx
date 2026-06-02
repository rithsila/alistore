"use client"

import { useState } from "react"

import TopNav from "../../../components/layout/TopNav"
import Gallery from "../../../components/product/Gallery"
import VariantPicker, {
  type VariantOption,
} from "../../../components/product/VariantPicker"
import BuyBox from "../../../components/product/BuyBox"

/**
 * Product detail page (FRONTEND-14) — route `/product/[handle]`.
 *
 * Composes the PDP from the existing components: `Gallery` (FRONTEND-12) for the
 * images, `VariantPicker` (FRONTEND-13) for color/size/stock selection, and
 * `BuyBox` (this task) for price + buy actions.
 *
 * Client Component because the selected-variant state is shared between the
 * picker and the buy box: `VariantPicker.onVariantChange` lifts the resolved
 * variant up here, and `BuyBox` reads `hasSelectedVariant` from it so the buy
 * actions are enabled only once a variant is chosen. Stack.md sanctions
 * `"use client"` exactly for the variant picker / interactive PDP.
 *
 * Placeholder data, per the FRONTEND-09/10 pattern: images use the Medusa demo
 * bucket already allow-listed in `next.config.js`. Fetching the real product by
 * the route `handle` via the Medusa SDK is INTEGRATION-phase work; this task's
 * acceptance is composition + variant-gated buttons.
 */

const DEMO_IMAGE_HOST =
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com"

const PLACEHOLDER_IMAGES = [
  {
    src: `${DEMO_IMAGE_HOST}/tee-black-front.png`,
    alt: "Black classic cotton t-shirt, front view",
  },
  {
    src: `${DEMO_IMAGE_HOST}/tee-black-back.png`,
    alt: "Black classic cotton t-shirt, back view",
  },
]

// colorHex carries each colorway's actual product color (swatch fill data),
// not a chrome token; some sizes are stocked 0 to exercise the sold-out path.
const PLACEHOLDER_VARIANTS: VariantOption[] = [
  { id: "v-black-s", color: "Black", colorHex: "#111111", size: "S", stock: 4 },
  { id: "v-black-m", color: "Black", colorHex: "#111111", size: "M", stock: 9 },
  { id: "v-black-l", color: "Black", colorHex: "#111111", size: "L", stock: 0 },
  { id: "v-white-s", color: "White", colorHex: "#ffffff", size: "S", stock: 6 },
  { id: "v-white-m", color: "White", colorHex: "#ffffff", size: "M", stock: 0 },
  { id: "v-white-l", color: "White", colorHex: "#ffffff", size: "L", stock: 3 },
]

const PLACEHOLDER_PRODUCT = {
  productId: "AS-1001",
  name: "Classic Tee",
  price: "$29.00",
  originalPrice: "$39.00",
}

export default function ProductPage() {
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(
    null
  )

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <div className="flex flex-col gap-section small:flex-row small:gap-xl">
          <div className="small:flex-1">
            <Gallery images={PLACEHOLDER_IMAGES} />
          </div>

          <div className="flex flex-col gap-6 small:flex-1">
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium leading-normal text-mute">
                {PLACEHOLDER_PRODUCT.productId}
              </span>
              <h1 className="text-3xl font-medium uppercase text-ink">
                {PLACEHOLDER_PRODUCT.name}
              </h1>
            </div>

            <VariantPicker
              variants={PLACEHOLDER_VARIANTS}
              onVariantChange={setSelectedVariant}
            />

            <BuyBox
              price={PLACEHOLDER_PRODUCT.price}
              originalPrice={PLACEHOLDER_PRODUCT.originalPrice}
              hasSelectedVariant={selectedVariant !== null}
            />
          </div>
        </div>
      </main>
    </>
  )
}
