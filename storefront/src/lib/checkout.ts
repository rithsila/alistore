"use server"

/**
 * Checkout submission layer — INTEGRATION-04 (COD path) + INTEGRATION-05 (KHQR).
 *
 * Stack.md names `lib/checkout.ts` as the storefront's checkout helper. It holds
 * two slices: the COD slice (`placeCodOrder`, INTEGRATION-04) and the KHQR
 * submission/polling slice (`startKhqr` / `pollKhqrStatus`, INTEGRATION-05 — at
 * the bottom of this file). The currency pass-through (INTEGRATION-08) threads
 * the nav toggle's selected currency — carried in the `ali_currency` preference
 * cookie written by `TopNav` — into `/khqr/start`, so a KHR checkout gets a
 * whole-riel QR.
 *
 * What it does: places a Cash-on-Delivery order against the session cart by
 * calling BACKEND-04 (`POST /store/orders/cod`), then hands the caller the new
 * order id so the checkout page can route to the COD confirmation
 * (`/order/[id]?status=cod`, FRONTEND-19).
 *
 * Cart prep (BACKEND-04 locked decision): that endpoint *only* attaches the COD
 * contact + an unpaid manual payment and runs `completeCartWorkflow` — it
 * assumes the storefront has already set the cart's **email, shipping address,
 * and shipping method** via the standard SDK. `completeCartWorkflow` requires
 * all three to create the order, so `placeCodOrder` performs that prep first.
 * Three resolved decisions drive the prep:
 *  - **Email** — guest checkout keys on phone (PRD), so email is an *optional*
 *    field on `DeliveryForm`. When the customer provides one it is used as-is;
 *    when blank, a deterministic `<phone-digits>@guest.alistore.com` is
 *    synthesised so Medusa always has the email it needs (this is plumbing for
 *    the blank case, not a customer-facing identifier — the phone remains the
 *    identity).
 *  - **Shipping address** — v1 has a single Cambodia region (seed SETUP-08) and
 *    no country code in the URL, so the address is always `country_code: "kh"`;
 *    the form's single free-text address line maps to `address_1` and the full
 *    name is split into first/last.
 *  - **Shipping method** — the first shipping option Medusa offers for the cart
 *    (`GET /store/shipping-options?cart_id=`). NOTE (BACKEND-06): the dev seed
 *    has no shipping option covering Cambodia yet, so completion stays blocked
 *    in dev until one is seeded — a separate SETUP/seed gap, surfaced here as a
 *    clear, customer-safe error rather than a crash.
 *
 * Security (security.md):
 *  - The cart id is read **only** from the `HttpOnly` cookie — never a client
 *    argument — so a caller can't place an order against someone else's cart.
 *  - Storefront uses the publishable key only (the `@lib/config` SDK); the admin
 *    API is never touched.
 *  - Inputs are validated fail-fast (the Cambodian phone regex from security.md
 *    plus a basic email shape). `zod` is not a storefront dependency and adding
 *    one needs approval, so validation is hand-rolled (the `@lib/cart` precedent).
 *  - The phone is PII: it is never logged, and only generic, non-PII messages are
 *    returned to the client. Errors are returned as a typed result (not thrown)
 *    so the page can show a friendly message without leaking internals.
 */

import { cookies } from "next/headers"
import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { getAuthHeaders, getCartId, removeCartId } from "@lib/data/cookies"
import type { Currency } from "@lib/price"

/** Cambodian phone format (security.md) — the guest-checkout identifier. */
const PHONE_PATTERN = /^(\+855|0)[1-9]\d{7,8}$/

/** Minimal email shape check for the optional email field. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * v1 has a single Cambodia region (seed SETUP-08) and the flat storefront has no
 * country code in the URL, so every COD shipping address is Cambodia (`kh`).
 */
const COUNTRY_CODE = "kh"

/**
 * Domain for a synthesised guest email when the optional email is left blank.
 * Medusa requires a cart email to create the order; deriving it from the phone
 * keeps email optional in the UI without blocking completion. Not a real inbox.
 */
