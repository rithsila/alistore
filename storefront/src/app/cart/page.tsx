"use client"

import { useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Plus, Minus, Trash } from "@medusajs/icons"

import TopNav from "../../components/layout/TopNav"
import PillButton from "../../components/ui/PillButton"

/**
 * Cart ("bag") page (FRONTEND-15) — route `/cart`.
 *
 * - Line items: 1:1 product thumbnail on `soft-cloud`, name + variant label,
 *   unit price (sale items show the struck-through original in `mute` followed
 *   by the sale price in `accent` — accent's only sanctioned use here), a
 *   quantity stepper (− / N / +) and a remove control.
 * - Order summary: subtotal, delivery fee (flat $1.50, zeroes to "Free" once the
 *   subtotal reaches the $50 free-delivery threshold — CLARIFY-04), total, the
 *   free-over-threshold note, and the ink Checkout `PillButton`.
 *
 * Client Component because quantity steppers and remove mutate local cart state
 * and the subtotal/fee recompute live (Stack.md sanctions `"use client"` for
 * interactive surfaces). The stepper and remove controls render inline in this
 * deliverable rather than introducing new `ui/` primitives — the same call made
 * for the inline KHQR CTA in FRONTEND-14 (BuyBox); DESIGN.md defines no cart
 * line-item or stepper component, so none is invented mid-task.
 *
 * Placeholder lines, per the FRONTEND-09/10/14 pattern: thumbnails use the
 * Medusa demo bucket already allow-listed in `next.config.js`. Real cart
 * create/line-item add/update/delete via the Medusa SDK (and persisting the
 * cart id) is INTEGRATION-02; this task's acceptance is "qty change updates
 * subtotal; fee shows/zeroes per threshold".
 *
 * Currency: amounts are held as numeric USD and rendered with a minimal local
 * USD formatter so the subtotal can be recomputed on quantity change. The full
 * multi-currency (USD/KHR via `USD_KHR_RATE`) formatter is FRONTEND-22
 * (`src/lib/price.ts`), wired in the INTEGRATION phase.
 */

const DEMO_IMAGE_HOST =
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com"

// CLARIFY-04 (locked): flat delivery fee $1.50, free once subtotal ≥ $50.
// Sourced from env (`DELIVERY_FEE` / `FREE_DELIVERY_THRESHOLD`) via backend
// settings (BACKEND-01) at INTEGRATION time; held as named constants on this
// presentational placeholder page.
const DELIVERY_FEE = 1.5
const FREE_DELIVERY_THRESHOLD = 50

const MIN_QUANTITY = 1

interface CartLine {
  id: string
  productId: string
  name: string
  /** Display label for the chosen variant, e.g. "Black / M". */
  variantLabel: string
  imageSrc: string
  imageAlt: string
  /** Current unit price in USD. */
  unitPrice: number
  /** When set, the line is on sale: original struck in mute, current in accent. */
  originalUnitPrice?: number
  quantity: number
}

const PLACEHOLDER_LINES: CartLine[] = [
  {
    id: "line-1",
    productId: "AS-1001",
    name: "Classic Tee",
    variantLabel: "Black / M",
    imageSrc: `${DEMO_IMAGE_HOST}/tee-black-front.png`,
    imageAlt: "Black classic cotton t-shirt, front view",
    unitPrice: 29,
    originalUnitPrice: 39,
    quantity: 1,
  },
  {
    id: "line-2",
    productId: "AS-1002",
    name: "Everyday Hoodie",
    variantLabel: "White / L",
    imageSrc: `${DEMO_IMAGE_HOST}/tee-white-front.png`,
    imageAlt: "White everyday hoodie, front view",
    unitPrice: 18,
    quantity: 2,
  },
]

// Small fixed thumbnail; the image fills it (1:1, soft-cloud), the container
// width drives the responsive `sizes`.
const THUMB_SIZES = "(min-width: 600px) 96px, 80px"

const PRICE_TYPE = "text-base font-medium leading-normal"

const STEPPER_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"

/** Minimal USD display formatter (FRONTEND-22 supplies the full USD/KHR one). */
function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

interface UnitPriceProps {
  unitPrice: number
  originalUnitPrice?: number
}

