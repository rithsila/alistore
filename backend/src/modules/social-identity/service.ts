import { MedusaService } from "@medusajs/framework/utils"
import SocialIdentity from "./models/social-identity"

// MedusaService auto-generates CRUD methods for SocialIdentity
// (createSocialIdentities, listSocialIdentities, retrieveSocialIdentity, ...).
// The Facebook OAuth flow that creates these links is built later
// (INTEGRATION-07) — no business logic here.
class SocialIdentityModuleService extends MedusaService({
  SocialIdentity,
}) {}

export default SocialIdentityModuleService
