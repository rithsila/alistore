/**
 * App settings — BACKEND-01.
 *
 * Exposes the business config the rest of the backend reads from env:
 * USD→KHR exchange rate, low-stock threshold, delivery fee, and the
 * free-delivery threshold. All four are sourced from environment variables
 * (never hardcoded secrets); each falls back to a documented default so the
 * app boots before the real values are supplied.
 *
 * Locked decisions (ImplementPlan.md):
 *  - CLARIFY-03 — exchange rate via `USD_KHR_RATE`; rate *value* provided
 *    later, so the default below is an explicit placeholder.
 *  - CLARIFY-04 — delivery fee $1.50 (`DELIVERY_FEE`), free delivery when
 *    subtotal ≥ $50 (`FREE_DELIVERY_THRESHOLD`). USD is the base; KHR is
 *    derived via the exchange rate.
 *
 * Monetary values (fee, thresholds) are USD and stored as-is (e.g. 1.5 = $1.50);
 * KHR amounts round to whole riel — no decimals.
 */

/** Default low-stock threshold when `LOW_STOCK_THRESHOLD` is unset. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5

/** Default flat delivery fee in USD (CLARIFY-04: $1.50). */
const DEFAULT_DELIVERY_FEE = 1.5

/** Default free-delivery subtotal threshold in USD (CLARIFY-04: $50). */
const DEFAULT_FREE_DELIVERY_THRESHOLD = 50

/**
 * Placeholder USD→KHR rate used until the real value is provided (CLARIFY-03).
 * NOT an authoritative rate — set `USD_KHR_RATE` per environment.
 */
const PLACEHOLDER_USD_KHR_RATE = 4100

export interface AppSettings {
  /** USD→KHR exchange rate (riel per 1 USD). */
  usdKhrRate: number
  /** Stock level at or below which a variant counts as low stock. */
  lowStockThreshold: number
  /** Flat delivery fee in USD. */
  deliveryFee: number
  /** Order subtotal (USD) at or above which delivery is free. */
  freeDeliveryThreshold: number
}

/**
 * Parse an env var as a non-negative finite number, falling back to `fallback`
 * when the variable is unset, empty, or not a valid number.
 */
function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

/** Read all app settings from the environment with documented fallbacks. */
export function getSettings(): AppSettings {
  return {
    usdKhrRate: readNumber(process.env.USD_KHR_RATE, PLACEHOLDER_USD_KHR_RATE),
    lowStockThreshold: readNumber(
      process.env.LOW_STOCK_THRESHOLD,
      DEFAULT_LOW_STOCK_THRESHOLD
    ),
    deliveryFee: readNumber(process.env.DELIVERY_FEE, DEFAULT_DELIVERY_FEE),
    freeDeliveryThreshold: readNumber(
      process.env.FREE_DELIVERY_THRESHOLD,
      DEFAULT_FREE_DELIVERY_THRESHOLD
    ),
  }
}

/** USD→KHR exchange rate (riel per 1 USD). */
export function getUsdKhrRate(): number {
  return getSettings().usdKhrRate
}

/** Stock level at or below which a variant counts as low stock. */
export function getLowStockThreshold(): number {
  return getSettings().lowStockThreshold
}

/** Flat delivery fee in USD. */
export function getDeliveryFee(): number {
  return getSettings().deliveryFee
}

/** Order subtotal (USD) at or above which delivery is free. */
export function getFreeDeliveryThreshold(): number {
  return getSettings().freeDeliveryThreshold
}

/**
 * Convert a USD amount to KHR, rounded to whole riel (no decimals).
 * `usdToKhr(1)` returns the configured rate, rounded.
 */
export function usdToKhr(usd: number): number {
  return Math.round(usd * getUsdKhrRate())
}