const GUEST_EMAIL_DOMAIN = "guest.alistore.com"

/** Contact + delivery details collected by `DeliveryForm` (FRONTEND-16). */
export interface CheckoutContact {
  fullName: string
  phone: string
  address: string
  note?: string
  /** Optional — see the module note on the email decision. */
  email?: string
}

/** Result of a COD placement — a typed union so the page never sees a raw error. */
export type PlaceCodOrderResult =
  | { ok: true; orderId: string; status: string; invoiceToken?: string }
  | { ok: false; error: string }

/** Validated, normalized contact (email always resolved to a usable value). */
interface NormalizedContact {
  name: string
  phone: string
  address: string
  note?: string
  email: string
}

/** Raised by cart prep with a message that is safe to show the customer. */
class CheckoutPrepError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CheckoutPrepError"
  }
}

/** Synthesise a guest email from the phone digits (blank-email fallback). */
function guestEmailFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  return `${digits}@${GUEST_EMAIL_DOMAIN}`
}

/** Split a full name into first / last for the Medusa shipping address. */
function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] ?? name.trim(),
    lastName: parts.slice(1).join(" "),
  }
}

/**
 * Validate + normalize the submitted contact at the client→server boundary.
 * Throws a customer-safe `Error` (its message is shown verbatim) on bad input.
 */
function normalizeContact(input: CheckoutContact): NormalizedContact {
  const name = (input.fullName ?? "").trim()
  if (!name) {
    throw new Error("Please enter your full name.")
  }

  // Whitespace-tolerant, matching the form's `isValidPhone`; the stripped value
  // is what the backend regex validates.
  const phone = (input.phone ?? "").replace(/\s+/g, "")
  if (!PHONE_PATTERN.test(phone)) {
    throw new Error("Please enter a valid Cambodian phone number.")
  }

  const address = (input.address ?? "").trim()
  if (!address) {
    throw new Error("Please enter your delivery address.")
  }

  const providedEmail = (input.email ?? "").trim()
  if (providedEmail && !EMAIL_PATTERN.test(providedEmail)) {
    throw new Error("Please enter a valid email, or leave it blank.")
  }

  return {
    name,
    phone,
    address,
    note: (input.note ?? "").trim() || undefined,
    email: providedEmail || guestEmailFromPhone(phone),
  }
}

/**
 * Prep the cart so BACKEND-04 can complete it: set email + Cambodia shipping
 * address, then add the first shipping option Medusa offers for the cart.
 * Throws `CheckoutPrepError` (safe message) on any step failing.
 */
async function prepareCartForCheckout(
  cartId: string,
  contact: NormalizedContact
): Promise<void> {
  const headers = {
    ...(await getAuthHeaders()),
  }
  const { firstName, lastName } = splitName(contact.name)

  try {
    await sdk.store.cart.update(
      cartId,
      {
        email: contact.email,
        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          // The guest identifier (PRD): carried on the address so KHQR orders
          // (which have no BACKEND-04 metadata contact) still record the phone.
          phone: contact.phone,
          address_1: contact.address,
          country_code: COUNTRY_CODE,
        },
        // The delivery note has no shipping-address home, so it rides on cart
        // metadata — completeCartWorkflow copies it onto the order, where the
        // Telegram alert reads it (the COD path's cod_contact still wins
        // there; this covers KHQR orders, which never POST the note).
        metadata: { checkout_note: contact.note ?? null },
      },
      {},
      headers
    )
  } catch {
    throw new CheckoutPrepError(
      "We couldn't save your delivery details. Please check them and try again."
    )
  }

  let options: HttpTypes.StoreCartShippingOption[] = []
  try {
    const res = await sdk.client.fetch<{
      shipping_options: HttpTypes.StoreCartShippingOption[]
    }>("/store/shipping-options", {
      method: "GET",
      query: { cart_id: cartId },
      headers,
      cache: "no-store",
    })
    options = res.shipping_options ?? []
  } catch {
    options = []
  }

  const option = options[0]
  if (!option) {
    // BACKEND-06: no shipping option covers Cambodia in the dev seed yet.
    throw new CheckoutPrepError(
      "Delivery isn't available for your area yet. Please message us on Facebook or Telegram to finish your order."
    )
  }

  try {
    await sdk.store.cart.addShippingMethod(
      cartId,
      { option_id: option.id },
      {},
      headers
    )
  } catch {
    throw new CheckoutPrepError(
      "We couldn't set up delivery for your order. Please try again."
    )
  }
}

