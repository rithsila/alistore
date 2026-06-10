"use client"

/**
 * Display-currency context — the single source of truth for the USD/KHR choice
 * the customer makes with the nav toggle (FRONTEND-04 / FRONTEND-22).
 *
 * Why a context: the toggle lives in `TopNav`, but the prices that must react to
 * it are scattered across the catalog grid, the PDP buy box, the cart, and
 * checkout. Holding the choice in one client context lets every price re-render
 * instantly when the toggle flips — no page reload, no refetch — while keeping a
 * single place that owns the `ali_currency` preference cookie.
 *
 * The cookie (read server-side by `@lib/checkout` to denominate the KHQR amount,
 * INTEGRATION-08) survives navigation and future visits. It is a plain UI
 * preference cookie on purpose — not a credential — so security.md's HttpOnly
 * rule (which covers tokens / session ids / payment refs) does not apply.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import type { ReactNode } from "react"
import type { Currency } from "@lib/price"

/** Display-currency preference cookie, read server-side by `@lib/checkout`. */
const CURRENCY_COOKIE = "ali_currency"

/** ~1 year — a long-lived display preference, not a session credential. */
const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Read the saved toggle choice; `null` when absent or not a known currency. */
function readCurrencyCookie(): Currency | null {
  if (typeof document === "undefined") {
    return null
  }
  const entry = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CURRENCY_COOKIE}=`))
  const value = entry?.slice(CURRENCY_COOKIE.length + 1)
  return value === "USD" || value === "KHR" ? value : null
}

/** Persist the toggle choice for `startKhqr` (and future visits) to read. */
function writeCurrencyCookie(code: Currency): void {
  if (typeof document === "undefined") {
    return
  }
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${CURRENCY_COOKIE}=${code}; Path=/; Max-Age=${CURRENCY_COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

interface CurrencyContextValue {
  /** The currency every price on the page is currently displayed in. */
  currency: Currency
  /** Select a currency: updates every price and persists the cookie. */
  setCurrency: (next: Currency) => void
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null)

/**
 * Provides the selected display currency to the whole app. Mounted once in the
 * root layout so every price surface and the nav toggle share one source.
 *
 * The cookie can't be read during SSR/hydration (`document` doesn't exist
 * server-side, and reading it in the initial state would mismatch the server
 * markup), so the first paint shows the USD default and corrects itself to the
 * saved choice immediately after mount — the same pattern the toggle used before.
 */
export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("USD")

  useEffect(() => {
    const saved = readCurrencyCookie()
    if (saved) {
      setCurrencyState(saved)
    }
  }, [])

  const setCurrency = useCallback((next: Currency) => {
    setCurrencyState(next)
    writeCurrencyCookie(next)
  }, [])

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  )
}

/** Read the selected display currency (and the setter). */
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext)
  if (!ctx) {
    throw new Error("useCurrency must be used within a CurrencyProvider")
  }
  return ctx
}
