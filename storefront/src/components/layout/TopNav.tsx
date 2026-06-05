"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  MagnifyingGlass,
  User,
  ShoppingBag,
  BarsThree,
  XMark,
} from "@medusajs/icons"
import Chip from "../ui/Chip"
import { useCartCount } from "@lib/hooks/use-cart-count"
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
 * - The toggle persists its choice in the `ali_currency` preference cookie
 *   (INTEGRATION-08) so it survives navigation and `startKhqr` (`@lib/checkout`)
 *   can read it server-side to denominate the KHQR amount. A plain cookie on
 *   purpose: a UI preference, not a credential (security.md's HttpOnly rule
 *   covers tokens/session ids/payment refs — this is none of those).
 */

/** Display-currency preference cookie, read server-side by `@lib/checkout`. */
const CURRENCY_COOKIE = "ali_currency"

/** ~1 year — a long-lived display preference, not a session credential. */
const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Read the saved toggle choice; `null` when absent or not a known currency. */
function readCurrencyCookie(): Currency | null {
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CURRENCY_COOKIE}=`))
  const value = entry?.slice(CURRENCY_COOKIE.length + 1)
  return value === "USD" || value === "KHR" ? value : null
}

/** Persist the toggle choice for `startKhqr` (and future visits) to read. */
function writeCurrencyCookie(code: Currency): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${CURRENCY_COOKIE}=${code}; Path=/; Max-Age=${CURRENCY_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

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
  const [currency, setCurrency] = useState<Currency>("USD")
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const itemCount = useCartCount()

  // Restore the saved toggle choice after mount (INTEGRATION-08). The cookie
  // can't be read during SSR/hydration — `document` doesn't exist server-side,
  // and reading it in the initial state would mismatch the server markup — so
  // the first paint shows the USD default and corrects itself immediately.
  useEffect(() => {
    const saved = readCurrencyCookie()
    if (saved) {
      setCurrency(saved)
    }
  }, [])

  // Selecting a currency persists it so the choice survives navigation and
  // `startKhqr` (server action) can denominate the KHQR amount with it.
  const handleCurrencyChange = (next: Currency) => {
    setCurrency(next)
    writeCurrencyCookie(next)
  }

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
          <CurrencyToggle currency={currency} onChange={handleCurrencyChange} />
          <button type="button" aria-label="Search" className={ICON_BUTTON}>
            <MagnifyingGlass className="h-6 w-6" />
          </button>
          <button type="button" aria-label="Account" className={ICON_BUTTON}>
            <User className="h-6 w-6" />
          </button>
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
            <CurrencyToggle
              currency={currency}
              onChange={handleCurrencyChange}
            />
          </div>
        </div>
      </div>
    </header>
  )
}