/** Map a BACKEND-04 error response to a customer-safe message (no PII). */
function codErrorMessage(err: unknown): string {
  const status = (err as { status?: number })?.status
  switch (status) {
    case 409:
      return "Sorry — an item in your bag just went out of stock. Please review your bag and try again."
    case 429:
      return "Too many attempts. Please wait a minute and try again."
    case 404:
      return "Your cart could not be found. Please add your items again."
    case 400:
      return "Please double-check your delivery details and try again."
    default:
      return "We couldn't place your order just now. Please try again."
  }
}

/**
 * Place a Cash-on-Delivery order for the session cart (INTEGRATION-04).
 *
 * Validates the contact, preps the cart (email + Cambodia shipping address +
 * first shipping option), then `POST`s BACKEND-04 (`/store/orders/cod`). On
 * success the (now completed) cart cookie is cleared so the next visit starts a
 * fresh cart, and the new `order_id` (plus the order's `invoice_token`) is
 * returned for the COD-confirmation route.
 */
export async function placeCodOrder(
  input: CheckoutContact
): Promise<PlaceCodOrderResult> {
  let contact: NormalizedContact
  try {
    contact = normalizeContact(input)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid delivery details.",
    }
  }

  // Ownership: the cart id comes only from the HttpOnly cookie (security.md).
  const cartId = await getCartId()
  if (!cartId) {
    return {
      ok: false,
      error: "Your cart could not be found. Please add your items again.",
    }
  }

  try {
    await prepareCartForCheckout(cartId, contact)
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof CheckoutPrepError
          ? err.message
          : "We couldn't prepare your order for delivery. Please try again.",
    }
  }

  try {
    const headers = {
      ...(await getAuthHeaders()),
    }
    const result = await sdk.client.fetch<{
      order_id: string
      status: string
      invoice_token?: string
    }>("/store/orders/cod", {
      method: "POST",
      body: {
        cart_id: cartId,
        phone: contact.phone,
        name: contact.name,
        address: contact.address,
        note: contact.note,
      },
      headers,
      cache: "no-store",
    })

    if (!result?.order_id) {
      return {
        ok: false,
        error: "We couldn't place your order just now. Please try again.",
      }
    }

    // Order placed — the cart is completed; start fresh on the next visit.
    await removeCartId()

    // `invoice_token` (BACKEND-04) is the per-order capability the confirmation
    // page (INTEGRATION-07) appends to the invoice link so it opens for this
    // order; pass it through so the COD redirect can carry it as `?token=`.
    return {
      ok: true,
      orderId: result.order_id,
      status: result.status,
      invoiceToken: result.invoice_token,
    }
  } catch (err) {
    return { ok: false, error: codErrorMessage(err) }
  }
}

// ── KHQR (INTEGRATION-05) ─────────────────────────────────────────────────────

/**
 * KHQR start/poll layer — INTEGRATION-05, cut over to KHPAY (KHPAY-05; was
 * ABA PayWay under PAYWAY-06 — ABA declined the direct merchant application
 * pending a business license).
 *
 * Connects the checkout to the KHPAY Bakong KHQR endpoints (KHPAY-02/03 —
 * same contract the Bakong/PayWay routes had, so the pay screen is unchanged):
 *  - `startKhqr` → `POST /store/payments/khpay/start` creates the KHPAY
 *    Bakong QR (no banking-app deeplink on this rail — the deeplink CTA simply
 *    doesn't render) and reserves stock for the payment window;
 *  - `pollKhqrStatus` → `GET /store/payments/khpay/status?reference=` reports
 *    `pending | paid | expired`; on `paid` the backend has already verified the
 *    payment server-side (KHPAY /bakong/check) and created the order.
 *
 * These two functions are the seam the KHQR pay screen (FRONTEND-18) drives —
 * they replace the screen's placeholder seam while keeping the same
 * `KhqrSession` / `KhqrStatus` shapes, so the screen's countdown / poll /
 * redirect logic is unchanged.
 *
 * Security (security.md "Payments"):
 *  - The cart id is read only from the `HttpOnly` cookie — never a client
 *    argument — so a caller can't start a payment against someone else's cart.
 *  - `paid` is reported only by the server endpoint after its own Bakong verify;
 *    the storefront never infers or fabricates payment status.
 *  - The `reference` is sensitive: it is never logged, and its shape is validated
 *    before use as the poll key.
 *  - Errors return generic, customer-safe messages — the backend error envelope
 *    is never surfaced to the client.
 */

