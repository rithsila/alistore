import { model } from "@medusajs/framework/utils"

// Links a Facebook login to a Medusa customer. Fields match ImplementPlan
// SETUP-07 (table name `customer_social_identity`, per PRD §4 / CLAUDE.md).
//
// `created_at` (plus `updated_at` and `deleted_at`) is added automatically by
// model.define — it must NOT be declared explicitly here.
const SocialIdentity = model.define("customer_social_identity", {
  id: model.id().primaryKey(),
  customer_id: model.text(),
  provider: model.text().default("facebook"),
  provider_user_id: model.text(),
})

export default SocialIdentity
