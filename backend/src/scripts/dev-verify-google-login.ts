import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIAL_IDENTITY_MODULE } from "../modules/social-identity"

// TEST-08B dev verification helper (dev DB only — never run against production).
//
// READ-ONLY. Sibling of dev-verify-fb-login.ts (TEST-08) for the Google flow.
// Prints the backend-side evidence the Google-login E2E spec
// (storefront/tests/google-login.spec.ts) asserts after a completed (mock-seam)
// OAuth round-trip: every `customer_social_identity` row recorded for the given
// provider user id (the spec expects EXACTLY ONE, `provider=google`, pointing at
// the customer the session returned — and still exactly one after a returning
// login). Output is one machine-readable line the spec extracts by marker:
//
//   GOOGLE_LOGIN_VERIFY_RESULT {"identities":[...]}
//
// No PII here: the provider user id is the spec's synthetic per-run mock id and
// customer_id is an opaque Medusa id (no name/email/phone is printed).
//
// Run with: npx medusa exec ./src/scripts/dev-verify-google-login.ts <provider_user_id>

const RESULT_MARKER = "GOOGLE_LOGIN_VERIFY_RESULT"

/** The provider id the OAuth routes record identities under (BACKEND-05D). */
const GOOGLE_PROVIDER_ID = "google"

/** Minimal view of the social-identity module's auto-generated CRUD. */
type SocialIdentityService = {
  listSocialIdentities(filters: Record<string, unknown>): Promise<
    Array<{
      id: string
      customer_id: string
      provider: string
      provider_user_id: string
      created_at?: string | Date
    }>
  >
}

export default async function devVerifyGoogleLogin({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const providerUserId = args?.[0]
  if (!providerUserId) {
    throw new Error(
      "usage: npx medusa exec ./src/scripts/dev-verify-google-login.ts <provider_user_id>"
    )
  }

  const socialIdentities = container.resolve<SocialIdentityService>(
    SOCIAL_IDENTITY_MODULE
  )
  const identities = await socialIdentities.listSocialIdentities({
    provider: GOOGLE_PROVIDER_ID,
    provider_user_id: providerUserId,
  })

  logger.info(`${RESULT_MARKER} ${JSON.stringify({ identities })}`)
}
