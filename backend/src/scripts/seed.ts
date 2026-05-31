import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createProductCategoriesWorkflow,
  createRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

// SETUP-04 — Regions & currencies (USD + KHR).
//
// Medusa v2 models multi-currency at the STORE level (`supported_currencies`),
// while a region carries a single `currency_code`. Per the locked currency
// decision, USD is the store default and base; KHR is enabled at the store and
// derived for display/charge via `USD_KHR_RATE` (see PRD FRONTEND-22 /
// INTEGRATION-08). The Cambodia region itself is USD.
//
// Run with: npx medusa exec ./src/scripts/seed.ts  (dev only)

const CAMBODIA_REGION_NAME = "Cambodia"

// SETUP-09 — Storefront product categories (the category tabs).
//
// English names only for v1 per the locked English-first decision (CLARIFY-02);
// Khmer category labels are deferred to v2. Each category has an explicit,
// stable handle used in storefront URLs.
const STOREFRONT_CATEGORIES: ReadonlyArray<{ name: string; handle: string }> = [
  { name: "T-shirt", handle: "t-shirt" },
  { name: "Polo", handle: "polo" },
  { name: "Outerwear", handle: "outerwear" },
  { name: "Hoodie", handle: "hoodie" },
  { name: "Pants", handle: "pants" },
  { name: "Accessories", handle: "accessories" },
]

export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Store currencies — USD (default) + KHR enabled.
  const { data: stores } = await query.graph({
    entity: "store",
    fields: [
      "id",
      "supported_currencies.currency_code",
      "supported_currencies.is_default",
    ],
  })

  const store = stores[0]
  if (!store) {
    throw new Error(
      "No store found. Run core migrations (SETUP-02) before seeding regions/currencies."
    )
  }

  logger.info("Setting store supported currencies to USD (default) + KHR...")
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        supported_currencies: [
          { currency_code: "usd", is_default: true },
          { currency_code: "khr" },
        ],
      },
    },
  })

  // 2. Cambodia region (USD). Idempotent: skip if it already exists.
  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
    filters: { name: CAMBODIA_REGION_NAME },
  })

  if (existingRegions.length > 0) {
    logger.info(
      `Region "${CAMBODIA_REGION_NAME}" already exists — skipping creation.`
    )
  } else {
    logger.info("Creating Cambodia region (currency: usd)...")
    await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: CAMBODIA_REGION_NAME,
            currency_code: "usd",
            countries: ["kh"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    })
  }

  // 3. Product categories (English names for v1 — Khmer labels = v2).
  // These become the storefront category tabs. Idempotent: only create
  // categories whose handle is not already present.
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  })

  const existingHandles = new Set(existingCategories.map((c) => c.handle))
  const categoriesToCreate = STOREFRONT_CATEGORIES.filter(
    (c) => !existingHandles.has(c.handle)
  )

  if (categoriesToCreate.length === 0) {
    logger.info("All storefront categories already exist — skipping creation.")
  } else {
    logger.info(
      `Creating ${categoriesToCreate.length} product categor` +
        `${categoriesToCreate.length === 1 ? "y" : "ies"}: ` +
        `${categoriesToCreate.map((c) => c.name).join(", ")}...`
    )
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: categoriesToCreate.map((c) => ({
          name: c.name,
          handle: c.handle,
          is_active: true,
        })),
      },
    })
  }

  logger.info("Finished seeding region, currency & category data.")
}
