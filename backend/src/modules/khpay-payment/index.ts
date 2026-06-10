/**
 * KHPAY payment provider registration — KHPAY-01.
 *
 * Registered under Medusa's Payment Module. With provider identifier "khpay"
 * and the `id: "khqr"` set in `medusa-config.ts`, the resulting provider id is
 * `pp_khpay_khqr`. Registration is conditional on KHPAY_API_KEY (see
 * medusa-config.ts) — dev boots without credentials. Bakong and ABA PayWay
 * stay registered/registerable but dormant (the storefront targets KHPAY).
 */
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import KhpayProviderService from "./service"

export const KHPAY_PROVIDER_ID = "pp_khpay_khqr"

export default ModuleProvider(Modules.PAYMENT, {
  services: [KhpayProviderService],
})
