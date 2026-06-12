import { retrieveCustomer } from "@lib/data/customer"

/**
 * Account home. The layout guard guarantees a customer, but we read it again
 * for the greeting (cheap, `no-store`, session-scoped).
 */
export default async function AccountHomePage() {
  const customer = await retrieveCustomer()
  const name =
    [customer?.first_name, customer?.last_name]
      .filter(Boolean)
      .join(" ")
      .trim() || "there"

  return (
    <div>
      <h1 className="text-3xl font-medium uppercase text-ink">My account</h1>
      <p className="mt-4 text-base font-medium leading-normal text-mute">
        Hello {name}. Manage your profile and review your details here.
      </p>
    </div>
  )
}