/** Result of KHQR cart prep — same typed-union pattern as `PlaceCodOrderResult`. */
export type PrepareKhqrCheckoutResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Prep the session cart for a KHQR payment (INTEGRATION-05).
 *
 * The paid flip (BACKEND-03B) finalizes the order with `completeCartWorkflow`,
 * which requires the cart to already carry an email, a shipping address, and a
 * shipping method — the same prep `placeCodOrder` performs for COD. Without it
 * a server-verified payment could never complete into an order, so the checkout
 * page calls this with the delivery form's contact BEFORE routing to the pay
 * screen (`/checkout/khqr`). Validation and prep reuse the COD helpers
 * (`normalizeContact` + `prepareCartForCheckout`) — single source of truth.
 *
 * Returns a typed result (never throws) so the page shows the same
 * customer-safe message treatment as the COD branch (security.md: internals are
 * never leaked to the client).
 */
export async function prepareKhqrCheckout(
  input: CheckoutContact
): Promise<PrepareKhqrCheckoutResult> {
  let contact: NormalizedContact
  try {
    contact = normalizeContact(input)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Invalid delivery details.",
    }
  }

  // Ownership: the cart id comes only from the HttpOnly cookie (security.md).
  const cartId = await getCartId()
  if (!cartId) {
    return {
      ok: false,
      error: "Your cart could not be found. Please add your items again.",
    }
  }

  try {
    await prepareCartForCheckout(cartId, contact)
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof CheckoutPrepError
          ? err.message
          : "We couldn't prepare your order for delivery. Please try again.",
    }
  }

  return { ok: true }
}

/**
 * Display-currency preference cookie (INTEGRATION-08), written by the nav
 * currency toggle (`TopNav`, FRONTEND-04). A plain (non-HttpOnly) cookie on
 * purpose: it carries a UI preference, not a credential, and the client owns
 * it (security.md's HttpOnly rule covers tokens/session ids/payment refs —
 * this is none of those).
 */
const CURRENCY_COOKIE = "ali_currency"

/**
 * Resolve the customer's selected currency for the KHQR amount (INTEGRATION-08).
 *
 * Reads the toggle's preference cookie server-side and validates it against the
 * backend schema's enum — an absent or tampered value falls back to USD
 * (SETUP-04 locked USD as the store default), so the cookie can only ever pick
 * the other *supported* denomination. The amount itself is always computed
 * server-side from the cart total (BACKEND-03: KHR derived via `USD_KHR_RATE`,
 * rounded to whole riel) — the client never supplies an amount.
 */
async function getSelectedCurrency(): Promise<Currency> {
  const value = (await cookies()).get(CURRENCY_COOKIE)?.value
  return value === "KHR" ? "KHR" : "USD"
}

/**
 * KHPAY Bakong transaction id (`bk_…`) — matches the backend reference schema
 * (KHPAY-03). Was 20 hex (PayWay tran_id, Phase 6) and 32 hex (Bakong md5)
 * before that; KHPAY replaced PayWay as the active KHQR provider (Phase 7).
 */
const REFERENCE_PATTERN = /^bk_[A-Za-z0-9]{6,64}$/

