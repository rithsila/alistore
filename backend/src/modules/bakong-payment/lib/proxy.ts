/**
 * Bakong proxy client — BACKEND-03 (deeplink lookup only).
 *
 * All Bakong traffic MUST route through the in-Cambodia HTTP proxy
 * (`BAKONG_PROXY_URL`) — never call Bakong directly, never from the client
 * (security.md "Payments" + "SSRF"). For the "start" flow the only outbound
 * call is the deeplink lookup; payment verification (status/md5) is BACKEND-03B.
 *
 * SSRF guard (security.md "SSRF (Bakong proxy URL)"): the generic policy
 * (https-only, no credentials, host allowlist, no private/loopback resolution
 * re-checked at call time, no redirects) lives in `src/lib/proxy-guard.ts`
 * (shared with the ABA PayWay client since PAYWAY-01). This module keeps its
 * original exported API — `assertSafeProxyUrl` / `UnsafeProxyUrlError` — as a
 * Bakong-labeled wrapper so existing consumers (medusa-config boot check, the
 * khqr routes' instanceof checks) are unaffected.
 *
 * SECURITY: never log the QR string, token, `reference`, or response bodies.
 */

import {
  assertResolvesPublicAddress,
  assertSafeOutboundUrl,
  joinUrl,
  UnsafeOutboundUrlError,
} from "../../../lib/proxy-guard"

/** Bakong Open API path (mirrored by the proxy) for deeplink generation. */
const DEEPLINK_PATH = "generate_deeplink_by_qr"

/** Bakong Open API path (mirrored by the proxy) for transaction verification. */
const CHECK_MD5_PATH = "check_transaction_by_md5"

/** Default network timeout for the proxy call. */
const DEFAULT_TIMEOUT_MS = 8000

/** Env-var label used in all Bakong SSRF error messages. */
const ENV_LABEL = "BAKONG_PROXY_URL"

/** Raised when the proxy/Bakong is unreachable or returns an error → maps to 502. */
export class BakongProxyError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = "BakongProxyError"
  }
}

/** Raised when the proxy URL fails SSRF validation → misconfiguration, not 502. */
export class UnsafeProxyUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeProxyUrlError"
  }
}

export interface DeeplinkSourceInfo {
  appName: string
  appIconUrl?: string
  appDeepLinkCallback?: string
}

export interface GenerateDeeplinkOptions {
  /** Proxy base URL that mirrors the Bakong API (BAKONG_PROXY_URL). */
  proxyBaseUrl: string
  /** Bakong bearer token (BAKONG_TOKEN). Never logged. */
  token: string
  /** Full KHQR string to convert into a deeplink. Never logged. */
  qr: string
  /** App metadata Bakong embeds in the deeplink. */
  sourceInfo: DeeplinkSourceInfo
  /** Allowlisted proxy hosts; when non-empty the host must be a member. */
  allowedHosts?: string[]
  /** Network timeout (ms). */
  timeoutMs?: number
}

/**
 * Dev-only escape hatch (TEST-04): allow a plain-http LOOPBACK mock proxy so
 * the KHQR paid flip can be simulated end-to-end against the dev stack
 * (storefront/tests/khqr.spec.ts hosts the mock). Two explicit gates — the
 * process must NOT be production AND `BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1` must
 * be set — and the relaxation applies to loopback targets only. Every other
 * SSRF rule stays enforced. Inert in production.
 */
function devLoopbackEscapeActive(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.BAKONG_PROXY_DEV_ALLOW_LOOPBACK === "1"
  )
}

/**
 * Validate the proxy URL shape (https, no creds, allowlisted host). Throws
 * `UnsafeProxyUrlError` on any violation. Does not perform DNS resolution.
 */
export function assertSafeProxyUrl(rawUrl: string, allowedHosts?: string[]): URL {
  try {
    return assertSafeOutboundUrl(rawUrl, {
      label: ENV_LABEL,
      allowedHosts,
      devLoopbackActive: devLoopbackEscapeActive(),
    })
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      throw new UnsafeProxyUrlError(
        err.message.replace(
          `${ENV_LABEL} requires a host allowlist in production (SSRF allowlist required)`,
          "BAKONG_PROXY_ALLOWED_HOSTS must be set in production (SSRF allowlist required)"
        )
      )
    }
    throw err
  }
}

/**
 * Re-check at call time that the host resolves only to public addresses
 * (defends against DNS rebinding). Throws `UnsafeProxyUrlError` otherwise.
 */
