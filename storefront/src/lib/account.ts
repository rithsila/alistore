"use server"

import { retrieveCustomer } from "@lib/data/customer"

export interface AccountMenuState {
  /** Display name for the signed-in greeting (never any other PII). */
  name: string
}

/**
 * Resolve the signed-in customer's display name for the nav, or `null` for a
 * guest. Mirrors the `getSocialLoginPrefillName` pattern (mount-time read from a
 * client component) but returns only the name — no phone/email crosses to the
 * client.
 */
export async function getAccountMenuState(): Promise<AccountMenuState | null> {
  const customer = await retrieveCustomer()
  if (!customer) return null

  const name = [customer.first_name, customer.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return { name: name || "Account" }
}
