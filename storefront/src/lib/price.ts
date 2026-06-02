/**
 * Currency formatting — FRONTEND-22.
 *
 * Single source of truth for turning a USD-base price into a display-ready
 * string in the currency the customer picked with the nav toggle (FRONTEND-04).
 * The presentational components (`ProductCard`, `BuyBox`, cart, checkout) take
 * already-formatted strings — they call into here rather than formatting inline.
 *
 * Locked decisions (PRD §234 / ImplementPlan.md):
 *  - The catalog is priced in USD; KHR is *derived* from USD via a single
 *    configured exchange rate (`USD_KHR_RATE`) for both display and the KHQR
 *    amount. KHR is rounded to whole riel — no decimals.
 *  - USD shows two decimal places; KHR shows whole riel with the `៛` symbol.
 *  - CLARIFY-03: the rate *value* is supplied per-environment later, so the
 *    build proceeds against a placeholder until then.
 *  - English-first v1 → `en-US` grouping for both currencies.
 *
 * Mirrors the backend's `src/lib/settings.ts` (`usdToKhr`, placeholder 4100) so
 * a storefront-rendered KHR price matches the KHQR amount the backend generates.
 *
 * Amounts are major units (e.g. `29` = $29.00), matching Medusa v2's
 * `calculated_amount` (see `util/money.ts` / `util/get-product-price.ts`).
 */

/** Display currency, driven by the nav toggle (FRONTEND-04). */
export type Currency = "USD" | "KHR"

/** Khmer riel sign (U+17DB). Rendered as a prefix, per CLDR's km-KH pattern. */
const RIEL_SYMBOL = "៛"

/**
 * Placeholder USD→KHR rate used until the real value is provided (CLARIFY-03).
 * Matches the backend default so display and KHQR stay consistent in dev.
 * NOT authoritative — set `USD_KHR_RATE` (or `NEXT_PUBLIC_USD_KHR_RATE`) per env.
 */
const PLACEHOLDER_USD_KHR_RATE = 4100

/** Options accepted by the formatters. */
interface FormatOptions {
  /**
   * Override the USD→KHR rate. When omitted the rate is read from the
   * environment (see `getUsdKhrRate`). Lets a server component inject an
   * authoritative rate without depending on a client-exposed env var.
   */
  usdKhrRate?: number
}

/**
 * Parse a rate from the environment as a positive finite number.
 *
 * Reads `NEXT_PUBLIC_USD_KHR_RATE` first so the value is available during
 * client-side currency toggling, then falls back to `USD_KHR_RATE` for
 * server-only contexts (SSR / route handlers). Returns `undefined` when unset,
 * empty, or not a valid positive number.
 */
function readEnvRate(): number | undefined {
  const raw = process.env.NEXT_PUBLIC_USD_KHR_RATE ?? process.env.USD_KHR_RATE

  if (raw === undefined || raw.trim() === "") {
    return undefined
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return parsed
}

/** USD→KHR exchange rate (riel per 1 USD), falling back to the placeholder. */
export function getUsdKhrRate(): number {
  return readEnvRate() ?? PLACEHOLDER_USD_KHR_RATE
}

/**
 * Convert a USD amount to KHR, rounded to whole riel (no decimals).
 * `usdToKhr(1)` returns the configured rate, rounded — mirrors the backend.
 */
export function usdToKhr(usd: number, rate: number = getUsdKhrRate()): number {
  return Math.round(usd * rate)
}

/** Format a USD amount as `$29.00` — symbol prefix, exactly two decimals. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Format a whole-riel amount as `៛16,400` — grouped, no decimals, `៛` prefix.
 *
 * The symbol is applied manually rather than via `Intl`'s currency style: ICU
 * data renders KHR as the code `"KHR"` under `en-US`, but the spec requires the
 * `៛` glyph regardless of the runtime's locale data.
 */
export function formatKhr(amountInRiel: number): string {
  const grouped = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Math.round(amountInRiel))

  return `${RIEL_SYMBOL}${grouped}`
}

/**
 * Format a USD-base price in the selected display currency.
 *
 * - `USD` → `$29.00` (two decimals).
 * - `KHR` → `៛118,900` (USD converted via `USD_KHR_RATE`, whole riel).
 *
 * @param amountUsd Price in USD major units (e.g. `29` = $29.00).
 * @param currency  The currency picked by the nav toggle.
 */
export function formatPrice(
  amountUsd: number,
  currency: Currency,
  options: FormatOptions = {}
): string {
  if (currency === "KHR") {
    return formatKhr(usdToKhr(amountUsd, options.usdKhrRate ?? getUsdKhrRate()))
  }

  return formatUsd(amountUsd)
}
