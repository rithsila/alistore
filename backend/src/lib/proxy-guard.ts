/**
 * Shared SSRF guard for ALL outbound payment-gateway HTTP targets (PAYWAY-01).
 *
 * Extracted verbatim from `modules/bakong-payment/lib/proxy.ts` so the Bakong
 * proxy client and the ABA PayWay client enforce one identical policy
 * (security.md "SSRF"):
 *  - target URL comes from env only, never from request input;
 *  - must be `https://`, no embedded credentials;
 *  - host must be on the configured allowlist (mandatory in production);
 *  - the host must not resolve to a private/loopback/link-local address,
 *    re-checked at call time (DNS-rebinding defense);
 *  - redirects are rejected by the callers (no 3xx following).
 *
 * The dev-only loopback escape is a CALLER decision: each consumer computes
 * its own flag (e.g. `BAKONG_PROXY_DEV_ALLOW_LOOPBACK=1`,
 * `PAYWAY_DEV_ALLOW_LOOPBACK=1`) gated on `NODE_ENV !== "production"` and
 * passes it as `devLoopbackActive`. The relaxation only ever applies to
 * loopback targets; every other rule stays enforced.
 */

import { lookup } from "dns/promises"
import { isIP } from "net"

/** Raised when an outbound URL fails SSRF validation → misconfiguration, not 502. */
export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeOutboundUrlError"
  }
}

export interface OutboundUrlGuardOptions {
  /** Env-var name used in error messages (e.g. "PAYWAY_BASE_URL"). */
  label: string
  /** Allowlisted hosts; when non-empty the host must be a member. */
  allowedHosts?: string[]
  /**
   * Dev-only loopback escape (two-gate pattern): the caller must verify
   * `NODE_ENV !== "production"` AND its own explicit env flag before passing
   * `true`. Only relaxes https + private-IP rules for LOOPBACK targets.
   */
  devLoopbackActive?: boolean
}

/** True for IPv4/IPv6 addresses that must never be reachable outbound. */
export function isPrivateAddress(address: string): boolean {
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

/** Loopback hosts the dev escape may target (the ONLY relaxation it grants). */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === "localhost") return true
  const family = isIP(host)
  if (family === 4) return host.startsWith("127.")
  if (family === 6) return host === "::1"
  return false
}

/** Loopback addresses (IPv4 127/8, `::1`, and the IPv4-mapped form). */
export function isLoopbackAddress(address: string): boolean {
  if (isIP(address) === 4) return address.startsWith("127.")
  const ip = address.toLowerCase()
  return ip === "::1" || /^::ffff:127\./.test(ip)
}

/**
 * Validate an outbound URL's shape (https, no creds, allowlisted host).
 * Throws `UnsafeOutboundUrlError` on any violation. No DNS resolution here.
 */
export function assertSafeOutboundUrl(
  rawUrl: string,
  options: OutboundUrlGuardOptions
): URL {
  const { label, allowedHosts } = options

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeOutboundUrlError(`${label} is not a valid URL`)
  }

  // Dev-only loopback escape — loopback targets may use plain http and skip
  // the private-IP rejection; nothing else changes.
  const devLoopback =
    options.devLoopbackActive === true && isLoopbackHost(url.hostname)

  if (url.protocol !== "https:" && !(devLoopback && url.protocol === "http:")) {
    throw new UnsafeOutboundUrlError(`${label} must use https`)
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError(`${label} must not embed credentials`)
  }

  // In production the SSRF allowlist is mandatory (security.md: "host on
  // hard-coded allowlist"). Without it, any public https host would be allowed.
  if (
    process.env.NODE_ENV === "production" &&
    (!allowedHosts || allowedHosts.length === 0)
  ) {
    throw new UnsafeOutboundUrlError(
      `${label} requires a host allowlist in production (SSRF allowlist required)`
    )
  }

  const host = url.hostname.toLowerCase()
  if (allowedHosts && allowedHosts.length > 0 && !allowedHosts.includes(host)) {
    throw new UnsafeOutboundUrlError(`${label} host is not allowlisted`)
  }

  // A literal private IP in the URL is rejected outright (loopback excepted
  // under the dev escape).
  if (isIP(host) && isPrivateAddress(host) && !devLoopback) {
    throw new UnsafeOutboundUrlError(`${label} must not target a private IP`)
  }

  return url
}

/**
 * Re-check at call time that the host resolves only to public addresses
 * (defends against DNS rebinding). Throws `UnsafeOutboundUrlError` otherwise.
 */
export async function assertResolvesPublicAddress(
  hostname: string,
  options: Pick<OutboundUrlGuardOptions, "label" | "devLoopbackActive">
): Promise<void> {
  const { label } = options
  if (isIP(hostname)) {
    return // already validated as a non-private literal in assertSafeOutboundUrl
  }
  // Dev escape: only a loopback HOSTNAME (i.e. `localhost`) may resolve to a
  // loopback address — a public-looking name resolving to 127.x stays rejected
  // even in dev (rebinding defense intact).
  const allowLoopback =
    options.devLoopbackActive === true && isLoopbackHost(hostname)
  let records: { address: string }[]
  try {
    records = await lookup(hostname, { all: true })
  } catch {
    throw new UnsafeOutboundUrlError(`Cannot resolve ${label} host`)
  }
  if (records.length === 0) {
    throw new UnsafeOutboundUrlError(`${label} host resolved to no address`)
  }
  for (const { address } of records) {
    if (allowLoopback && isLoopbackAddress(address)) {
      continue
    }
    if (isPrivateAddress(address)) {
      throw new UnsafeOutboundUrlError(`${label} host resolves to a private address`)
    }
  }
}

/** Join a validated base URL and a relative path without double slashes. */
export function joinUrl(base: URL, path: string): string {
  const trimmed = base.href.endsWith("/") ? base.href : `${base.href}/`
  return new URL(path, trimmed).href
}
