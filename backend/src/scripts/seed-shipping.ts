import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Fulfillment / shipping seed — unblocks COD + KHQR order completion.
 *
 * The base seed (`seed.ts`) creates the store, the Cambodia region and the
 * product categories, but NO fulfillment infrastructure. Medusa's
 * `completeCartWorkflow` (used by `POST /store/orders/cod`, BACKEND-04, and the
 * KHQR finalize, BACKEND-03B) requires the cart to have a shipping method, and
 * `GET /store/shipping-options?cart_id=` only returns options when the cart's
 * shipping-address country falls inside a fulfillment set's service zone AND the
 * cart's items belong to a shipping profile that the option serves. With none of
 * that seeded, the storefront's COD path (`@lib/checkout`) fails before it can
 * place an order — the gap first noted in BACKEND-06 and confirmed live (a `kh`
 * cart with a line item returns 0 shipping options).
 *
 * This script creates the canonical chain, idempotently (safe to re-run):
 *   stock location ── manual fulfillment provider
 *               └──── sales channel (so the location serves the storefront)
 *               └──── fulfillment set "Cambodia delivery"
 *                         └── service zone (country = kh)
 *                                 └── flat-rate shipping option (USD $1.50,
 *                                     Cambodia region) on the default profile
 *   default shipping profile ── all products (so cart items match the option)
 *
 * Price: flat $1.50 to match the locked delivery fee (CLARIFY-04, env
 * `DELIVERY_FEE`). The free-over-$50 rule + env-driven fee remain a separate
 * concern; this only provides a valid, completable shipping method.
 *
 * Run (dev only — Proxmox): npx medusa exec ./src/scripts/seed-shipping.ts
 */

const CAMBODIA_REGION_NAME = "Cambodia"
const COUNTRY_CODE = "kh"
const FULFILLMENT_SET_NAME = "Cambodia delivery"
const SERVICE_ZONE_NAME = "Cambodia"
const SHIPPING_OPTION_NAME = "Standard Delivery"
const DELIVERY_FEE_USD = 1.5

