import { redirect } from "next/navigation"

import TopNav from "../../components/layout/TopNav"
import AccountNav from "../../components/account/AccountNav"
import { retrieveCustomer } from "@lib/data/customer"

/**
 * Account-area shell + guard (Approach A). Resolves the current customer from
 * the request session; guests are redirected home (the nav popover, not this
 * route, is where sign-in happens). Every child page is therefore guaranteed an
 * authenticated customer. Server Component (no interactivity here).
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const customer = await retrieveCustomer()
  if (!customer) {
    redirect("/")
  }

  return (
    <>
      <TopNav />
      <main className="mx-auto flex max-w-5xl flex-col gap-section px-4 py-section min-[600px]:flex-row min-[600px]:px-6">
        <aside className="min-[600px]:w-48 min-[600px]:shrink-0">
          <AccountNav />
        </aside>
        <section className="flex-1">{children}</section>
      </main>
    </>
  )
}
