"use server"

/**
 * Cart operations layer — INTEGRATION-02.
 *
 * Stack.md names `lib/cart.ts` as the storefront's cart helper. Following the
 * INTEGRATION-01 precedent (`lib/medusa.ts`), this is a `"use server"` module
 * built on the single configured `@lib/config` SDK rather than the Medusa
 * Next.js Starter's `lib/data/cart.ts` — the starter routes everything through a
 * URL `countryCode`, which this flat storefront deliberately removed. It does,
 * however, reuse the starter's already-secure cookie helpers
 * (`getCartId` / `setCartId`) so the cart-id cookie keeps its `HttpOnly` +
 * `SameSite=Strict` + prod-`Secure` attributes (security.md) without
 * re-implementing cookie handling.
 *
 * Scope (INTEGRATION-02, Requirements): cart **create**, line-item
 * **add / update / delete** via the SDK, and **persisting the cart id**. Reads
 * (`getCart`, `getCartItemCount`) back the acceptance criterion ("adding from
 * PDP updates cart count and cart page") so consumers can render count + lines.
 * Wiring these into the PDP add control, the cart page, and the count badge is
 * consumer work in those components' files — outside this task's single declared
 * Deliverable — so it is intentionally not done here.
 *
 * Security:
 * - The active cart id is read **only** from the `HttpOnly` cookie, never from a
 *   client argument — so a caller can't operate on someone else's cart
 *   (security.md: scope store routes to the current cart, no client-supplied ids
 *   without an ownership check).
 * - Storefront uses the publishable key only (the `@lib/config` SDK); no admin
 *   API is touched.
 * - Inputs are validated fail-fast (`zod` is not a storefront dependency and
 *   adding one needs approval, so validation is hand-rolled).
 *
 * Pricing: amounts are returned as **numeric USD major units** (not formatted),
 * because the cart page recomputes totals on quantity change and renders them
 * through `@lib/price` (FRONTEND-22). Medusa v2 returns cart amounts in major
 * units, so they are used directly — never divided by 100.
 */

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import medusaError from "@lib/util/medusa-error"
import { listRegions } from "@lib/data/regions"
import { getAuthHeaders, getCartId, setCartId } from "@lib/data/cookies"

/** A normalized cart line (numeric USD), shaped for the cart page + line rows. */
export interface CartLine {
  /** Line item id — the handle for update/remove. */
  id: string
  /** The chosen variant's id. */
  variantId: string
  /** Reference shown as the mute caption: variant SKU, else product id. */
  productId: string
  /** Product name. */
  name: string
  /** Display label for the chosen variant, e.g. "Black / M". */
  variantLabel: string
  /** Square line thumbnail URL. */
  imageSrc: string
  /** Accessible alt text. */
  imageAlt: string
  /** Current unit price in USD major units. */
  unitPrice: number
  /** Original unit price (USD) — present only when the line is on sale. */
  originalUnitPrice?: number
  /** Quantity in the cart. */
  quantity: number
  /** Line total in USD major units (unit price × quantity, after discounts). */
  lineTotal: number
}

/** A normalized cart (numeric USD) — the read/return shape for all operations. */
export interface Cart {
  id: string
  lines: CartLine[]
  /** Sum of line quantities — drives the nav/bottom-bar count. */
  itemCount: number
  /** Items subtotal in USD major units (before delivery fee). */
  subtotal: number
}

/**
 * Cart read selection. Only `*`/`+` prefixes are used so Medusa's default
 * cart-level computed totals are preserved while line totals are added
 * explicitly (`+items.total` / `+items.subtotal`). `*items` already yields each
 * line's own columns (title, thumbnail, unit_price, compare_at_unit_price, …).
 */
const CART_FIELDS = "*items,+items.total,+items.subtotal"

/** Minimum quantity for a line item; removal is a separate operation. */
const MIN_QUANTITY = 1

/**
 * 1×1 transparent PNG fallback so `next/image` always receives a non-empty
 * `src` if a line ever lacks a thumbnail (defensive — seeded products carry
 * thumbnails; the tile background is `soft-cloud` regardless). Mirrors the
 * fallback used by `@lib/medusa`.
 */
const BLANK_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

/**
 * Resolved store region id, memoized for the process — kept consistent with the
 * catalog region resolved in `@lib/medusa` (prefers `NEXT_PUBLIC_DEFAULT_REGION`,
 * else the first region) so cart prices match catalog prices. v1 is
 * single-region, so resolving once is sufficient.
 */
let cachedRegionId: string | null = null

/** Resolve the region used to create the cart (and thus price its items). */
async function resolveRegionId(): Promise<string | null> {
  if (cachedRegionId) {
    return cachedRegionId
  }

  const regions = await listRegions().catch(() => null)
  if (!regions?.length) {
    return null
  }

  const wanted = (process.env.NEXT_PUBLIC_DEFAULT_REGION ?? "")
    .trim()
    .toLowerCase()

  const preferred = wanted
    ? regions.find((region) =>
        region.countries?.some((c) => c.iso_2?.toLowerCase() === wanted)
      )
    : undefined

  cachedRegionId = (preferred ?? regions[0]).id
  return cachedRegionId
}

/** Validate a quantity at the client→server boundary; fail fast on bad input. */
function normalizeQuantity(quantity: number): number {
  if (typeof quantity !== "number" || !Number.isFinite(quantity)) {
    throw new Error("Quantity must be a number")
  }

  const whole = Math.floor(quantity)
  if (whole < MIN_QUANTITY) {
    throw new Error(`Quantity must be at least ${MIN_QUANTITY}`)
  }

  return whole
}