/** Create a link, treating an already-existing link as success (idempotent). */
async function ensureLink(
  link: { create: (data: unknown) => Promise<unknown> },
  data: unknown,
  label: string,
  logger: { info: (m: string) => void }
): Promise<void> {
  try {
    await link.create(data)
    logger.info(`Linked: ${label}`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (/exist|duplicate|unique/i.test(message)) {
      logger.info(`Link already present: ${label}`)
    } else {
      throw e
    }
  }
}

export default async function seedShipping({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const fulfillment = container.resolve(Modules.FULFILLMENT)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)

  // ── Region (must already exist — base seed creates it) ─────────────────────
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
    filters: { name: CAMBODIA_REGION_NAME },
  })
  const region = regions[0]
  if (!region) {
    throw new Error(
      `Region "${CAMBODIA_REGION_NAME}" not found — run seed.ts first.`
    )
  }

  // ── Fulfillment provider (the built-in manual provider) ────────────────────
  // No `is_enabled` filter — the prop isn't filterable in this @medusajs/types
  // pin; the manual provider is enabled by default and we pick it by id below.
  const providers = await fulfillment.listFulfillmentProviders(
    {},
    { take: null }
  )
  const provider =
    providers.find((p) => /manual/i.test(p.id)) ?? providers[0]
  if (!provider) {
    throw new Error("No enabled fulfillment provider found.")
  }
  logger.info(`Using fulfillment provider: ${provider.id}`)

  // ── Sales channel (link the location so it serves the storefront) ──────────
  const salesChannels = await salesChannelService.listSalesChannels(
    {},
    { take: 1 }
  )
  const salesChannel = salesChannels[0]
  if (!salesChannel) {
    throw new Error("No sales channel found.")
  }

  // ── Stock location (resolve existing — inventory already lives there) ──────
  let stockLocations = await stockLocationService.listStockLocations(
    {},
    { take: 1 }
  )
  let stockLocation = stockLocations[0]
  if (!stockLocation) {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: {
        locations: [
          {
            name: "Phnom Penh Warehouse",
            address: { city: "Phnom Penh", country_code: COUNTRY_CODE, address_1: "" },
          },
        ],
      },
    })
    stockLocation = result[0]
    logger.info(`Created stock location: ${stockLocation.id}`)
  } else {
    logger.info(`Using existing stock location: ${stockLocation.id}`)
  }

  await ensureLink(
    link,
    {
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: provider.id },
    },
    "stock-location ↔ fulfillment provider",
    logger
  )
  await ensureLink(
    link,
    {
      [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannel.id },
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    },
    "sales-channel ↔ stock-location",
    logger
  )

  // ── Default shipping profile (resolve or create) ───────────────────────────
  let profiles = await fulfillment.listShippingProfiles(
    { type: "default" },
    { take: 1 }
  )
  let shippingProfile = profiles[0]
  if (!shippingProfile) {
    const created = await fulfillment.createShippingProfiles([
      { name: "Default", type: "default" },
    ])
    shippingProfile = Array.isArray(created) ? created[0] : created
    logger.info(`Created default shipping profile: ${shippingProfile.id}`)
  } else {
    logger.info(`Using existing shipping profile: ${shippingProfile.id}`)
  }

  // ── Fulfillment set + service zone covering kh (resolve or create) ─────────
  const existingSets = await fulfillment.listFulfillmentSets(
    { type: "shipping" },
    { relations: ["service_zones", "service_zones.geo_zones"], take: null }
  )
  let serviceZoneId: string | undefined
  for (const set of existingSets) {
    for (const zone of set.service_zones ?? []) {
      const coversKh = (zone.geo_zones ?? []).some(
        (g: { country_code?: string }) => g.country_code === COUNTRY_CODE
      )
      if (coversKh) {
        serviceZoneId = zone.id
        break
      }
    }
    if (serviceZoneId) break
  }

  if (!serviceZoneId) {
    const fulfillmentSet = await fulfillment.createFulfillmentSets({
      name: FULFILLMENT_SET_NAME,
      type: "shipping",
      service_zones: [
        {
          name: SERVICE_ZONE_NAME,
          geo_zones: [{ country_code: COUNTRY_CODE, type: "country" }],
        },
      ],
    })
    serviceZoneId = fulfillmentSet.service_zones[0].id
    logger.info(
      `Created fulfillment set ${fulfillmentSet.id} + service zone ${serviceZoneId} (kh)`
    )
    await ensureLink(
      link,
      {
        [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
      },
      "stock-location ↔ fulfillment set",
      logger
    )
  } else {
    logger.info(`Using existing service zone covering kh: ${serviceZoneId}`)
  }

  // ── Shipping option (create only if the service zone has none) ─────────────
  const existingOptions = await fulfillment.listShippingOptions(
    { service_zone: { id: serviceZoneId } },
    { take: 1 }
  )
  if (existingOptions.length > 0) {
    logger.info(
      `Service zone already has a shipping option: ${existingOptions[0].id} — skipping.`
    )
  } else {
    const { result } = await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: SHIPPING_OPTION_NAME,
          price_type: "flat",
          provider_id: provider.id,
          service_zone_id: serviceZoneId,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Standard",
            description: "Delivery within Cambodia",
            code: "standard",
          },
          prices: [
            { currency_code: "usd", amount: DELIVERY_FEE_USD },
            { region_id: region.id, amount: DELIVERY_FEE_USD },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    logger.info(`Created shipping option: ${result[0].id} ($${DELIVERY_FEE_USD})`)
  }

  // ── Ensure every product belongs to the default shipping profile ───────────
  // Store shipping options are filtered by the shipping profile of the cart's
  // items; products imported before any profile existed carry none, which would
  // keep the option hidden. Link the unlinked ones (idempotent).
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "shipping_profile.id"],
  })
  const unlinked = products.filter(
    (p: { shipping_profile?: { id?: string } | null }) => !p.shipping_profile?.id
  )
  logger.info(
    `Products: ${products.length} total, ${unlinked.length} without a shipping profile.`
  )
  for (const product of unlinked) {
    await ensureLink(
      link,
      {
        [Modules.PRODUCT]: { product_id: product.id },
        [Modules.FULFILLMENT]: { shipping_profile_id: shippingProfile.id },
      },
      `product ${product.id} ↔ default profile`,
      logger
    )
  }

  logger.info("Finished seeding Cambodia shipping infrastructure.")
}
