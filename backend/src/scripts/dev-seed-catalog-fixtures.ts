import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  PriceListStatus,
} from "@medusajs/framework/utils"
import {
  createPriceListsWorkflow,
  updateInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows"

// TEST-01 dev catalog fixtures (dev DB only — never run against production).
//
// The catalog spec (storefront/tests/catalog.spec.ts) asserts two visual states
// the regular dev seed doesn't produce:
//
//   1. A sale-priced product — "shorts" gets an active sale price list pricing
//      every variant at SALE_PRICE_USD (the base price stays untouched), so the
//      catalog card renders the struck original + accent sale price
//      (DESIGN.md product-card; price lists default to `type: sale`, which is
//      what makes `calculated_price.original_amount` keep the base price).
//
//   2. A sold-out size — "sweatpants" size XL has its inventory level(s) set to
//      0, so the PDP renders the struck/disabled size chip (FRONTEND-13 /
//      INTEGRATION-03). Sweatpants is the single-option (size-only) product, so
//      the struck chip is visible without any colour interaction.
//
// Idempotent: the price list is skipped when one titled PRICE_LIST_TITLE
// already exists; setting stocked_quantity to 0 is naturally repeatable.
//
// Run with: npx medusa exec ./src/scripts/dev-seed-catalog-fixtures.ts

const SALE_PRODUCT_HANDLE = "shorts"
const SALE_PRICE_USD = 12 // 20% off $15 base price
const SOLD_OUT_PRODUCT_HANDLE = "sweatpants"
const SOLD_OUT_SIZE = "XL"
const PRICE_LIST_TITLE = "Dev catalog fixtures — TEST-01 sale"

export default async function devSeedCatalogFixtures({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // ── 1. Sale price list on every "shorts" variant ──────────────────────────
  const { data: priceLists } = await query.graph({
    entity: "price_list",
    fields: ["id", "title"],
    filters: { title: PRICE_LIST_TITLE },
  })

  if (priceLists.length > 0) {
    logger.info(
      `Price list "${PRICE_LIST_TITLE}" already exists — skipping creation.`
    )
  } else {
    const { data: saleProducts } = await query.graph({
      entity: "product",
      fields: ["id", "variants.id", "variants.title"],
      filters: { handle: SALE_PRODUCT_HANDLE },
    })

    const saleProduct = saleProducts[0]
    if (!saleProduct?.variants?.length) {
      throw new Error(
        `No product with handle "${SALE_PRODUCT_HANDLE}" (with variants) ` +
          "found — create/seed it before running this fixture script."
      )
    }

    logger.info(
      `Creating sale price list "${PRICE_LIST_TITLE}" — ` +
        `${saleProduct.variants.length} variant(s) of "${SALE_PRODUCT_HANDLE}" ` +
        `at $${SALE_PRICE_USD}...`
    )
    await createPriceListsWorkflow(container).run({
      input: {
        price_lists_data: [
          {
            title: PRICE_LIST_TITLE,
            description:
              "Dev-only sale fixture so the catalog spec can assert the " +
              "struck-original + accent sale price treatment (TEST-01).",
            status: PriceListStatus.ACTIVE,
            prices: saleProduct.variants.map((variant) => ({
              amount: SALE_PRICE_USD,
              currency_code: "usd",
              variant_id: variant.id,
            })),
          },
        ],
      },
    })
  }

  // ── 2. Sold-out size: "sweatpants" XL → stocked_quantity 0 ────────────────
  const { data: soldOutProducts } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "variants.id",
      "variants.title",
      "variants.inventory_items.inventory.id",
      "variants.inventory_items.inventory.location_levels.location_id",
      "variants.inventory_items.inventory.location_levels.stocked_quantity",
    ],
    filters: { handle: SOLD_OUT_PRODUCT_HANDLE },
  })

  const soldOutVariant = soldOutProducts[0]?.variants?.find(
    (variant) => variant.title === SOLD_OUT_SIZE
  )
  if (!soldOutVariant) {
    throw new Error(
      `No variant "${SOLD_OUT_SIZE}" on product "${SOLD_OUT_PRODUCT_HANDLE}" ` +
        "found — create/seed it before running this fixture script."
    )
  }

  const updates = (soldOutVariant.inventory_items ?? []).flatMap(
    (item) =>
      (item?.inventory?.location_levels ?? [])
        .filter((level) => Number(level?.stocked_quantity) !== 0)
        .map((level) => ({
          inventory_item_id: item!.inventory!.id,
          location_id: level!.location_id,
          stocked_quantity: 0,
        }))
  )

  if (updates.length === 0) {
    logger.info(
      `"${SOLD_OUT_PRODUCT_HANDLE}" ${SOLD_OUT_SIZE} is already at 0 stock — ` +
        "skipping."
    )
  } else {
    logger.info(
      `Zeroing ${updates.length} inventory level(s) for ` +
        `"${SOLD_OUT_PRODUCT_HANDLE}" ${SOLD_OUT_SIZE}...`
    )
    await updateInventoryLevelsWorkflow(container).run({
      input: { updates },
    })
  }

  logger.info("Catalog test fixtures applied (TEST-01).")
}