/** `POST /store/payments/khpay/start` response (KHPAY-02). */
export interface KhqrSession {
  qr: string
  deeplink: string | null
  reference: string
  expires_at: string | null
  /** Cart total in major units (e.g. 15 = $15.00 / 60000 = ៛60,000). Display only. */
  amount: number
  /** Selected currency code in lowercase — "usd" or "khr". */
  currency: string
}

/** `GET /store/payments/khpay/status` response (KHPAY-03). */
export type KhqrStatus =
  | { status: "pending" }
  | { status: "paid"; order_id: string; invoice_token?: string }
  | { status: "expired" }

/**
 * Start a KHQR payment for the session cart (INTEGRATION-05).
 *
 * Reads the cart id from the `HttpOnly` cookie and the selected currency from
 * the toggle's preference cookie (INTEGRATION-08), calls BACKEND-03, and returns
 * the QR session for the pay screen to render. Throws a customer-safe error on
 * any failure (missing cart, out-of-stock, gateway down) so the pay screen shows
 * its generic "couldn't start" state and offers a retry — the backend error
 * envelope is never leaked (security.md).
 */
export async function startKhqr(): Promise<KhqrSession> {
  // Ownership: the cart id comes only from the HttpOnly cookie (security.md).
  const cartId = await getCartId()
  if (!cartId) {
    throw new Error(
      "Your cart could not be found. Please add your items again."
    )
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  // INTEGRATION-08: the nav toggle's currency drives the QR's denomination —
  // KHR checkouts get a whole-riel amount, converted server-side (BACKEND-03).
  const currency = await getSelectedCurrency()

  let session: KhqrSession
  try {
    session = await sdk.client.fetch<KhqrSession>(
      "/store/payments/khpay/start",
      {
        method: "POST",
        body: { cart_id: cartId, currency },
        headers,
        cache: "no-store",
      }
    )
  } catch {
    throw new Error("We couldn't start your payment. Please try again.")
  }

  if (!session?.qr || !session?.reference) {
    throw new Error("We couldn't start your payment. Please try again.")
  }

  // Fetch cart total for KHQR card display (non-critical — QR encodes the real amount).
  let cartTotal = 0
  try {
    const { cart: cartData } = await sdk.store.cart.retrieve(cartId, {
      fields: "total",
      headers,
    })
    cartTotal = (cartData?.total as number) ?? 0
  } catch {
    // Amount display degrades to 0.00; payment itself is unaffected.
  }

  return {
    qr: session.qr,
    deeplink: session.deeplink ?? null,
    reference: session.reference,
    expires_at: session.expires_at ?? null,
    amount: cartTotal,
    currency,
  }
}

/**
 * Poll the payment status for a started KHQR session (INTEGRATION-05).
 *
 * Calls BACKEND-03B with the `reference` from `startKhqr` and returns the
 * server-reported status verbatim — `paid` is set only by the server after its
 * own Bakong verify (security.md: never trust a client-reported status). On
 * `paid` the order already exists, so the completed cart cookie is cleared
 * (mirrors `placeCodOrder`) and the pay screen redirects to the confirmation.
 *
 * Throws on a transient / transport failure so the pay screen's poll loop keeps
 * retrying (the status endpoint is idempotent); the screen's countdown stops the
 * loop once the QR window closes.
 */
export async function pollKhqrStatus(reference: string): Promise<KhqrStatus> {
  // Validate the capability before use as the poll key (security.md).
  if (!REFERENCE_PATTERN.test(reference)) {
    throw new Error("Invalid payment reference.")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  let result: KhqrStatus
  try {
    result = await sdk.client.fetch<KhqrStatus>(
      "/store/payments/khpay/status",
      {
        method: "GET",
        query: { reference },
        headers,
        cache: "no-store",
      }
    )
  } catch {
    // Transient/transport error — let the pay screen keep polling. Generic
    // message only; never surface the backend error envelope (security.md).
    throw new Error("Payment status check failed.")
  }

  if (result.status === "paid") {
    // Order created + server-verified — clear the completed cart so the next
    // visit starts fresh (mirrors placeCodOrder). Idempotent.
    await removeCartId()
  }

  return result
}