async function assertResolvesPublic(hostname: string): Promise<void> {
  try {
    await assertResolvesPublicAddress(hostname, {
      label: ENV_LABEL,
      devLoopbackActive: devLoopbackEscapeActive(),
    })
  } catch (err) {
    if (err instanceof UnsafeOutboundUrlError) {
      throw new UnsafeProxyUrlError(err.message)
    }
    throw err
  }
}

/**
 * Ask the proxy (→ Bakong) to turn a KHQR string into a short deeplink.
 * Returns the deeplink URL, or throws `BakongProxyError` (→ 502) on failure.
 */
export async function generateDeeplink(
  options: GenerateDeeplinkOptions
): Promise<string> {
  const url = assertSafeProxyUrl(options.proxyBaseUrl, options.allowedHosts)
  await assertResolvesPublic(url.hostname)

  const endpoint = joinUrl(url, DEEPLINK_PATH)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual", // never follow redirects (SSRF)
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({
        qr: options.qr,
        sourceInfo: options.sourceInfo,
      }),
    })
  } catch (cause) {
    // Network error / timeout — do not leak the QR or token in the message.
    throw new BakongProxyError("Bakong proxy request failed", cause)
  }

  // Reject any redirect response outright.
  if (response.status >= 300 && response.status < 400) {
    throw new BakongProxyError("Bakong proxy returned an unexpected redirect")
  }
  if (!response.ok) {
    throw new BakongProxyError(`Bakong proxy returned status ${response.status}`)
  }

  let payload: { data?: { shortLink?: string; deeplink?: string } }
  try {
    payload = (await response.json()) as typeof payload
  } catch (cause) {
    throw new BakongProxyError("Bakong proxy returned an unreadable body", cause)
  }

  const deeplink = payload.data?.shortLink ?? payload.data?.deeplink
  if (!deeplink) {
    throw new BakongProxyError("Bakong proxy response had no deeplink")
  }
  return deeplink
}

export interface CheckTransactionOptions {
  /** Proxy base URL that mirrors the Bakong API (BAKONG_PROXY_URL). */
  proxyBaseUrl: string
  /** Bakong bearer token (BAKONG_TOKEN). Never logged. */
  token: string
  /** md5 reference of the KHQR (status-check key). SENSITIVE — never logged. */
  reference: string
  /** Allowlisted proxy hosts; when non-empty the host must be a member. */
  allowedHosts?: string[]
  /** Network timeout (ms). */
  timeoutMs?: number
}

/**
 * Verify a KHQR payment by its md5 `reference` via the in-Cambodia proxy
 * (BACKEND-03B). Returns `true` ONLY when Bakong confirms the transaction
 * exists — this server-side check is the sole source of truth for "paid"
 * (security.md "Payments": never trust a client-reported status).
 *
 * Reuses the same SSRF guards as `generateDeeplink` (https-only, allowlisted
 * host, no private/loopback resolution re-checked at call time, no redirects).
 * Throws `BakongProxyError` (→ 502) on network/HTTP failure, or
 * `UnsafeProxyUrlError` on SSRF validation failure.
 *
 * SECURITY: the `reference`, token, and response body are sensitive and MUST
 * NOT be logged.
 */
export async function checkTransactionByMd5(
  options: CheckTransactionOptions
): Promise<boolean> {
  const url = assertSafeProxyUrl(options.proxyBaseUrl, options.allowedHosts)
  await assertResolvesPublic(url.hostname)

  const endpoint = joinUrl(url, CHECK_MD5_PATH)

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "manual", // never follow redirects (SSRF)
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ md5: options.reference }),
    })
  } catch (cause) {
    // Network error / timeout — do not leak the reference or token.
    throw new BakongProxyError("Bakong proxy verify request failed", cause)
  }

  // Reject any redirect response outright.
  if (response.status >= 300 && response.status < 400) {
    throw new BakongProxyError("Bakong proxy returned an unexpected redirect")
  }
  if (!response.ok) {
    throw new BakongProxyError(`Bakong proxy returned status ${response.status}`)
  }

  let payload: { responseCode?: number; data?: unknown }
  try {
    payload = (await response.json()) as typeof payload
  } catch (cause) {
    throw new BakongProxyError("Bakong proxy returned an unreadable body", cause)
  }

  // Bakong returns responseCode 0 with a transaction payload once the QR has
  // been paid; any non-zero code (e.g. 1 "transaction not found") = pending.
  return payload.responseCode === 0 && payload.data != null
}
