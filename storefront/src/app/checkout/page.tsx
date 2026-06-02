"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import TopNav from "../../components/layout/TopNav"
import PillButton from "../../components/ui/PillButton"
import DeliveryForm, {
  EMPTY_DELIVERY_DETAILS,
  isValidPhone,
  type DeliveryDetails,
} from "../../components/checkout/DeliveryForm"

/**
 * Checkout page (FRONTEND-16) — route `/checkout`.
 *
 * Composes the delivery info form (`DeliveryForm`), a payment-method choice
 * (KHQR / COD radio group), an order summary with total, and the Place-order
 * `PillButton` — which stays disabled until the phone is valid (the form's only
 * required field; PRD guest checkout v1 keys on phone).
 *
 * Client Component: the form values, the payment selection, and the
 * phone-driven enablement of Place-order are all interactive local state
 * (Stack.md sanctions `"use client"` for interactive surfaces / forms).
 *
 * Payment radios use ink (not accent): design.md reserves the coral accent for
 * exactly the sale price and the "Pay with KHQR" CTA — a method selector is
 * neither, so this whole page is accent-free.
 *
 * Placeholder summary, per the FRONTEND-15 precedent: amounts are in-memory USD
 * with a local formatter and the same locked delivery rule (flat $1.50, free
 * once subtotal ≥ $50 — CLARIFY-04). Reading the live cart from the Medusa SDK,
 * sourcing the fee from backend settings (BACKEND-01), POSTing the COD order
 * (`POST /store/orders/cod`) and starting KHQR are INTEGRATION-phase; this
 * task's acceptance is "submit blocked without phone; both payment options
 * selectable".
 */

// CLARIFY-04 (locked): flat delivery fee $1.50, free once subtotal ≥ $50.
const DELIVERY_FEE = 1.5
const FREE_DELIVERY_THRESHOLD = 50

// Placeholder bag subtotal until the SDK cart is wired (INTEGRATION-02).
const PLACEHOLDER_SUBTOTAL = 65

type PaymentMethod = "khqr" | "cod"

interface PaymentOption {
  value: PaymentMethod
  title: string
  description: string
}

const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    value: "khqr",
    title: "Bakong KHQR",
    description: "Scan to pay with any Cambodian banking app.",
  },
  {
    value: "cod",
    title: "Cash on delivery",
    description: "Pay in cash when your order arrives.",
  },
]

/** Minimal USD display formatter (FRONTEND-22 supplies the full USD/KHR one). */
function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

interface PaymentChoiceProps {
  selected: PaymentMethod
  onSelect: (method: PaymentMethod) => void
}

function PaymentChoice({ selected, onSelect }: PaymentChoiceProps) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-base font-medium leading-normal text-ink">
        Payment
      </legend>
      {PAYMENT_OPTIONS.map((option) => {
        const isSelected = option.value === selected
        return (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-large border bg-canvas p-4 ${
              isSelected ? "border-ink" : "border-hairline"
            }`}
          >
            <input
              type="radio"
              name="payment-method"
              value={option.value}
              checked={isSelected}
              onChange={() => onSelect(option.value)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-circle border ${
                isSelected ? "border-ink" : "border-hairline"
              }`}
            >
              {isSelected ? (
                <span className="h-2.5 w-2.5 rounded-circle bg-ink" />
              ) : null}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-base font-medium leading-normal text-ink">
                {option.title}
              </span>
              <span className="text-xs font-medium leading-normal text-mute">
                {option.description}
              </span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

export default function CheckoutPage() {
  const router = useRouter()
  const [details, setDetails] = useState<DeliveryDetails>(
    EMPTY_DELIVERY_DETAILS
  )
  const [payment, setPayment] = useState<PaymentMethod>("khqr")

  const subtotal = PLACEHOLDER_SUBTOTAL
  const qualifiesForFreeDelivery = subtotal >= FREE_DELIVERY_THRESHOLD
  const deliveryFee = qualifiesForFreeDelivery ? 0 : DELIVERY_FEE
  const total = subtotal + deliveryFee

  const canPlaceOrder = isValidPhone(details.phone)

  const handlePlaceOrder = () => {
    if (!canPlaceOrder) {
      return
    }
    if (payment === "khqr") {
      router.push("/checkout/khqr")
    }
    // COD order placement (`POST /store/orders/cod` → `/order/[id]`) is wired in
    // the INTEGRATION phase; this page only collects and validates the inputs.
  }

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">Checkout</h1>

        <div className="mt-section flex flex-col gap-section small:flex-row small:gap-xl">
          <div className="flex flex-col gap-section small:flex-1">
            <DeliveryForm values={details} onChange={setDetails} />
            <PaymentChoice selected={payment} onSelect={setPayment} />
          </div>

          <section
            aria-label="Order summary"
            className="flex h-fit flex-col gap-4 small:w-80 small:shrink-0"
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-medium leading-normal text-mute">
                Subtotal
              </span>
              <span className="text-base font-medium leading-normal text-ink">
                {formatUsd(subtotal)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-base font-medium leading-normal text-mute">
                Delivery
              </span>
              <span className="text-base font-medium leading-normal text-ink">
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
              disabled={!canPlaceOrder}
              onClick={handlePlaceOrder}
            >
              Place order
            </PillButton>
          </section>
        </div>
      </main>
    </>
  )
}
