/**
 * ABA PayWay client — PAYWAY-02 (vendored; no `aba-payway`/`payway-js` npm dep,
 * per the security.md vendoring rule for payment code).
 *
 * Implements the two endpoints the checkout flow needs, per the API contract
 * in `docs/aba-payway-integration-guide.md` §3 (verified against the official
 * docs and proven by `sandbox/aba-payway/`):
 *   - Purchase (KHQR deeplink):  POST /api/payment-gateway/v1/payments/purchase
 *   - Check Transaction v2:      POST /api/payment-gateway/v1/payments/check-transaction-2
 *
 * Authentication is an HMAC on every request:
 *   hash = base64( HMAC-SHA512( concatenated-fields, api_key ) )
 * The purchase hash covers 24 fields in a FIXED order over the EXACT strings
 * sent (`view_type`/`payment_gate` are posted but never hashed); the
 * check-transaction hash is `req_time + merchant_id + tran_id`.
 *
 * Unlike Bakong there is no in-Cambodia proxy: PayWay is a public HTTPS API
 * called directly, SSRF-guarded by the shared `src/lib/proxy-guard.ts` policy
 * with a HARD-CODED host allowlist (sandbox + production) and the same
 * two-gate dev loopback escape (`PAYWAY_DEV_ALLOW_LOOPBACK=1`, non-production)
 * for the local mock gateway on 127.0.0.1.
 *
 * SECURITY: never log the api key, hash inputs (they embed buyer PII), the
 * QR string, or response bodies.
 */

import { createHmac, randomBytes } from "crypto"
import {
  assertResolvesPublicAddress,
  assertSafeOutboundUrl,
  joinUrl,
  UnsafeOutboundUrlError,
} from "../../../lib/proxy-guard"

/** Env-var label used in all PayWay SSRF error messages. */
const ENV_LABEL = "PAYWAY_BASE_URL"

/** Hard-coded SSRF allowlist (security.md): the only legitimate PayWay hosts. */
export const PAYWAY_ALLOWED_HOSTS = [
  "checkout.payway.com.kh",
  "checkout-sandbox.payway.com.kh",
]

/** Default base URL — ABA's sandbox; production overrides via PAYWAY_BASE_URL. */
export const PAYWAY_SANDBOX_BASE_URL = "https://checkout-sandbox.payway.com.kh"

const PURCHASE_PATH = "api/payment-gateway/v1/payments/purchase"
const CHECK_TRANSACTION_PATH =
  "api/payment-gateway/v1/payments/check-transaction-2"

/** Default network timeout for PayWay calls. */
const DEFAULT_TIMEOUT_MS = 8000

/**
 * Purchase hash field order (24 fields). Absent optional fields contribute ""
 * (concatenation identity), so one canonical order serves every request shape.
 */
const PURCHASE_HASH_ORDER = [
  "req_time",
  "merchant_id",
  "tran_id",
  "amount",
  "items",
  "shipping",
  "firstname",
  "lastname",
  "email",
  "phone",
  "type",
  "payment_option",
  "return_url",
  "cancel_url",
  "continue_success_url",
  "return_deeplink",
  "currency",
  "custom_fields",
  "return_params",
  "payout",
  "lifetime",
  "additional_params",
  "google_pay_token",
  "skip_success_page",
] as const

/** Raised when PayWay is unreachable or returns an error → maps to 502. */
export class PayWayError extends Error {
  constructor(
    message: string,
    /** PayWay `status.code` when the gateway answered, else undefined. */
    readonly statusCode?: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = "PayWayError"
  }
}

/** Raised when the base URL fails SSRF validation → misconfiguration, not 502. */
export class UnsafePayWayUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafePayWayUrlError"
  }
}

export type PayWayCurrency = "USD" | "KHR"

/** Merchant credentials + endpoint, resolved from env at call time. */
export interface PayWayConfig {
  baseUrl: string
  merchantId: string
  /** HMAC secret from ABA. Never logged. */
  apiKey: string
  timeoutMs?: number
}

/**
 * Read PayWay config from env. Returns null when the merchant credentials are
 * absent (provider not configured — callers stay pending / fail closed).
 */
export function payWayConfigFromEnv(): PayWayConfig | null {
  const merchantId = process.env.PAYWAY_MERCHANT_ID
  const apiKey = process.env.PAYWAY_API_KEY
  if (!merchantId || !apiKey) {
    return null
  }
  return {
    baseUrl: process.env.PAYWAY_BASE_URL || PAYWAY_SANDBOX_BASE_URL,
    merchantId,
    apiKey,
  }
}

/**
 * Dev-only escape hatch (two gates, mirrors Bakong's): non-production AND
 * `PAYWAY_DEV_ALLOW_LOOPBACK=1` allows a plain-http loopback mock gateway
 * (storefront/tests/payway.spec.ts hosts it on 127.0.0.1:4284). Loopback
 * targets only; inert in production.
 */
