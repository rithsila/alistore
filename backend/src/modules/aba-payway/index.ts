/**
 * ABA PayWay payment provider registration — PAYWAY-02.
 *
 * Registered under Medusa's Payment Module. With provider identifier "payway"
 * and the `id: "khqr"` set in `medusa-config.ts`, the resulting provider id is
 * `pp_payway_khqr`. Registration is conditional on PAYWAY_MERCHANT_ID +
 * PAYWAY_API_KEY (see medusa-config.ts) — dev boots without credentials.
 */
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import PayWayProviderService from "./service"

export const PAYWAY_PROVIDER_ID = "pp_payway_khqr"

export default ModuleProvider(Modules.PAYMENT, {
  services: [PayWayProviderService],
})
