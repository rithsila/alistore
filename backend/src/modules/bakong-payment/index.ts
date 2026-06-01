/**
 * Bakong KHQR payment provider registration — BACKEND-03.
 *
 * Registered under Medusa's Payment Module (PRD §4). With provider identifier
 * "bakong" and the `id: "khqr"` set in `medusa-config.ts`, the resulting
 * provider id is `pp_bakong_khqr`.
 */
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import BakongProviderService from "./service"

export const BAKONG_PROVIDER_ID = "pp_bakong_khqr"

export default ModuleProvider(Modules.PAYMENT, {
  services: [BakongProviderService],
})