export function devLoopbackEscapeActive(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.PAYWAY_DEV_ALLOW_LOOPBACK === "1"
  )
}

/**
 * Validate the PayWay base URL (https, no creds, hard-coded host allowlist;
 * loopback hosts admitted only under the dev escape). Throws
 * `UnsafePayWayUrlError` on violation. Exported for the boot check in
 * `medusa-config.ts`.
 */
export function assertSafePayWayUrl(rawUrl: string): URL {
  const devActive = devLoopbackEscapeActive()
  const allowedHosts = devActive
    ? [...PAYWAY_ALLOWED_HOSTS, "127.0.0.1", "localhost", "::1"]
    : PAYWAY_ALLOWED_HOSTS
  try {
    return assertSafeOutboundUrl(rawUrl, {
      label: ENV_LABEL,
      allowedHosts,
      devLoopbackActive: devActive,
    })
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      throw new UnsafePayWayUrlError(err.message)
    }
    throw err
  }
}

async function assertResolvesPublic(hostname: string): Promise<void> {
  try {
    await assertResolvesPublicAddress(hostname, {
      label: ENV_LABEL,
      devLoopbackActive: devLoopbackEscapeActive(),
    })
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      throw new UnsafePayWayUrlError(err.message)
    }
    throw err
  }
}

/** UTC timestamp in PayWay's `YYYYMMDDHHmmss` format. */
export function reqTime(date: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    String(date.getUTCFullYear()) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds())
  )
}

function hmacBase64(data: string, apiKey: string): string {
  return createHmac("sha512", apiKey).update(data).digest("base64")
}

/** Purchase hash over the canonical 24-field concatenation. */
export function purchaseHash(
  fields: Record<string, string | undefined>,
  apiKey: string
): string {
  const input = PURCHASE_HASH_ORDER.map((k) => fields[k] ?? "").join("")
  return hmacBase64(input, apiKey)
}

/** Check-transaction hash: `req_time + merchant_id + tran_id`. */
export function checkTransactionHash(
  fields: { req_time: string; merchant_id: string; tran_id: string },
  apiKey: string
): string {
  return hmacBase64(
    `${fields.req_time}${fields.merchant_id}${fields.tran_id}`,
    apiKey
  )
}

/**
 * Mint a PayWay transaction id. PayWay caps `tran_id` at 20 chars, so Medusa
 * cart/session ids don't fit — this random 20-hex-char id is OUR idempotency
 * key, mapped back to the cart via the `payway:cart:<tran_id>` cache entry.
 */
export function mintTranId(): string {
  return randomBytes(10).toString("hex") // 20 chars
}

/** Validation shape for minted tran_ids (the storefront `reference`). */
export const TRAN_ID_PATTERN = /^[a-f0-9]{20}$/

export interface CreateKhqrPurchaseParams {
  /** Minted ≤20-char transaction id (see `mintTranId`). */
  tranId: string
  /** EXACT amount string to charge (e.g. "15.00" USD, "60500" KHR). */
  amount: string
  currency: PayWayCurrency
  /** Payment validity in minutes (pinned to the reservation TTL). */
  lifetimeMinutes: number
  /** Display-only line items; base64-encoded into `items`. */
  items?: { name: string; quantity: number; price: number }[]
  /** Optional server-callback URL (pushback). Base64-encoded into return_url. */
  pushbackUrl?: string
  firstname?: string
  phone?: string
}

export interface KhqrPurchaseResult {
  tranId: string
  /** Raw KHQR string for QR rendering. SENSITIVE — never logged. */
  qrString: string
  /** ABA Mobile deeplink. */
  deeplink: string | null
  /** Hosted QR page URL (fallback). */
  checkoutQrUrl: string | null
}

interface PurchaseResponse {
  status?: { code?: string | number; message?: string; tran_id?: string }
  qr_string?: string
  abapay_deeplink?: string
  checkout_qr_url?: string
}

/**
 * Create a KHQR purchase (`payment_option=abapay_khqr_deeplink`). Returns the
 * QR string + deeplink, or throws `PayWayError` (→ 502 / specific handling by
 * `statusCode`) / `UnsafePayWayUrlError` (misconfiguration).
 */
