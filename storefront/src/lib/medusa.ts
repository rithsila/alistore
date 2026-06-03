"use server"

/**
 * Catalog data layer — INTEGRATION-01.
 *
 * The project convention (Stack.md → "storefront file organization") names
 * `lib/medusa.ts` as the storefront's Medusa client helper. The SDK *instance*
 * is configured once in `@lib/config` (the Medusa Next.js Starter's entry,
 * already wired with the publishable key + locale header); this module builds
 * the storefront's catalog reads on top of that single configured client and
 * normalizes Medusa's `StoreProduct`/`StoreProductCategory` shapes into the
 * display-ready props the presentational components expect.
 *
 * Why `"use server"`: `@lib/config`'s `sdk` attaches a `server-only` locale
 * header to every request, so catalog fetching must run on the server. Marking
 * this module's exports as Server Actions lets the Server Components (Home,
 * Category) call them directly during render *and* the interactive (client) PDP
 * invoke `getProductDetail` without bundling any server-only code. This mirrors
 * the starter's existing `data/products.ts` pattern.
 *
 * Pricing: the catalog is priced in USD (locked decision — KHR is derived from
 * `USD_KHR_RATE` at display time, see `@lib/price`). Medusa v2 returns
 * `calculated_price.calculated_amount` in **major units**, so amounts are
 * formatted directly with `formatUsd` — never divided by 100. A `region_id` is
 * required for Medusa to compute `calculated_price`; the flat storefront has no
 * country code in the URL, so the region is resolved once from `/store/regions`
 * (preferring `NEXT_PUBLIC_DEFAULT_REGION`, else the first region).
 *
 * Scope: product- and category-level catalog reads for Home / Category / PDP
 * (INTEGRATION-01). The PDP additionally binds **real per-variant inventory** to
 * the variant picker (INTEGRATION-03). Cart operations live in `@lib/cart`
 * (INTEGRATION-02).
 */

import { sdk } from "@lib/config"
import { formatUsd } from "@lib/price"
import { HttpTypes } from "@medusajs/types"

/** A catalog tile's display-ready data (maps 1:1 to `ProductCard` props). */
interface CatalogProduct {
  /** Product reference shown as the mute caption (first variant SKU, else handle). */
  productId: string
  /** Product handle — the card links to `/product/[handle]`. */
  handle: string
  /** Product name. */
  name: string
  /** Square product image URL (thumbnail, else first gallery image). */
  imageSrc: string
  /** Accessible alt text. */
  imageAlt: string
  /** Display-ready current price, e.g. "$29.00". */
  price: string
  /** Display-ready original price — present only when the product is on sale. */
  originalPrice?: string
}

/** A category chip's display-ready data (maps 1:1 to `CategoryTabs` props). */
interface CatalogCategory {
  handle: string
  name: string
}

/** A category listing: its display name plus its catalog tiles. */
interface CatalogCategoryProducts {
  name: string
  products: CatalogProduct[]
}

/**
 * A selectable PDP variant (maps 1:1 to `VariantPicker`'s `VariantOption`).
 *
 * Carries the **real Medusa `variant_id`** (`id`) so the PDP can add the chosen
 * variant to the cart (INTEGRATION-02). `color`/`size` are read from the
 * variant's product options; `colorHex` is the swatch fill (product colour
 * data, per DESIGN.md). `stock` is the real available quantity per variant
 * (INTEGRATION-03): `0` (or less) renders the variant struck/disabled in the
 * picker; `Infinity` marks a variant that doesn't manage inventory / allows
 * backorder (always purchasable — see `variantStock`).
 */
export interface ProductDetailVariant {
  id: string
  color: string
  colorHex: string
  size: string
  stock: number
}

/** Product-level detail for the PDP, including its selectable variants. */
interface ProductDetail {
  productId: string
  name: string
  price: string
  originalPrice?: string
  /** Gallery images, in order (maps to `Gallery` props). */
  images: { src: string; alt: string }[]
  /** Selectable variants with real Medusa ids (maps to `VariantPicker`). */
  variants: ProductDetailVariant[]
}

/**
 * Field selections. Only `+`/`*` prefixes are used so Medusa's default product
 * fields (title, handle, thumbnail, …) are preserved while these relations are
 * added: gallery images, variant SKUs, and the region-priced `calculated_price`.
 */
const PRODUCT_FIELDS =
  "+thumbnail,*images,+variants.sku,*variants.calculated_price"

/**
 * Richer selection for the PDP: the catalog fields plus each variant's title,
 * product-option values (Color / Size), and live inventory, needed to build the
 * variant picker with real variant ids and real stock (INTEGRATION-03).
 * `inventory_quantity` is Medusa's computed available count for the request's
 * sales channel; `manage_inventory`/`allow_backorder` flag variants that are
 * always purchasable. Kept separate so the lighter `PRODUCT_FIELDS` still drives
 * the catalog grids without fetching relations/inventory they don't render.
 */
