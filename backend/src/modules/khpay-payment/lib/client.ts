/**
 * KHPAY client — KHPAY-01 (vendored; no npm SDK, per the security.md vendoring
 * rule for payment code).
 *
 * KHPAY (https://khpay.site) is a Cambodian payment aggregator. This client
 * implements only the **Bakong KHQR rail** (locked decision: money settles
 * directly to our own Bakong account, configured once in the KHPAY dashboard):
 *   - Generate KHQR:  POST {base}/bakong/generate
 *   - Check payment:  POST {base}/bakong/check
 *
 * Authentication is a bearer key on every request:
 *   Authorization: Bearer ${KHPAY_API_KEY}
 *
 * Confirmation is polling-only (locked decision): the status route calls
 * `checkBakongPayment` server-side; webhooks/callback_url are not used, so no
 * public callback endpoint exists for this provider.
 *
 * KHPAY is a public HTTPS API called directly (like PayWay, unlike the Bakong
 * proxy), SSRF-guarded by the shared `src/lib/proxy-guard.ts` policy with a
 * HARD-CODED host allowlist and the same two-gate dev loopback escape
 * (`KHPAY_DEV_ALLOW_LOOPBACK=1`, non-production) for the local mock gateway.
 *
 * SECURITY: never log the api key, the QR string, transaction ids, or
 * request/response bodies.
 */

import {
  assertResolvesPublicAddress,
  assertSafeOutboundUrl,
  joinUrl,
  UnsafeOutboundUrlError,
} from "../../../lib/proxy-guard"

/** Env-var label used in all KHPAY SSRF error messages. */
const ENV_LABEL = "KHPAY_BASE_URL"

/** Hard-coded SSRF allowlist (security.md): the only legitimate KHPAY host. */
export const KHPAY_ALLOWED_HOSTS = ["khpay.site"]

/** Default base URL — KHPAY's production API (it has no separate sandbox). */
export const KHPAY_DEFAULT_BASE_URL = "https://khpay.site/api/v1"

const GENERATE_PATH = "bakong/generate"
const CHECK_PATH = "bakong/check"

/** Default network timeout for KHPAY calls. */
const DEFAULT_TIMEOUT_MS = 8000

/**
 * KHPAY Bakong transaction id (`bk_…`), the storefront-facing `reference`.
 * Anchored and bounded so malformed input is rejected before any lookup.
 */
export const KHPAY_REFERENCE_PATTERN = /^bk_[A-Za-z0-9]{6,64}$/

/** Raised when KHPAY is unreachable or returns an error → maps to 502. */
export class KhpayError extends Error {
  constructor(
    message: string,
    /** KHPAY machine `code` when the gateway answered, else undefined. */
    readonly code?: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = "KhpayError"
  }
}

/** Raised when the base URL fails SSRF validation → misconfiguration, not 502. */
export class UnsafeKhpayUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeKhpayUrlError"
  }
}

export type KhpayCurrency = "USD" | "KHR"

/** API key + endpoint, resolved from env at call time. */
export interface KhpayConfig {
  baseUrl: string
  /** Bearer key from the KHPAY dashboard. Never logged. */
  apiKey: string
  timeoutMs?: number
}

/**
 * Read KHPAY config from env. Returns null when the API key is absent
 * (provider not configured — callers stay pending / fail closed).
 */
export function khpayConfigFromEnv(): KhpayConfig | null {
  const apiKey = process.env.KHPAY_API_KEY
  if (!apiKey) {
    return null
  }
  return {
    baseUrl: process.env.KHPAY_BASE_URL || KHPAY_DEFAULT_BASE_URL,
    apiKey,
  }
}

/**
 * Dev-only escape hatch (two gates, mirrors Bakong's/PayWay's): non-production
 * AND `KHPAY_DEV_ALLOW_LOOPBACK=1` allows a plain-http loopback mock gateway
 * (storefront/tests/khpay.spec.ts hosts it on 127.0.0.1:4285). Loopback
 * targets only; inert in production.
 */
export function devLoopbackEscapeActive(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.KHPAY_DEV_ALLOW_LOOPBACK === "1"
  )
}

/**
 * Validate the KHPAY base URL (https, no creds, hard-coded host allowlist;
 * loopback hosts admitted only under the dev escape). Throws
 * `UnsafeKhpayUrlError` on violation. Exported for the boot check in
 * `medusa-config.ts`.
 */
export function assertSafeKhpayUrl(rawUrl: string): URL {
  const devActive = devLoopbackEscapeActive()
  const allowedHosts = devActive
    ? [...KHPAY_ALLOWED_HOSTS, "127.0.0.1", "localhost", "::1"]
    : KHPAY_ALLOWED_HOSTS
  try {
    return assertSafeOutboundUrl(rawUrl, {
      label: ENV_LABEL,
      allowedHosts,
      devLoopbackActive: devActive,
    })
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      throw new UnsafeKhpayUrlError(err.message)
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
      throw new UnsafeKhpayUrlError(err.message)
    }
    throw err
  }
}

export interface GenerateBakongQrParams {
  /** EXACT amount to charge: USD with 2dp, KHR whole riel (business rule). */
  amount: number
  currency: KhpayCurrency
  /** Display-only note shown in the payer's banking app. No PII. */
  note?: string
}

