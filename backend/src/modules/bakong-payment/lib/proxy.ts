/**
 * Bakong proxy client — BACKEND-03 (deeplink lookup only).
 *
 * All Bakong traffic MUST route through the in-Cambodia HTTP proxy
 * (`BAKONG_PROXY_URL`) — never call Bakong directly, never from the client
 * (security.md "Payments" + "SSRF"). For the "start" flow the only outbound
 * call is the deeplink lookup; payment verification (status/md5) is BACKEND-03B.
 *
 * SSRF guard (security.md "SSRF (Bakong proxy URL)"):
 *  - the proxy URL comes from env only, never from request input;
 *  - must be `https://`, no embedded credentials;
 *  - host must be on the configured allowlist (when one is set);
 *  - the host must not resolve to a private/loopback/link-local address,
 *    re-checked at call time;
 *  - redirects are rejected (no 3xx following).
 *
 * SECURITY: never log the QR string, token, `reference`, or response bodies.
 */

import { lookup } from "dns/promises"
import { isIP } from "net"

/** Bakong Open API path (mirrored by the proxy) for deeplink generation. */
const DEEPLINK_PATH = "generate_deeplink_by_qr"

/** Bakong Open API path (mirrored by the proxy) for transaction verification. */
const CHECK_MD5_PATH = "check_transaction_by_md5"

/** Default network timeout for the proxy call. */
const DEFAULT_TIMEOUT_MS = 8000

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

/** True for IPv4/IPv6 addresses that must never be reachable via the proxy. */
function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b] = address.split(".").map(Number)
    if (a === 10) return true
    if (a === 127) return true // loopback
    if (a === 0) return true
    if (a === 169 && b === 254) return true // link-local
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  if (family === 6) {
    const ip = address.toLowerCase()
    if (ip === "::1" || ip === "::") return true // loopback / unspecified
    if (ip.startsWith("fe80")) return true // link-local
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true // unique-local
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4 address.
    const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1])
    return false
  }
  return false
}

/**
 * Validate the proxy URL shape (https, no creds, allowlisted host). Throws
 * `UnsafeProxyUrlError` on any violation. Does not perform DNS resolution.
 */
export function assertSafeProxyUrl(rawUrl: string, allowedHosts?: string[]): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeProxyUrlError("BAKONG_PROXY_URL is not a valid URL")
  }

  if (url.protocol !== "https:") {
    throw new UnsafeProxyUrlError("BAKONG_PROXY_URL must use https")
  }
  if (url.username || url.password) {
    throw new UnsafeProxyUrlError("BAKONG_PROXY_URL must not embed credentials")
  }

  // In production the SSRF allowlist is mandatory (security.md: "host on
  // hard-coded allowlist"). Without it, any public https host would be allowed.
  if (
    process.env.NODE_ENV === "production" &&
    (!allowedHosts || allowedHosts.length === 0)
  ) {
    throw new UnsafeProxyUrlError(
      "BAKONG_PROXY_ALLOWED_HOSTS must be set in production (SSRF allowlist required)"
    )
  }

  const host = url.hostname.toLowerCase()
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    throw new UnsafeProxyUrlError("BAKONG_PROXY_URL host is not allowlisted")
  }

  // A literal private IP in the URL is rejected outright.
  if (isIP(host) && isPrivateAddress(host)) {
    throw new UnsafeProxyUrlError("BAKONG_PROXY_URL must not target a private IP")
  }

  return url
}

/**
 * Re-check at call time that the host resolves only to public addresses
 * (defends against DNS rebinding). Throws `UnsafeProxyUrlError` otherwise.
 */
async function assertResolvesPublic(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    return // already validated as a non-private literal in assertSafeProxyUrl
  }
  let records: { address: string }[]
  try {
    records = await lookup(hostname, { all: true })
  } catch {
    throw new UnsafeProxyUrlError("Cannot resolve BAKONG_PROXY_URL host")
  }
  if (records.length === 0) {
    throw new UnsafeProxyUrlError("BAKONG_PROXY_URL host resolved to no address")
  }
  for (const { address } of records) {
    if (isPrivateAddress(address)) {
      throw new UnsafeProxyUrlError(
        "BAKONG_PROXY_URL host resolves to a private address"
      )
    }
  }
}

function joinUrl(base: URL, path: string): string {
  const trimmed = base.href.endsWith("/") ? base.href : `${base.href}/`
  return new URL(path, trimmed).href
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