const PRODUCT_DETAIL_FIELDS =
  PRODUCT_FIELDS +
  ",+variants.title,*variants.options,*variants.options.option" +
  ",+variants.inventory_quantity,+variants.manage_inventory" +
  ",+variants.allow_backorder"

/** Default number of tiles for the home catalog grid. */
const HOME_PRODUCT_LIMIT = 12

/** Upper bound for a single category listing (no pagination in v1). */
const CATEGORY_PRODUCT_LIMIT = 100

/**
 * 1×1 transparent PNG, used only when a product carries no image at all so
 * `next/image` always receives a non-empty `src`. Seeded products carry
 * thumbnails (SETUP-10), so this is a defensive fallback, not a design element —
 * the tile background is `soft-cloud` either way.
 */
const BLANK_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="

/**
 * Resolved store region id, memoized for the process. v1 is single-region, so
 * resolving once is sufficient; the cache simply avoids a `/store/regions`
 * round-trip on every catalog read.
 */
let cachedRegionId: string | null = null

/** Resolve the region used to compute prices (see module note on `region_id`). */
async function resolveRegionId(): Promise<string | null> {
  if (cachedRegionId) {
    return cachedRegionId
  }

  const { regions } = await sdk.client.fetch<{
    regions: HttpTypes.StoreRegion[]
  }>("/store/regions", { method: "GET" })

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

/**
 * Extract the cheapest in-catalog price for a product.
 *
 * Returns the display-ready current price and, when the cheapest variant is
 * discounted (`calculated_amount < original_amount`), the struck original.
 * Returns `null` when no variant carries a calculated price (such a product
 * can't be shown "with a price", so callers skip it).
 */
function extractPrice(
  product: HttpTypes.StoreProduct
): { price: string; originalPrice?: string } | null {
  const priced = (product.variants ?? []).filter(
    (variant) => variant.calculated_price?.calculated_amount != null
  )

  if (!priced.length) {
    return null
  }

  const cheapest = priced.reduce((lowest, variant) =>
    (variant.calculated_price!.calculated_amount as number) <
    (lowest.calculated_price!.calculated_amount as number)
      ? variant
      : lowest
  )

  const calculated = cheapest.calculated_price!
  const amount = calculated.calculated_amount as number
  const original = calculated.original_amount as number | null | undefined

  if (original != null && original > amount) {
    return { price: formatUsd(amount), originalPrice: formatUsd(original) }
  }

  return { price: formatUsd(amount) }
}

/** Product reference for the card/PDP caption: first variant SKU, else handle. */
function referenceFor(product: HttpTypes.StoreProduct): string {
  return product.variants?.[0]?.sku ?? product.handle ?? product.id
}

/**
 * Swatch fill per colourway name (DESIGN.md treats swatch fills as product
 * colour data, not chrome tokens). Names are matched case-insensitively; an
 * unmapped colourway falls back to a neutral grey so the dot stays visible.
 */
const COLOR_HEX: Readonly<Record<string, string>> = {
  black: "#111111",
  white: "#ffffff",
  grey: "#9ca3af",
  gray: "#9ca3af",
  navy: "#1f2a44",
  blue: "#2563a8",
  red: "#b91c1c",
  green: "#15803d",
  beige: "#e8dcc6",
  brown: "#6b4f3a",
}

/** Neutral swatch fill for colourways without a known hex (product-data default). */
const DEFAULT_COLOR_HEX = "#d4d4d4"

/**
 * Resolve a variant's available stock for the picker (INTEGRATION-03).
 *
 * Mirrors the backend availability semantics (the COD route's
 * `hasInsufficientStock` and the Medusa starter): a variant that doesn't manage
 * inventory or allows backorder is always purchasable — represented as
 * unlimited (`Infinity`) so the picker shows it available without a misleading
 * count. For managed variants, Medusa's computed `inventory_quantity` is the
 * available count (stocked − reserved across the sales channel's stock
 * locations); a non-positive/absent count ⇒ sold out, which the picker renders
 * as struck/disabled.
 */
function variantStock(variant: HttpTypes.StoreProductVariant): number {
  if (variant.manage_inventory === false || variant.allow_backorder === true) {
    return Number.POSITIVE_INFINITY
  }
  const quantity = variant.inventory_quantity
  return typeof quantity === "number" && quantity > 0 ? quantity : 0
}

/** Read a variant's value for the product option whose title matches `titleRe`. */
function optionValue(
  variant: HttpTypes.StoreProductVariant,
  titleRe: RegExp
): string {
  const match = (variant.options ?? []).find((ov) =>
    titleRe.test(ov.option?.title ?? "")
  )
  return (match?.value ?? "").trim()
}

/** Map a real Medusa variant to a selectable PDP variant (carries the real id). */
function toDetailVariant(
  variant: HttpTypes.StoreProductVariant
): ProductDetailVariant {
  const color = optionValue(variant, /colou?r/i)
  const size = optionValue(variant, /size/i) || variant.title || ""

  return {
    id: variant.id,
    color,
    colorHex: COLOR_HEX[color.toLowerCase()] ?? DEFAULT_COLOR_HEX,
    size,
    stock: variantStock(variant),
  }
}

/** Map a `StoreProduct` to a catalog tile, or `null` if it has no price. */
function toCatalogProduct(
  product: HttpTypes.StoreProduct
): CatalogProduct | null {
  const priced = extractPrice(product)
  if (!priced) {
    return null
  }

  return {
    productId: referenceFor(product),
    handle: product.handle ?? "",
    name: product.title ?? "",
    imageSrc: product.thumbnail ?? product.images?.[0]?.url ?? BLANK_IMAGE,
    imageAlt: product.title ?? "",
    price: priced.price,
    originalPrice: priced.originalPrice,
  }
}

function isCatalogProduct(
  value: CatalogProduct | null
): value is CatalogProduct {
  return value !== null
}

/**
 * Fetch the home catalog grid: the first `limit` products, region-priced and
 * normalized to `ProductCard` props. Products without a calculated price are
 * skipped so every tile renders a real price.
 */
export async function getCatalogProducts(
  limit: number = HOME_PRODUCT_LIMIT
): Promise<CatalogProduct[]> {
  const regionId = await resolveRegionId()
  if (!regionId) {
    return []
  }

  const { products } = await sdk.client.fetch<{
    products: HttpTypes.StoreProduct[]
  }>("/store/products", {
    method: "GET",
    query: { limit, region_id: regionId, fields: PRODUCT_FIELDS },
  })

  return (products ?? []).map(toCatalogProduct).filter(isCatalogProduct)
}

/** Fetch the seeded product categories for the category tabs (English v1). */
export async function getCategories(): Promise<CatalogCategory[]> {
  const { product_categories } = await sdk.client.fetch<{
    product_categories: HttpTypes.StoreProductCategory[]
  }>("/store/product-categories", {
    method: "GET",
    query: { limit: 100, fields: "handle,name" },
  })

  return (product_categories ?? []).map((category) => ({
    handle: category.handle,
    name: category.name,
  }))
}

/**
 * Fetch a single category by `handle` plus its region-priced products.
 * Returns `null` when no category matches the handle (the page falls back to a
 * heading-only empty state).
 */
export async function getCategoryProducts(
  handle: string
): Promise<CatalogCategoryProducts | null> {
  const { product_categories } = await sdk.client.fetch<{
    product_categories: HttpTypes.StoreProductCategory[]
  }>("/store/product-categories", {
    method: "GET",
    query: { handle, limit: 1, fields: "id,name,handle" },
  })

  const category = product_categories?.[0]
  if (!category) {
    return null
  }

  const regionId = await resolveRegionId()
  if (!regionId) {
    return { name: category.name, products: [] }
  }

  const { products } = await sdk.client.fetch<{
    products: HttpTypes.StoreProduct[]
  }>("/store/products", {
    method: "GET",
    query: {
      category_id: [category.id],
      region_id: regionId,
      limit: CATEGORY_PRODUCT_LIMIT,
      fields: PRODUCT_FIELDS,
    },
  })

  return {
    name: category.name,
    products: (products ?? []).map(toCatalogProduct).filter(isCatalogProduct),
  }
}

/**
 * Fetch a single product by `handle` for the PDP, normalized to product-level
 * detail (name, price, gallery images) plus its selectable variants with real
 * Medusa ids (so the PDP can add the chosen variant to the cart, INTEGRATION-02)
 * and **real per-variant inventory** (INTEGRATION-03): each `variant.stock` is
 * the live available count, so sold-out variants render struck/disabled in the
 * picker. Returns `null` when no product matches.
 */
export async function getProductDetail(
  handle: string
): Promise<ProductDetail | null> {
  const regionId = await resolveRegionId()
  if (!regionId) {
    return null
  }

  const { products } = await sdk.client.fetch<{
    products: HttpTypes.StoreProduct[]
  }>("/store/products", {
    method: "GET",
    query: {
      handle,
      limit: 1,
      region_id: regionId,
      fields: PRODUCT_DETAIL_FIELDS,
    },
  })

  const product = products?.[0]
  if (!product) {
    return null
  }

  const priced = extractPrice(product)
  if (!priced) {
    return null
  }

  const images = product.images?.length
    ? product.images.map((image) => ({
        src: image.url,
        alt: product.title ?? "",
      }))
    : product.thumbnail
    ? [{ src: product.thumbnail, alt: product.title ?? "" }]
    : []

  return {
    productId: referenceFor(product),
    name: product.title ?? "",
    price: priced.price,
    originalPrice: priced.originalPrice,
    images,
    variants: (product.variants ?? []).map(toDetailVariant),
  }
}
