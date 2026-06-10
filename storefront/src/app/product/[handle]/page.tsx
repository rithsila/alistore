"use client"

import { use, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import TopNav from "../../../components/layout/TopNav"
import Gallery from "../../../components/product/Gallery"
import VariantPicker, {
  type VariantOption,
} from "../../../components/product/VariantPicker"
import BuyBox from "../../../components/product/BuyBox"
import { getProductDetail } from "@lib/medusa"
import { addToCart } from "@lib/cart"
import { emitCartChanged } from "@lib/cart-events"

/**
 * Product detail page (FRONTEND-14; product data INTEGRATION-01; cart
 * INTEGRATION-02) — route `/product/[handle]`.
 *
 * Composes the PDP from the existing components: `Gallery` (FRONTEND-12) for the
 * images, `VariantPicker` (FRONTEND-13) for color/size selection, and `BuyBox`
 * (FRONTEND-14) for price + buy actions.
 *
 * Client Component because the selected-variant state is shared between the
 * picker and the buy box: `VariantPicker.onVariantChange` lifts the resolved
 * variant up here, and `BuyBox` reads `hasSelectedVariant` from it so the buy
 * actions are enabled only once a variant is chosen. Stack.md sanctions
 * `"use client"` exactly for the interactive PDP.
 *
 * INTEGRATION-02 wires **Add to bag**: the picker now runs on the product's real
 * Medusa variants (real `variant_id`s from `getProductDetail`), and adding posts
 * the selected variant to the cart via the `@lib/cart` server action, then
 * announces the change so the nav bag count refreshes (`@lib/cart-events`). Real
 * per-variant **inventory** (struck/disabled sold-out) is INTEGRATION-03; the
 * "Pay with KHQR" CTA is the express path: add to bag → `/checkout` (KHQR is
 * the default payment selection there — delivery details are still required
 * before the pay screen).
 */

type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductDetail>>>

type AddStatus = "idle" | "adding" | "added" | "error"

interface ProductPageProps {
  params: Promise<{ handle: string }>
}

export default function ProductPage({ params }: ProductPageProps) {
  const { handle } = use(params)
  const router = useRouter()

  // `undefined` = loading, `null` = not found, object = loaded.
  const [product, setProduct] = useState<ProductDetail | null | undefined>(
    undefined
  )
  const [selectedVariant, setSelectedVariant] = useState<VariantOption | null>(
    null
  )
  const [addStatus, setAddStatus] = useState<AddStatus>("idle")

  useEffect(() => {
    let active = true
    getProductDetail(handle).then((result) => {
      if (active) {
        setProduct(result)
      }
    })
    return () => {
      active = false
    }
  }, [handle])

  const handleAddToBag = async (): Promise<void> => {
    if (!selectedVariant || addStatus === "adding") {
      return
    }
    setAddStatus("adding")
    try {
      await addToCart({ variantId: selectedVariant.id, quantity: 1 })
      emitCartChanged()
      setAddStatus("added")
    } catch {
      setAddStatus("error")
    }
  }

  /**
   * "Pay with KHQR" express path: add the selected variant to the bag, then go
   * straight to checkout (KHQR is the default payment selection there). It
   * cannot jump to the pay screen directly — `/checkout/khqr` needs the
   * delivery details the checkout form collects (prepareKhqrCheckout).
   */
  const handlePayWithKhqr = async (): Promise<void> => {
    if (!selectedVariant || addStatus === "adding") {
      return
    }
    setAddStatus("adding")
    try {
      await addToCart({ variantId: selectedVariant.id, quantity: 1 })
      emitCartChanged()
      router.push("/checkout")
    } catch {
      setAddStatus("error")
    }
  }

  // A fresh variant choice resets any prior add feedback.
  const handleVariantChange = (variant: VariantOption | null): void => {
    setSelectedVariant(variant)
    setAddStatus("idle")
  }

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        {product === undefined ? (
          <p className="text-base font-normal leading-normal text-mute">
            Loading…
          </p>
        ) : product === null ? (
          <p className="text-base font-normal leading-normal text-mute">
            Product not found.
          </p>
        ) : (
          <div className="flex flex-col gap-section small:flex-row small:gap-xl">
            <div className="small:flex-1">
              <Gallery images={product.images} />
            </div>

            <div className="flex flex-col gap-6 small:flex-1">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium leading-normal text-mute">
                  {product.productId}
                </span>
                <h1 className="text-3xl font-medium uppercase text-ink">
                  {product.name}
                </h1>
              </div>

              <VariantPicker
                variants={product.variants}
                onVariantChange={handleVariantChange}
              />

              <BuyBox
                amount={product.amount}
                originalAmount={product.originalAmount}
                hasSelectedVariant={selectedVariant !== null}
                onAddToBag={handleAddToBag}
                onPayWithKhqr={handlePayWithKhqr}
              />

              {addStatus === "added" ? (
                <p
                  aria-live="polite"
                  className="text-xs font-medium leading-normal text-mute"
                >
                  Added to bag.{" "}
                  <Link href="/cart" className="text-ink underline">
                    View bag
                  </Link>
                </p>
              ) : addStatus === "error" ? (
                <p
                  aria-live="polite"
                  className="text-xs font-medium leading-normal text-mute"
                >
                  Couldn’t add to bag. Please try again.
                </p>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </>
  )
}