function UnitPrice({ unitPrice, originalUnitPrice }: UnitPriceProps) {
  if (originalUnitPrice !== undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${PRICE_TYPE} text-mute line-through`}>
          {formatUsd(originalUnitPrice)}
        </span>
        <span className={`${PRICE_TYPE} text-accent`}>
          {formatUsd(unitPrice)}
        </span>
      </div>
    )
  }

  return (
    <span className={`${PRICE_TYPE} text-ink`}>{formatUsd(unitPrice)}</span>
  )
}

interface CartLineRowProps {
  line: CartLine
  onChangeQuantity: (id: string, delta: number) => void
  onRemove: (id: string) => void
}

function CartLineRow({ line, onChangeQuantity, onRemove }: CartLineRowProps) {
  return (
    <li className="flex gap-4 border-b border-hairline py-4">
      <div className="relative aspect-square w-20 shrink-0 bg-soft-cloud min-[600px]:w-24">
        <Image
          src={line.imageSrc}
          alt={line.imageAlt}
          fill
          sizes={THUMB_SIZES}
          className="object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className={`${PRICE_TYPE} text-ink`}>{line.name}</h2>
            <span className="text-xs font-medium leading-normal text-mute">
              {line.productId} · {line.variantLabel}
            </span>
          </div>

          <button
            type="button"
            aria-label={`Remove ${line.name}`}
            onClick={() => onRemove(line.id)}
            className={STEPPER_BUTTON}
          >
            <Trash className="h-5 w-5" />
          </button>
        </div>

        <UnitPrice
          unitPrice={line.unitPrice}
          originalUnitPrice={line.originalUnitPrice}
        />

        <div className="mt-2 flex items-center justify-between gap-4">
          <div
            className="inline-flex items-center rounded-pill border border-hairline"
            role="group"
            aria-label={`Quantity for ${line.name}`}
          >
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={line.quantity <= MIN_QUANTITY}
              onClick={() => onChangeQuantity(line.id, -1)}
              className={STEPPER_BUTTON}
            >
              <Minus className="h-4 w-4" />
            </button>
            <span
              aria-live="polite"
              className="min-w-8 text-center text-base font-medium leading-normal text-ink"
            >
              {line.quantity}
            </span>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => onChangeQuantity(line.id, 1)}
              className={STEPPER_BUTTON}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <span className={`${PRICE_TYPE} text-ink`}>
            {formatUsd(line.unitPrice * line.quantity)}
          </span>
        </div>
      </div>
    </li>
  )
}

export default function CartPage() {
  const router = useRouter()
  const [lines, setLines] = useState<CartLine[]>(PLACEHOLDER_LINES)

  const changeQuantity = (id: string, delta: number) => {
    setLines((prev) =>
      prev.map((line) =>
        line.id === id
          ? {
              ...line,
              quantity: Math.max(MIN_QUANTITY, line.quantity + delta),
            }
          : line
      )
    )
  }

  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((line) => line.id !== id))
  }

  const subtotal = lines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0
  )
  const isEmpty = lines.length === 0
  const qualifiesForFreeDelivery = subtotal >= FREE_DELIVERY_THRESHOLD
  const deliveryFee = isEmpty || qualifiesForFreeDelivery ? 0 : DELIVERY_FEE
  const total = subtotal + deliveryFee

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">Bag</h1>

        {isEmpty ? (
          <div className="flex flex-col items-start gap-6 py-section">
            <p className="text-base font-medium leading-normal text-mute">
              Your bag is empty.
            </p>
            <PillButton onClick={() => router.push("/")}>
              Continue shopping
            </PillButton>
          </div>
        ) : (
          <div className="mt-section flex flex-col gap-section small:flex-row small:gap-xl">
            <ul className="flex flex-col small:flex-1">
              {lines.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  onChangeQuantity={changeQuantity}
                  onRemove={removeLine}
                />
              ))}
            </ul>

            <section
              aria-label="Order summary"
              className="flex flex-col gap-4 small:w-80 small:shrink-0"
            >
              <div className="flex items-center justify-between">
                <span className="text-base font-medium leading-normal text-mute">
                  Subtotal
                </span>
                <span className={`${PRICE_TYPE} text-ink`}>
                  {formatUsd(subtotal)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-base font-medium leading-normal text-mute">
                  Delivery
                </span>
                <span className={`${PRICE_TYPE} text-ink`}>
                  {deliveryFee === 0 ? "Free" : formatUsd(deliveryFee)}
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-hairline pt-4">
                <span className="text-base font-medium leading-normal text-ink">
                  Total
                </span>
                <span className="text-2xl font-medium leading-normal text-ink">
                  {formatUsd(total)}
                </span>
              </div>

              <p className="text-xs font-medium leading-normal text-mute">
                Free delivery over $50
              </p>

              <PillButton
                className="w-full"
                onClick={() => router.push("/checkout")}
              >
                Checkout
              </PillButton>
            </section>
          </div>
        )}
      </main>
    </>
  )
}