export async function createKhqrPurchase(
  config: PayWayConfig,
  params: CreateKhqrPurchaseParams
): Promise<KhqrPurchaseResult> {
  const url = assertSafePayWayUrl(config.baseUrl)
  await assertResolvesPublic(url.hostname)

  // Hash is computed over the exact strings sent — build them once, send as-is.
  const fields: Record<string, string | undefined> = {
    req_time: reqTime(),
    merchant_id: config.merchantId,
    tran_id: params.tranId,
    amount: params.amount,
    currency: params.currency,
    payment_option: "abapay_khqr_deeplink",
    lifetime: String(params.lifetimeMinutes),
    items: params.items
      ? Buffer.from(JSON.stringify(params.items), "utf8").toString("base64")
      : undefined,
    return_url: params.pushbackUrl
      ? Buffer.from(params.pushbackUrl, "utf8").toString("base64")
      : undefined,
    firstname: params.firstname,
    phone: params.phone,
  }
  fields.hash = purchaseHash(fields, config.apiKey)

  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") {
      form.append(key, value)
    }
  }

  const payload = await postPayWay<PurchaseResponse>(
    joinUrl(url, PURCHASE_PATH),
    form,
    config.timeoutMs
  )

  const code = String(payload.status?.code ?? "")
  if (code !== "00" && code !== "0") {
    // No message/body details are logged or propagated beyond the code.
    throw new PayWayError(`PayWay purchase rejected (code ${code})`, code)
  }
  if (!payload.qr_string) {
    throw new PayWayError("PayWay purchase response had no qr_string")
  }
  return {
    tranId: params.tranId,
    qrString: payload.qr_string,
    deeplink: payload.abapay_deeplink ?? null,
    checkoutQrUrl: payload.checkout_qr_url ?? null,
  }
}

/** PayWay `data.payment_status_code` values (check-transaction-2). */
export const PAYWAY_STATUS_CODE = {
  APPROVED: 0,
  PENDING: 2,
  DECLINED: 3,
  REFUNDED: 4,
  CANCELLED: 7,
} as const

export interface CheckTransactionResult {
  /** True ONLY when PayWay confirms APPROVED — the sole source of "paid". */
  paid: boolean
  paymentStatus: string
  paymentStatusCode: number | null
  /** True when PayWay does not know the tran_id (expired/never created). */
  notFound: boolean
  /** Approval code (informational). */
  apv: string | null
}

interface CheckTransactionResponse {
  status?: { code?: string | number; message?: string }
  data?: {
    payment_status?: string
    payment_status_code?: number
    apv?: string
  } | null
}

/**
 * Verify a purchase server-side (check-transaction-2). This is the ONLY
 * source of truth for "paid" (security.md: never trust client-reported
 * status, never trust the unsigned pushback body).
 */
export async function checkTransaction(
  config: PayWayConfig,
  tranId: string
): Promise<CheckTransactionResult> {
  const url = assertSafePayWayUrl(config.baseUrl)
  await assertResolvesPublic(url.hostname)

  const body: Record<string, string> = {
    req_time: reqTime(),
    merchant_id: config.merchantId,
    tran_id: tranId,
  }
  body.hash = checkTransactionHash(
    { req_time: body.req_time, merchant_id: body.merchant_id, tran_id: tranId },
    config.apiKey
  )

  const payload = await postPayWay<CheckTransactionResponse>(
    joinUrl(url, CHECK_TRANSACTION_PATH),
    JSON.stringify(body),
    config.timeoutMs,
    { "Content-Type": "application/json" }
  )

  const code = String(payload.status?.code ?? "")
  if (code === "6") {
    // Transaction not found — expired before payment or never created.
    return {
      paid: false,
      paymentStatus: "NOT_FOUND",
      paymentStatusCode: null,
      notFound: true,
      apv: null,
    }
  }
  if (code !== "00" && code !== "0") {
    throw new PayWayError(`PayWay check-transaction rejected (code ${code})`, code)
  }

  const data = payload.data ?? undefined
  const statusCode =
    typeof data?.payment_status_code === "number"
      ? data.payment_status_code
      : null
  return {
    paid: statusCode === PAYWAY_STATUS_CODE.APPROVED,
    paymentStatus: data?.payment_status ?? "UNKNOWN",
    paymentStatusCode: statusCode,
    notFound: false,
    apv: data?.apv ?? null,
  }
}

/** Shared POST with SSRF-safe transport rules (no redirects, timeout). */
async function postPayWay<T>(
  endpoint: string,
  body: FormData | string,
  timeoutMs?: number,
  headers?: Record<string, string>
): Promise<T> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual", // never follow redirects (SSRF)
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers,
      body,
    })
  } catch (cause) {
    // Network error / timeout — never leak hash inputs or credentials.
    throw new PayWayError("PayWay request failed", undefined, cause)
  }

  if (response.status >= 300 && response.status < 400) {
    throw new PayWayError("PayWay returned an unexpected redirect")
  }
  if (!response.ok) {
    throw new PayWayError(`PayWay returned status ${response.status}`)
  }

  try {
    return (await response.json()) as T
  } catch (cause) {
    throw new PayWayError("PayWay returned an unreadable body", undefined, cause)
  }
}