export interface BakongQrResult {
  /** KHPAY transaction id (`bk_…`) — the verification/idempotency key. */
  transactionId: string
  /** Raw EMV KHQR string for QR rendering. SENSITIVE — never logged. */
  qr: string
  /** KHQR md5 hash (KHPAY's alternate polling key). */
  md5: string | null
}

/** `{ success, data }` envelope KHPAY wraps responses in (tolerated if flat). */
interface KhpayEnvelope<T> {
  success?: boolean
  error?: string
  /** Docs say `code`; the live gateway sends `error_code` — accept both. */
  code?: string
  error_code?: string
  data?: T | null
}

interface GenerateResponseData {
  transaction_id?: string
  qr?: string
  md5?: string
}

/**
 * Generate a dynamic Bakong KHQR via KHPAY. The Bakong account, merchant name,
 * and city are configured once in the KHPAY dashboard, so the call carries only
 * the amount/currency/note. Throws `KhpayError` (→ 502 / handling by `code`) /
 * `UnsafeKhpayUrlError` (misconfiguration).
 */
export async function generateBakongQr(
  config: KhpayConfig,
  params: GenerateBakongQrParams
): Promise<BakongQrResult> {
  const payload = await postKhpay<GenerateResponseData>(
    config,
    GENERATE_PATH,
    {
      amount: params.amount,
      currency: params.currency,
      ...(params.note ? { note: params.note } : {}),
      // Locked decision (ImplementPlan "Resolved decisions"): Individual KHQR.
      type: "individual",
      // Dynamic per-payment QR — a fixed amount, single use.
      static: false,
    }
  )

  const data = payload.data ?? (payload as GenerateResponseData)
  const transactionId = data.transaction_id
  const qr = data.qr
  if (
    !transactionId ||
    !KHPAY_REFERENCE_PATTERN.test(transactionId) ||
    !qr
  ) {
    throw new KhpayError("KHPAY generate response was missing the QR")
  }
  return {
    transactionId,
    qr,
    md5: typeof data.md5 === "string" && data.md5 ? data.md5 : null,
  }
}

export interface CheckBakongResult {
  /** True ONLY when KHPAY confirms paid — the sole source of "paid". */
  paid: boolean
  /** Normalized: pending | paid | expired | failed | unknown. */
  status: string
  /** True when KHPAY does not know the transaction (expired/never created). */
  notFound: boolean
}

interface CheckResponseData {
  paid?: boolean
  status?: string
}

/**
 * Verify a Bakong payment server-side (POST /bakong/check). This is the ONLY
 * source of truth for "paid" (security.md: never trust client-reported
 * status). Idempotent and side-effect free on KHPAY's side.
 */
export async function checkBakongPayment(
  config: KhpayConfig,
  transactionId: string
): Promise<CheckBakongResult> {
  let payload: KhpayEnvelope<CheckResponseData>
  try {
    payload = await postKhpay<CheckResponseData>(config, CHECK_PATH, {
      transaction_id: transactionId,
    })
  } catch (err) {
    if (err instanceof KhpayError && err.code === "TRANSACTION_NOT_FOUND") {
      return { paid: false, status: "unknown", notFound: true }
    }
    throw err
  }

  const data = payload.data ?? (payload as CheckResponseData)
  const status =
    typeof data.status === "string" ? data.status.toLowerCase() : "unknown"
  return {
    // Belt-and-braces: require the explicit `paid` flag AND/OR the status —
    // either signal alone marks paid only if nothing contradicts it.
    paid: data.paid === true || status === "paid",
    status,
    notFound: false,
  }
}

/** Shared POST with SSRF-safe transport rules (no redirects, timeout). */
async function postKhpay<T>(
  config: KhpayConfig,
  path: string,
  body: Record<string, unknown>
): Promise<KhpayEnvelope<T>> {
  const url = assertSafeKhpayUrl(config.baseUrl)
  await assertResolvesPublic(url.hostname)

  let response: Response
  try {
    response = await fetch(joinUrl(url, path), {
      method: "POST",
      redirect: "manual", // never follow redirects (SSRF)
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    // Network error / timeout — never leak the key or body.
    throw new KhpayError("KHPAY request failed", undefined, cause)
  }

  if (response.status >= 300 && response.status < 400) {
    throw new KhpayError("KHPAY returned an unexpected redirect")
  }

  let payload: KhpayEnvelope<T>
  try {
    payload = (await response.json()) as KhpayEnvelope<T>
  } catch (cause) {
    if (!response.ok) {
      throw new KhpayError(`KHPAY returned status ${response.status}`)
    }
    throw new KhpayError("KHPAY returned an unreadable body", undefined, cause)
  }

  // Error envelope: `{ success: false, error, code|error_code }` — propagate
  // only the machine code (the human message could echo request data).
  if (!response.ok || payload.success === false) {
    const code =
      typeof payload.code === "string"
        ? payload.code
        : typeof payload.error_code === "string"
          ? payload.error_code
          : undefined
    throw new KhpayError(
      `KHPAY rejected the request${code ? ` (${code})` : ""}`,
      code
    )
  }

  return payload
}
