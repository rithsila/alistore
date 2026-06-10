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
import FacebookLogin from "../../components/checkout/FacebookLogin"
import GoogleLogin from "../../components/checkout/GoogleLogin"
import { placeCodOrder, prepareKhqrCheckout } from "@lib/checkout"
import { formatPrice } from "@lib/price"
import { useCurrency } from "@lib/currency-context"

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
 * with the same locked delivery rule (flat $1.50, free once subtotal ≥ $50 —
 * CLARIFY-04). The displayed amounts render through the shared `@lib/price`
 * `formatPrice` in the currency the nav toggle selected (`useCurrency`), so the
 * summary switches between USD and KHR with the toggle; the threshold logic stays
 * in USD. Reading the live cart from the Medusa SDK and sourcing the fee from
 * backend settings (BACKEND-01) remain follow-ups.
 *
 * COD submission is wired (INTEGRATION-04): the COD branch calls
 * `placeCodOrder` (`@lib/checkout`), which preps the cart + POSTs
 * `/store/orders/cod`, then routes to the COD confirmation
 * (`/order/[id]?status=cod&token=…`, the order's invoice token carried through
 * for the INTEGRATION-07 invoice link). The KHQR branch (INTEGRATION-05) preps
 * the cart with the same contact via `prepareKhqrCheckout` — completion on the
 * paid flip requires the cart's email/address/shipping method — then routes to
 * `/checkout/khqr` for the start/poll screen.
 *
 * Social login is wired: `FacebookLogin` (INTEGRATION-06) and `GoogleLogin`
 * (INTEGRATION-06B) are mounted side by side, and each one's `onPrefillName`
 * drops the signed-in customer's name into the Full Name field on return from a
 * completed OAuth round-trip. Both share the same session/prefill path — the
 * session is read server-side by `@lib/auth` (`getSocialLoginPrefillName`).
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
    title: "KHQR",
    description: "Scan to pay with any Cambodian banking app.",
  },
  {
    value: "cod",
    title: "Cash on delivery",
    description: "Pay in cash when your order arrives.",
  },
]

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
  const { currency } = useCurrency()
  const [details, setDetails] = useState<DeliveryDetails>(
    EMPTY_DELIVERY_DETAILS
  )
  const [payment, setPayment] = useState<PaymentMethod>("khqr")
  const [isPlacing, setIsPlacing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subtotal = PLACEHOLDER_SUBTOTAL
  const qualifiesForFreeDelivery = subtotal >= FREE_DELIVERY_THRESHOLD
  const deliveryFee = qualifiesForFreeDelivery ? 0 : DELIVERY_FEE
  const total = subtotal + deliveryFee

  const canPlaceOrder = isValidPhone(details.phone)

  // INTEGRATION-06 / 06B: on return from a completed social login (Facebook or
  // Google), prefill the name.
  const handlePrefillName = (name: string) => {
    setDetails((prev) => ({ ...prev, fullName: name }))
  }

  const handlePlaceOrder = async () => {
    if (!canPlaceOrder || isPlacing) {
      return
    }
    setError(null)

    if (payment === "khqr") {
      // INTEGRATION-05: prep the cart (email + Cambodia address + shipping
      // method) with the form's contact BEFORE the pay screen — the paid flip
      // (BACKEND-03B) completes the cart into an order and requires all three
      // (same prep as COD). On failure show the customer-safe message and stay.
      setIsPlacing(true)
      const prep = await prepareKhqrCheckout(details)
      if (prep.ok) {
        router.push("/checkout/khqr")
        return
      }
      setError(prep.error)
      setIsPlacing(false)
      return
    }

    // COD: prep the cart + place the order (BACKEND-04), then land on the COD
    // confirmation. On failure, surface a customer-safe message and re-enable.
    setIsPlacing(true)
    const result = await placeCodOrder(details)
    if (result.ok) {
      // Carry the order's invoice token (INTEGRATION-07) so the confirmation
      // page can build a working invoice link; the token is URL-safe (base64url).
      const params = new URLSearchParams({ status: "cod" })
      if (result.invoiceToken) {
        params.set("token", result.invoiceToken)
      }
      router.push(`/order/${result.orderId}?${params.toString()}`)
      return
    }
    setError(result.error)
    setIsPlacing(false)
  }

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">Checkout</h1>

        <div className="mt-section flex flex-col gap-section small:flex-row small:gap-xl">
          <div className="flex flex-col gap-section small:flex-1">
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium leading-normal text-mute">
                Have an account? Sign in to fill your details faster.
              </p>
              <FacebookLogin onPrefillName={handlePrefillName} />
              <GoogleLogin onPrefillName={handlePrefillName} />
            </div>
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
                {formatPrice(subtotal, currency)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-base font-medium leading-normal text-mute">
                Delivery
              </span>
              <span className="text-base font-medium leading-normal text-ink">
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

            {error && (
              <p
                role="alert"
                className="text-xs font-medium leading-normal text-ink"
              >
                {error}
              </p>
            )}

            <PillButton
              className="w-full"
              disabled={!canPlaceOrder || isPlacing}
              onClick={handlePlaceOrder}
            >
              {isPlacing ? "Placing order…" : "Place order"}
            </PillButton>
          </section>
        </div>
      </main>
    </>
  )
}
