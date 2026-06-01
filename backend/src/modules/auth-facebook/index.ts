/**
 * Facebook auth provider registration — BACKEND-05B.
 *
 * Exposes the provider to Medusa's Auth Module. Registered in `medusa-config.ts`
 * under the auth module's `providers` (alongside `emailpass`), which makes
 * `provider="facebook"` a first-class auth provider so `auth_identity` records
 * and `authModule.validateCallback("facebook", …)` work idiomatically.
 */
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import FacebookAuthService from "./service"

export default ModuleProvider(Modules.AUTH, {
  services: [FacebookAuthService],
})
