"use client"

import { useState } from "react"
import Link from "next/link"
import {
  MagnifyingGlass,
  User,
  ShoppingBag,
  BarsThree,
  XMark,
} from "@medusajs/icons"
import Chip from "../ui/Chip"
import CurrencyFlag from "../ui/CurrencyFlag"
import NavSearch from "./NavSearch"
import AccountMenu from "./AccountMenu"
import { useCartCount } from "@lib/hooks/use-cart-count"
import { useCurrency } from "@lib/currency-context"
import type { Currency } from "@lib/price"

/**
 * Responsive storefront header (DESIGN.md primary-nav / FRONTEND-04).
 *
 * - Desktop (≥600px): wordmark + category links + "Sale" + search/user/bag
 *   icon controls, plus a USD/KHR currency toggle.
 * - Mobile (≤599px): hamburger (left) + wordmark (center) + bag (right);
 *   the nav links + currency toggle live in a left slide-in drawer.
 * - Hairline-soft bottom border; canvas surface; 56px row height.
 *
 * The 600px desktop/mobile boundary matches DESIGN.md's "1-up (≤599)"
 * breakpoint, which has no named token in the Tailwind config, so it is
 * expressed with the `min-[600px]:` arbitrary breakpoint variant.
 *
 * Notes:
 * - "Sale" renders in ink, not accent: design.md reserves the accent token
 *   for sale-price text and the KHQR CTA only (operator decision on this task).
 * - Category links are placeholders for the nav shell; real categories are
 *   wired in later tasks (FRONTEND-07 / FRONTEND-10).
 * - Icon controls are plain icon buttons (the ui/ primitives — PillButton /
 *   SearchPill / Chip — don't cover icon-only affordances). The currency
 *   toggle reuses the Chip primitive.
 * - The toggle's choice is owned by `CurrencyProvider` (`@lib/currency-context`),
 *   which both drives every price on the page (via `useCurrency`) and persists
 *   the `ali_currency` preference cookie so the choice survives navigation and
 *   `startKhqr` (`@lib/checkout`) can read it server-side to denominate the KHQR
 *   amount (INTEGRATION-08).
 * - Each currency renders as a flag-only chip (`CurrencyFlag`); the chip's
 *   `aria-label` names the currency, so the flag itself is decorative.
 */

interface NavLink {
  label: string
  href: string
}

const NAV_LINKS: readonly NavLink[] = [
  { label: "New", href: "/category/new" },
  { label: "Women", href: "/category/women" },
  { label: "Men", href: "/category/men" },
  { label: "Kids", href: "/category/kids" },
  { label: "Sale", href: "/category/sale" },
]

const CURRENCIES: readonly Currency[] = ["USD", "KHR"]

const ICON_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70"

function CurrencyToggle({
  currency,
  onChange,
}: {
  currency: Currency
  onChange: (next: Currency) => void
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Currency">
      {CURRENCIES.map((code) => (
        <Chip
          key={code}
          active={currency === code}
          aria-label={`Show prices in ${code}`}
          onClick={() => onChange(code)}
        >
          <CurrencyFlag
            currency={code}
            className="h-3.5 w-auto rounded-sm border border-hairline"
          />
        </Chip>
      ))}
    </div>
  )
}

/**
 * Bag affordance: links to `/cart` and shows a live item-count badge (ink dot,
 * canvas numeral) once the cart is non-empty. Count is supplied by the caller so
 * the desktop and mobile instances share one subscription.
 */
function BagLink({
  count,
  className = "",
}: {
  count: number
  className?: string
}) {
  const label =
    count > 0 ? `Bag, ${count} ${count === 1 ? "item" : "items"}` : "Bag"

  return (
    <Link
      href="/cart"
      aria-label={label}
      className={`relative ${ICON_BUTTON} ${className}`}
    >
      <ShoppingBag className="h-6 w-6" />
      {count > 0 ? (
        <span className="absolute right-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-xs font-medium leading-none text-canvas">
          {count}
        </span>
      ) : null}
    </Link>
  )
}

export default function TopNav() {
  // The display currency is owned by CurrencyProvider so the toggle and every
  // price on the page share one source (and the choice persists via cookie).
  const { currency, setCurrency } = useCurrency()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const itemCount = useCartCount()

  const closeDrawer = () => setIsDrawerOpen(false)

  return (
    <header className="border-b border-hairline-soft bg-canvas text-ink">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-14 max-w-8xl items-center gap-4 px-4 md:px-6"
      >
        {/* Mobile: hamburger (left) */}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={isDrawerOpen}
          onClick={() => setIsDrawerOpen(true)}
          className={`${ICON_BUTTON} -ml-3 min-[600px]:hidden`}
        >
          <BarsThree className="h-6 w-6" />
        </button>

        {/* Wordmark — centered on mobile, leading on desktop */}
        <Link
          href="/"
          aria-label="Ali Store home"
          className="flex-1 text-center text-lg font-medium uppercase tracking-widest text-ink min-[600px]:flex-none min-[600px]:text-left"
        >
          Ali Store
        </Link>

        {/* Desktop: category links */}
        <ul className="hidden flex-1 items-center gap-6 min-[600px]:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="text-base font-medium leading-normal text-ink transition-opacity hover:opacity-70"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop: currency toggle + search/user/bag */}
        <div className="hidden items-center gap-4 min-[600px]:flex">
          <CurrencyToggle currency={currency} onChange={setCurrency} />
          <NavSearch />
          <AccountMenu />
          <BagLink count={itemCount} />
        </div>

        {/* Mobile: bag (right) */}
        <BagLink count={itemCount} className="-mr-3 min-[600px]:hidden" />
      </nav>

      {/* Mobile: left slide-in drawer */}
      <div
        className={`fixed inset-0 z-50 min-[600px]:hidden ${
          isDrawerOpen ? "" : "pointer-events-none"
        }`}
        aria-hidden={!isDrawerOpen}
      >
        {/* Backdrop */}
        <div
          onClick={closeDrawer}
          className={`absolute inset-0 bg-ink/40 transition-opacity ${
            isDrawerOpen ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Panel */}
        <div
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col border-r border-hairline-soft bg-canvas transition-transform ${
            isDrawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex h-14 items-center justify-between border-b border-hairline-soft px-4">
            <span className="text-lg font-medium uppercase tracking-widest text-ink">
              Ali Store
            </span>
            <button
              type="button"
              aria-label="Close menu"
              onClick={closeDrawer}
              className={`${ICON_BUTTON} -mr-3`}
            >
              <XMark className="h-6 w-6" />
            </button>
          </div>

          <div className="flex flex-col px-4 py-xl">
            <Link
              href="/search"
              onClick={closeDrawer}
              className="flex items-center gap-2 py-3 text-base font-medium leading-normal text-ink"
            >
              <MagnifyingGlass className="h-5 w-5" />
              Search
            </Link>

            <a
              href="/account"
              onClick={closeDrawer}
              className="flex items-center gap-2 py-3 text-base font-medium leading-normal text-ink"
            >
              <User className="h-5 w-5" />
              Account
            </a>

            <ul className="flex flex-col">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    onClick={closeDrawer}
                    className="block py-3 text-base font-medium leading-normal text-ink"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto border-t border-hairline-soft px-4 py-xl">
            <CurrencyToggle currency={currency} onChange={setCurrency} />
          </div>
        </div>
      </div>
    </header>
  )
}