/** Map a Medusa cart line item to a normalized `CartLine`. */
function toCartLine(item: HttpTypes.StoreCartLineItem): CartLine {
  const unitPrice = item.unit_price ?? 0
  const compareAt = item.compare_at_unit_price
  const onSale = compareAt != null && compareAt > unitPrice

  return {
    id: item.id,
    variantId: item.variant_id ?? "",
    productId: item.variant_sku ?? item.product_id ?? "",
    name: item.product_title ?? item.title ?? "",
    variantLabel: item.variant_title ?? "",
    imageSrc: item.thumbnail ?? BLANK_IMAGE,
    imageAlt: item.product_title ?? item.title ?? "",
    unitPrice,
    originalUnitPrice: onSale ? compareAt : undefined,
    quantity: item.quantity,
    lineTotal: item.total ?? unitPrice * item.quantity,
  }
}

/** Map a Medusa cart to the normalized `Cart` returned by every operation. */
function toCart(cart: HttpTypes.StoreCart): Cart {
  const lines = (cart.items ?? []).map(toCartLine)

  return {
    id: cart.id,
    lines,
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    subtotal:
      cart.item_subtotal ??
      lines.reduce((sum, line) => sum + line.lineTotal, 0),
  }
}

/** Fetch the cart for the given id, or `null` if it no longer exists. */
async function fetchCart(cartId: string): Promise<HttpTypes.StoreCart | null> {
  const headers = {
    ...(await getAuthHeaders()),
  }

  return sdk.client
    .fetch<HttpTypes.StoreCartResponse>(`/store/carts/${cartId}`, {
      method: "GET",
      query: { fields: CART_FIELDS },
      headers,
      cache: "no-store",
    })
    .then(({ cart }) => cart)
    .catch(() => null)
}

/**
 * Return the session's cart, creating (and persisting) one if none exists or the
 * stored id has expired. The cart id is taken from / written to the `HttpOnly`
 * cookie — never accepted from the caller.
 */
async function getOrCreateCart(): Promise<HttpTypes.StoreCart> {
  const existingId = await getCartId()
  if (existingId) {
    const existing = await fetchCart(existingId)
    if (existing) {
      return existing
    }
    // Stored id is stale/expired — fall through and create a fresh cart.
  }

  const regionId = await resolveRegionId()
  if (!regionId) {
    throw new Error(
      "Unable to initialize a cart: no store region is configured"
    )
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const { cart } = await sdk.store.cart
    .create({ region_id: regionId }, { fields: CART_FIELDS }, headers)
    .catch(medusaError)

  await setCartId(cart.id)
  return cart
}

/**
 * Read the session's current cart, or `null` when there is none. Always fetched
 * fresh (`no-store`) since cart contents are per-session and mutable.
 */
export async function getCart(): Promise<Cart | null> {
  const cartId = await getCartId()
  if (!cartId) {
    return null
  }

  const cart = await fetchCart(cartId)
  return cart ? toCart(cart) : null
}

/** Total number of items in the session cart (0 when empty) — for the count badge. */
export async function getCartItemCount(): Promise<number> {
  const cart = await getCart()
  return cart?.itemCount ?? 0
}

/**
 * Add a variant to the cart, creating + persisting the cart on first add.
 * Returns the updated cart so callers can refresh the count and cart page in one
 * round trip.
 */
export async function addToCart(input: {
  variantId: string
  quantity?: number
}): Promise<Cart> {
  const variantId = (input.variantId ?? "").trim()
  if (!variantId) {
    throw new Error("A product variant is required to add to the cart")
  }

  const quantity = normalizeQuantity(input.quantity ?? MIN_QUANTITY)

  const cart = await getOrCreateCart()
  const headers = {
    ...(await getAuthHeaders()),
  }

  const { cart: updated } = await sdk.store.cart
    .createLineItem(
      cart.id,
      { variant_id: variantId, quantity },
      { fields: CART_FIELDS },
      headers
    )
    .catch(medusaError)

  return toCart(updated)
}

/** Set a line item's quantity (≥ 1). Returns the updated cart. */
export async function updateLineItem(input: {
  lineId: string
  quantity: number
}): Promise<Cart> {
  const lineId = (input.lineId ?? "").trim()
  if (!lineId) {
    throw new Error("A line item id is required to update the cart")
  }

  const quantity = normalizeQuantity(input.quantity)

  const cartId = await getCartId()
  if (!cartId) {
    throw new Error("No active cart to update")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const { cart } = await sdk.store.cart
    .updateLineItem(
      cartId,
      lineId,
      { quantity },
      { fields: CART_FIELDS },
      headers
    )
    .catch(medusaError)

  return toCart(cart)
}

/** Remove a line item from the cart. Returns the updated cart. */
export async function removeLineItem(lineId: string): Promise<Cart> {
  const id = (lineId ?? "").trim()
  if (!id) {
    throw new Error("A line item id is required to remove it from the cart")
  }

  const cartId = await getCartId()
  if (!cartId) {
    throw new Error("No active cart to update")
  }

  const headers = {
    ...(await getAuthHeaders()),
  }

  const { parent } = await sdk.store.cart
    .deleteLineItem(cartId, id, { fields: CART_FIELDS }, headers)
    .catch(medusaError)

  if (parent) {
    return toCart(parent)
  }

  // `parent` should hold the updated cart; re-read defensively if it's absent.
  const refreshed = await getCart()
  if (!refreshed) {
    throw new Error("Cart not found after removing the line item")
  }
  return refreshed
}
