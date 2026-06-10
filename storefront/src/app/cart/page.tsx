"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Plus, Minus, Trash } from "@medusajs/icons"

import TopNav from "../../components/layout/TopNav"
import PillButton from "../../components/ui/PillButton"
import {
  getCart,
  updateLineItem,
  removeLineItem,
  type Cart,
  type CartLine,
} from "@lib/cart"
import { emitCartChanged } from "@lib/cart-events"
import { formatPrice } from "@lib/price"
import { useCurrency } from "@lib/currency-context"

/**
 * Cart ("bag") page (FRONTEND-15; cart operations INTEGRATION-02) — route `/cart`.
 *
 * - Line items: 1:1 product thumbnail on `soft-cloud`, name + variant label,
 *   unit price (sale items show the struck-through original in `mute` followed
 *   by the sale price in `accent` — accent's only sanctioned use here), a
 *   quantity stepper (− / N / +) and a remove control.
 * - Order summary: subtotal, delivery fee (flat $1.50, zeroes to "Free" once the
 *   subtotal reaches the $50 free-delivery threshold — CLARIFY-04), total, the
 *   free-over-threshold note, and the ink Checkout `PillButton`.
 *
 * Client Component because the quantity steppers and remove control mutate the
 * cart and re-render the summary (Stack.md sanctions `"use client"` for
 * interactive surfaces). The line is read from the real session cart via the
 * `@lib/cart` server actions; quantity changes / removal call back through them
 * and announce the change so the nav bag count refreshes (`@lib/cart-events`).
 * The stepper and remove controls render inline (DESIGN.md defines no cart
 * line-item or stepper component) — the same call made for the inline KHQR CTA.
 *
 * Currency: line amounts are USD major units from Medusa, rendered through the
 * shared `@lib/price` `formatPrice` in the currency the nav toggle selected
 * (`useCurrency`, FRONTEND-22) — so the whole bag switches between USD and KHR
 * with the toggle. The free-delivery threshold logic stays in USD; only the
 * displayed amounts are converted.
 *
 * Delivery fee constants are placeholders here; sourcing them from backend
 * settings (`DELIVERY_FEE` / `FREE_DELIVERY_THRESHOLD`, BACKEND-01) is wired with
 * the checkout flow (INTEGRATION-04).
 */

// CLARIFY-04 (locked): flat delivery fee $1.50, free once subtotal ≥ $50.
const DELIVERY_FEE = 1.5
const FREE_DELIVERY_THRESHOLD = 50

const MIN_QUANTITY = 1

// Small fixed thumbnail; the image fills it (1:1, soft-cloud), the container
// width drives the responsive `sizes`.
const THUMB_SIZES = "(min-width: 600px) 96px, 80px"

const PRICE_TYPE = "text-base font-medium leading-normal"

const STEPPER_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"

interface UnitPriceProps {
  unitPrice: number
  originalUnitPrice?: number
}

function UnitPrice({ unitPrice, originalUnitPrice }: UnitPriceProps) {
  const { currency } = useCurrency()

  if (originalUnitPrice !== undefined) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${PRICE_TYPE} text-mute line-through`}>
          {formatPrice(originalUnitPrice, currency)}
        </span>
        <span className={`${PRICE_TYPE} text-accent`}>
          {formatPrice(unitPrice, currency)}
        </span>
      </div>
    )
  }

  return (
    <span className={`${PRICE_TYPE} text-ink`}>
      {formatPrice(unitPrice, currency)}
    </span>
  )
}

interface CartLineRowProps {
  line: CartLine
  busy: boolean
  onChangeQuantity: (id: string, nextQuantity: number) => void
  onRemove: (id: string) => void
}

function CartLineRow({
  line,
  busy,
  onChangeQuantity,
  onRemove,
}: CartLineRowProps) {
  const { currency } = useCurrency()

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
              {line.variantLabel
                ? `${line.productId} · ${line.variantLabel}`
                : line.productId}
            </span>
          </div>

          <button
            type="button"
            aria-label={`Remove ${line.name}`}
            disabled={busy}
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
              disabled={busy || line.quantity <= MIN_QUANTITY}
              onClick={() => onChangeQuantity(line.id, line.quantity - 1)}
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
              disabled={busy}
              onClick={() => onChangeQuantity(line.id, line.quantity + 1)}
              className={STEPPER_BUTTON}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <span className={`${PRICE_TYPE} text-ink`}>
            {formatPrice(line.lineTotal, currency)}
          </span>
        </div>
      </div>
    </li>
  )
}

export default function CartPage() {
  const router = useRouter()
  const { currency } = useCurrency()
  // `undefined` = loading, `null`/empty = empty bag, object = loaded.
  const [cart, setCart] = useState<Cart | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getCart().then((result) => {
      if (active) {
        setCart(result)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const changeQuantity = async (id: string, nextQuantity: number) => {
    if (busy || nextQuantity < MIN_QUANTITY) {
      return
    }
    setBusy(true)
    try {
      const updated = await updateLineItem({
        lineId: id,
        quantity: nextQuantity,
      })
      setCart(updated)
      emitCartChanged()
    } catch {
      // Leave the cart as-is on failure; the controls re-enable below.
    } finally {
      setBusy(false)
    }
  }

  const removeLine = async (id: string) => {
    if (busy) {
      return
    }
    setBusy(true)
    try {
      const updated = await removeLineItem(id)
      setCart(updated)
      emitCartChanged()
    } catch {
      // Leave the cart as-is on failure.
    } finally {
      setBusy(false)
    }
  }

  const lines = cart?.lines ?? []
  const isLoading = cart === undefined
  const isEmpty = !isLoading && lines.length === 0
  const subtotal = cart?.subtotal ?? 0
  const qualifiesForFreeDelivery = subtotal >= FREE_DELIVERY_THRESHOLD
  const deliveryFee = isEmpty || qualifiesForFreeDelivery ? 0 : DELIVERY_FEE
  const total = subtotal + deliveryFee

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">Bag</h1>

        {isLoading ? (
          <p className="py-section text-base font-normal leading-normal text-mute">
            Loading…
          </p>
        ) : isEmpty ? (
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
                  busy={busy}
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
                  {formatPrice(subtotal, currency)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-base font-medium leading-normal text-mute">
                  Delivery
                </span>
                <span className={`${PRICE_TYPE} text-ink`}>
                  {deliveryFee === 0
                    ? "Free"
                    : formatPrice(deliveryFee, currency)}
                </span>
              </div>

              <div className="flex items-center justify-between border-t border-hairline pt-4">
                <span className="text-base font-medium leading-normal text-ink">
                  Total
                </span>
                <span className="text-2xl font-medium leading-normal text-ink">
                  {formatPrice(total, currency)}
                </span>
              </div>

              <p className="text-xs font-medium leading-normal text-mute">
                Free delivery over{" "}
                {formatPrice(FREE_DELIVERY_THRESHOLD, currency)}
              </p>

              <PillButton
                className="w-full"
                disabled={busy}
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
