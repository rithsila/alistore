import { Module } from "@medusajs/framework/utils"
import SocialIdentityModuleService from "./service"

// Module name is camelCase (never kebab-case) — it becomes the container
// resolution key, e.g. container.resolve(SOCIAL_IDENTITY_MODULE).
export const SOCIAL_IDENTITY_MODULE = "socialIdentity"

export default Module(SOCIAL_IDENTITY_MODULE, {
  service: SocialIdentityModuleService,
})
