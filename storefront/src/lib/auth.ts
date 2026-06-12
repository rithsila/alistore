"use server"

/**
 * Social-login wiring — INTEGRATION-06 (Facebook) and INTEGRATION-06B (Google).
 * Both providers reuse this one file rather than forking it, so they share a
 * single post-login session/prefill path (the "reuse, do not fork" requirement).
 *
 * Stack.md names `lib/auth.ts` as the storefront's auth helper. Its job here is
 * the second half of the social-login round-trip — "session → prefilled form":
 * after a completed OAuth flow the backend callback (BACKEND-05B / 05D) has
 * established a Medusa customer session and 302-redirected the browser back to
 * `/checkout`; this module reads that session and returns the customer's display
 * name so the checkout page can drop it into the Full Name field.
 *
 * Why a dedicated reader (and not the starter's `retrieveCustomer`):
 *  - The starter authenticates with a **`_medusa_jwt` Bearer token**
 *    (`getAuthHeaders`). Our OAuth callbacks instead establish a session via
 *    `req.session.auth_context` → an HttpOnly **`connect.sid`** cookie (the same
 *    mechanism as Medusa's `/auth/session`). After a social login there is no
 *    JWT, so a token-only read returns nothing.
 *  - The "Rewrite + session" approach (chosen for INTEGRATION-06): the storefront
 *    proxies `/store/auth/*` to the backend (see `next.config.js`), so the OAuth
 *    state cookie and `connect.sid` are set on the **storefront origin**. This
 *    server action then forwards `connect.sid` (and any `_medusa_jwt`, so an
 *    emailpass session still works) to `/store/customers/me` to resolve the
 *    signed-in customer.
 *
 * Security (security.md):
 *  - Scoped to the current request's own session cookie — no client-supplied id,
 *    so a caller can only read their own customer.
 *  - The session id is forwarded only to the backend over the SDK and is never
 *    logged; the customer name is used solely to prefill the form (never logged —
 *    phones/PII stay out of logs).
 *  - Failures resolve to `null` (no internal detail surfaced to the client).
 */

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"
import { buildSessionHeaders } from "@lib/data/session-headers"

/**
 * Resolve the currently signed-in customer from the request's session, or
 * `null` for a guest / on any failure. Reads `/store/customers/me` with whatever
 * credential the request carries (JWT and/or `connect.sid`).
 */
async function retrieveSessionCustomer(): Promise<HttpTypes.StoreCustomer | null> {
  const headers = await buildSessionHeaders()

  // No credential at all → guest; skip the round-trip.
  if (!headers["authorization"] && !headers["cookie"]) {
    return null
  }

  return await sdk.client
    .fetch<{ customer: HttpTypes.StoreCustomer }>("/store/customers/me", {
      method: "GET",
      headers,
      cache: "no-store",
    })
    .then(({ customer }) => customer)
    .catch(() => null)
}

/**
 * Return the signed-in customer's display name (first + last) for prefilling the
 * checkout form after a social login, or `null` for guests. Shared by both the
 * Facebook (INTEGRATION-06) and Google (INTEGRATION-06B) login buttons.
 */
export async function getSocialLoginPrefillName(): Promise<string | null> {
  const customer = await retrieveSessionCustomer()
  if (!customer) {
    return null
  }

  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return name || null
}
