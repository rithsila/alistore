import { retrieveCustomer } from "@lib/data/customer"
import ProfileForm from "../../../components/account/ProfileForm"

/**
 * Account profile page. The `/account` layout guard guarantees a signed-in
 * customer; we read it here to prefill the form. Server Component — the editable
 * surface is the client `ProfileForm`.
 */
export default async function ProfilePage() {
  const customer = await retrieveCustomer()

  return (
    <div>
      <h1 className="text-3xl font-medium uppercase text-ink">Profile</h1>
      <p className="mt-4 mb-section text-base font-medium leading-normal text-mute">
        Update the name and phone we use for your orders.
      </p>
      <ProfileForm
        firstName={customer?.first_name ?? ""}
        lastName={customer?.last_name ?? ""}
        phone={customer?.phone ?? ""}
        email={customer?.email ?? ""}
      />
    </div>
  )
}
