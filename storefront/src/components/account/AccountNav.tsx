import Link from "next/link"

import { logout } from "@lib/data/customer"

/**
 * Section navigation inside the account area. Wave 1 surfaces Home + Profile;
 * Orders + Addresses are added in Wave 2. Ink only (design.md).
 */

const LINKS: readonly { label: string; href: string }[] = [
  { label: "Account", href: "/account" },
  { label: "Profile", href: "/account/profile" },
]

export default function AccountNav() {
  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="py-2 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-70"
        >
          {link.label}
        </Link>
      ))}
      <form action={logout}>
        <button
          type="submit"
          className="py-2 text-left text-base font-medium leading-normal text-mute transition-opacity hover:opacity-70"
        >
          Log out
        </button>
      </form>
    </nav>
  )
}
