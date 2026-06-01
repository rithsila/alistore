import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  createCartWorkflow,
  listShippingOptionsForCartWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * DEV-ONLY helper — build a completion-ready cart for testing BACKEND-04.
 *
 * `POST /store/orders/cod` assumes the storefront already prepped the cart
 * (email + shipping address + shipping method); a raw curl has none of that.
 * This script discovers the seeded region, sales channel, a stocked variant,
 * and a shipping option, then assembles a cart that `completeCartWorkflow` will
 * accept — and prints the `cart_id` plus a ready-to-run curl.
 *
 * It mutates only dev data (creates one cart) and never hardcodes secrets:
 * the publishable key for the printed curl is read from `TEST_PUBLISHABLE_KEY`
 * (falls back to a `pk_…` placeholder).
 *
 * Run (dev only — Proxmox):
 *   npx medusa exec ./src/scripts/dev-create-test-cart.ts
 *
 * Prereqs (create in Admin if missing — the script tells you which): a USD
 * region, a published product with a stocked variant in the sales channel, and
 * a shipping option whose service zone covers Cambodia.
 */

const TEST_EMAIL = "cod-test@example.com"
const TEST_SHIPPING_ADDRESS = {
  first_name: "Dara",
  last_name: "Sok",
  phone: "+85512345678",
  address_1: "St 271, Sangkat Tuol Tumpung",
  city: "Phnom Penh",
  country_code: "kh",
} as const

/** Coerce a Medusa BigNumberValue (number | string | { numeric }) to number. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (value && typeof value === "object" && "numeric" in value) {
    return Number((value as { numeric: unknown }).numeric)
  }
  return NaN
}

export default async function devCreateTestCart({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // 1. Region — prefer the seeded Cambodia (USD) region, else any region.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })
  const region = regions.find((r) => r.name === "Cambodia") ?? regions[0]
  if (!region) {
    logger.error(
      "No region found. Run the seed first: npx medusa exec ./src/scripts/seed.ts"
    )
    return
  }

  // 2. Sales channel — the cart must share the channel your publishable key maps
  //    to. Picks the default if present, else the first.
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name", "is_disabled"],
  })
  const salesChannel =
    channels.find((c) => /default/i.test(c.name ?? "") && !c.is_disabled) ??
    channels.find((c) => !c.is_disabled) ??
    channels[0]
  if (!salesChannel) {
    logger.error("No sales channel found. Create one in Admin → Settings.")
    return
  }

  // 3. A stocked variant from a published product (treats inventory-unmanaged or
  //    backorder variants as always available). Mirrors the COD route's
  //    availability logic so the cart it builds will actually complete.
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "title",
      "manage_inventory",
      "allow_backorder",
      "product.id",
      "product.title",
      "product.status",
      "inventory_items.required_quantity",
      "inventory_items.inventory.location_levels.stocked_quantity",
      "inventory_items.inventory.location_levels.reserved_quantity",
    ],
    pagination: { take: 200, skip: 0 },
  })

  const stockedVariant = variants.find((v: any) => {
    if (v.product?.status !== "published") return false
    if (v.manage_inventory === false || v.allow_backorder === true) return true
    const items = v.inventory_items ?? []
    if (items.length === 0) return false
    return items.every((ii: any) => {
      const perUnit = toNumber(ii.required_quantity)
      const required = Number.isFinite(perUnit) && perUnit > 0 ? perUnit : 1
      let best = -Infinity
      for (const lvl of ii.inventory?.location_levels ?? []) {
        const avail =
          toNumber(lvl.stocked_quantity) - toNumber(lvl.reserved_quantity)
        if (avail > best) best = avail
      }
      return best >= required
    })
  })

  if (!stockedVariant) {
    logger.error(
      "No published product with a stocked variant found. In Admin: create a " +
        "product, publish it, add it to the sales channel, and set inventory > 0."
    )
    return
  }

  // 4. Create the cart (region + channel + email + shipping address + 1 item).
  const { result: cart } = await createCartWorkflow(container).run({
    input: {
      region_id: region.id,
      sales_channel_id: salesChannel.id,
      email: TEST_EMAIL,
      shipping_address: { ...TEST_SHIPPING_ADDRESS },
      items: [{ variant_id: stockedVariant.id, quantity: 1 }],
    },
  })

  // 5. Shipping method — required for completion. List options the cart is
  //    eligible for and attach the first one.
  const { result: shippingOptions } = await listShippingOptionsForCartWorkflow(
    container
  ).run({ input: { cart_id: cart.id } })

  if (!shippingOptions?.length) {
    logger.warn(
      `Cart ${cart.id} was created, but NO shipping option covers it — ` +
        "completeCart will reject it. In Admin → Settings → Locations & Shipping, " +
        "add a shipping option whose service zone includes Cambodia (kh), then re-run."
    )
    logger.info(`Partial cart id (not completable): ${cart.id}`)
    return
  }

  await addShippingMethodToCartWorkflow(container).run({
    input: {
      cart_id: cart.id,
      options: [{ id: shippingOptions[0].id }],
    },
  })

  // 6. Report — print the cart id and a ready curl.
  const key = process.env.TEST_PUBLISHABLE_KEY || "pk_YOUR_PUBLISHABLE_KEY"
  logger.info("✅ Test cart ready for POST /store/orders/cod")
  logger.info(`   cart_id        : ${cart.id}`)
  logger.info(`   region         : ${region.name} (${region.currency_code})`)
  logger.info(`   sales_channel  : ${salesChannel.name}`)
  logger.info(
    `   product/variant: ${stockedVariant.product?.title} / ${stockedVariant.title}`
  )
  logger.info(`   shipping_option: ${shippingOptions[0].name}`)
  logger.info("")
  logger.info("Run (set TEST_PUBLISHABLE_KEY to inline your pk_… key):")
  logger.info(
    `curl -X POST http://localhost:9000/store/orders/cod ` +
      `-H "Content-Type: application/json" ` +
      `-H "x-publishable-api-key: ${key}" ` +
      `-d '{"cart_id":"${cart.id}","phone":"+85512345678","name":"Dara Sok",` +
      `"address":"St 271, Phnom Penh","note":"call before delivery"}'`
  )
}
