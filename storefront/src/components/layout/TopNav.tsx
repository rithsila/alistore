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
 */

type Currency = "USD" | "KHR"

interface NavLink {
  label: string
  href: string
}

// Placeholder category links for the nav shell (real categories wired later).
const NAV_LINKS: readonly NavLink[] = [
  { label: "New", href: "/" },
  { label: "Women", href: "/" },
  { label: "Men", href: "/" },
  { label: "Kids", href: "/" },
  { label: "Sale", href: "/" },
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
          {code}
        </Chip>
      ))}
    </div>
  )
}

export default function TopNav() {
  const [currency, setCurrency] = useState<Currency>("USD")
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

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
          <button type="button" aria-label="Search" className={ICON_BUTTON}>
            <MagnifyingGlass className="h-6 w-6" />
          </button>
          <button type="button" aria-label="Account" className={ICON_BUTTON}>
            <User className="h-6 w-6" />
          </button>
          <button type="button" aria-label="Bag" className={ICON_BUTTON}>
            <ShoppingBag className="h-6 w-6" />
          </button>
        </div>

        {/* Mobile: bag (right) */}
        <button
          type="button"
          aria-label="Bag"
          className={`${ICON_BUTTON} -mr-3 min-[600px]:hidden`}
        >
          <ShoppingBag className="h-6 w-6" />
        </button>
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

          <ul className="flex flex-col px-4 py-xl">
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

          <div className="mt-auto border-t border-hairline-soft px-4 py-xl">
            <CurrencyToggle currency={currency} onChange={setCurrency} />
          </div>
        </div>
      </div>
    </header>
  )
}
