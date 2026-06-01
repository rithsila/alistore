/**
 * GET /store/auth/facebook — BACKEND-05 (Facebook OAuth, start).
 *
 * Begins the optional social-login flow by 302-redirecting the browser to
 * Facebook's OAuth dialog with our `client_id` (FB_APP_ID), the registered
 * `redirect_uri`, the minimal scopes, and a freshly generated `state`. The
 * code-exchange + identity link happens on the callback (BACKEND-05B).
 *
 * No request body / query is trusted: this endpoint takes no client input that
 * influences the redirect. Errors return `{ error, request_id }` only.
 *
 * SECURITY (security.md "Facebook OAuth"):
 *  - `state` is server-generated (256-bit), single-use, session-bound, and
 *    stored in Redis (the Cache module) so the callback can verify it. The
 *    same value is mirrored into a short-lived HttpOnly cookie to bind the
 *    flow to *this* browser — the callback (05B) requires query-state ===
 *    cookie-state AND a live Redis entry, then consumes the entry (single use).
 *    SameSite=Lax (not Strict) is required so the cookie survives Facebook's
 *    top-level redirect back to the callback.
 *  - `redirect_uri` is NEVER derived from the request Host header (host-header
 *    injection / open redirect). It comes from server config and is validated
 *    against hard-coded rules (https except localhost, no userinfo, exact
 *    callback path) — a one-entry allowlist that fails closed on misconfig.
 *  - Scopes are restricted to `email,public_profile`.
 *  - Rate limit 10/min per client IP.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { randomBytes, randomUUID } from "crypto"

/** Graph API version pinned for the OAuth dialog URL. */
const FB_GRAPH_VERSION = "v21.0"

/** Facebook OAuth dialog endpoint (browser-facing authorize URL). */
const FB_OAUTH_DIALOG_URL = `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`

/** Minimal scopes (security.md): email + public_profile only. */
const FB_SCOPES = "email,public_profile"

/**
 * The backend path Facebook redirects back to (BACKEND-05B). The full
 * `redirect_uri` is `<origin>` + this path, where `<origin>` comes from
 * `FB_OAUTH_REDIRECT_URI` (or its dev default) — never the request host.
 */
const CALLBACK_PATH = "/store/auth/facebook/callback"

/**
 * Dev-only default callback. In production `FB_OAUTH_REDIRECT_URI` MUST be set
 * to the exact URL registered in the Facebook app; the local default only keeps
 * the flow working against `npx medusa develop` without extra config.
 */
const DEV_DEFAULT_REDIRECT_URI = `http://localhost:9000${CALLBACK_PATH}`

/** State lifetime: long enough to complete the FB dialog, short by design. */
const STATE_TTL_SECONDS = 600
const STATE_TTL_MS = STATE_TTL_SECONDS * 1000

/** Cookie that binds the OAuth `state` to this browser for callback verify. */
const STATE_COOKIE = "_fb_oauth_state"

/** Rate limit (security.md): 10/min per client IP. */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 10, ttl: 60 } as const

type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
}

/** Redis key holding a live, unconsumed OAuth state (presence = valid). */
function stateKey(state: string): string {
  return `fb:oauth:state:${state}`
}

function getRequestId(req: MedusaRequest): string {
  const header = req.headers["x-request-id"]
  if (typeof header === "string" && header.length > 0) return header
  return randomUUID()
}

/**
 * Resolve the client IP from a *trusted* hop only. `X-Forwarded-For` is
 * attacker-controlled, so it is ignored unless `TRUSTED_PROXY_COUNT` is set to
 * the number of reverse proxies in front of the backend (see the KHQR/COD
 * routes for the full rationale). Default 0 = use the direct socket address.
 */
function getClientIp(req: MedusaRequest): string {
  const socketIp = req.socket?.remoteAddress || req.ip || "unknown"
  const trusted = Math.max(
    0,
    Math.floor(Number(process.env.TRUSTED_PROXY_COUNT) || 0)
  )
  if (trusted === 0) return socketIp

  const fwd = req.headers["x-forwarded-for"]
  const chain = (Array.isArray(fwd) ? fwd.join(",") : fwd ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (chain.length === 0) return socketIp

  const addrs = [socketIp, ...chain.reverse()]
  return addrs[Math.min(trusted, addrs.length - 1)]
}

function fail(
  res: MedusaResponse,
  status: number,
  error: string,
  requestId: string
): void {
  res.status(status).json({ error, request_id: requestId })
}

/** Increment one fixed-window counter; returns true when already over limit. */
async function overLimit(
  cache: CacheModule,
  keyPrefix: string,
  windowMs: number,
  limit: number,
  ttl: number
): Promise<boolean> {
  const bucket = Math.floor(Date.now() / windowMs)
  const key = `${keyPrefix}:${bucket}`
  const current = (await cache.get<number>(key)) ?? 0
  if (current >= limit) return true
  await cache.set(key, current + 1, ttl)
  return false
}

/** Per-IP (10/min) fixed-window rate limit. */
async function isRateLimited(req: MedusaRequest): Promise<boolean> {
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  const ip = getClientIp(req)
  return overLimit(
    cache,
    `rl:fb_auth:ip:${ip}`,
    IP_RATE_LIMIT.windowMs,
    IP_RATE_LIMIT.limit,
    IP_RATE_LIMIT.ttl
  )
}

/**
 * Resolve and validate the server-configured `redirect_uri`. Returns the URL
 * string, or `null` when misconfigured (caller fails closed). Validation is a
 * hard-coded, one-entry allowlist: must parse, must be https (http allowed only
 * for localhost dev), carry no userinfo, and point at the exact callback path.
 */
function resolveRedirectUri(): string | null {
  const configured = process.env.FB_OAUTH_REDIRECT_URI?.trim()
  const candidate =
    configured && configured.length > 0 ? configured : DEV_DEFAULT_REDIRECT_URI

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }

  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1"

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    return null
  }
  if (url.username || url.password) return null
  if (url.pathname !== CALLBACK_PATH) return null

  return url.toString()
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  if (await isRateLimited(req)) {
    return fail(res, 429, "rate_limited", requestId)
  }

  const clientId = process.env.FB_APP_ID?.trim()
  if (!clientId) {
    // Optional feature: cleanly unavailable rather than a broken redirect.
    logger.warn(
      `[auth/facebook] FB_APP_ID not configured (request_id=${requestId})`
    )
    return fail(res, 503, "facebook_login_unavailable", requestId)
  }

  const redirectUri = resolveRedirectUri()
  if (!redirectUri) {
    logger.error(
      `[auth/facebook] FB_OAUTH_REDIRECT_URI failed validation (request_id=${requestId})`
    )
    return fail(res, 500, "facebook_login_misconfigured", requestId)
  }

  // Server-generated, single-use state (≥128-bit). Stored in Redis (presence =
  // valid) and mirrored into a session cookie so 05B can bind + verify.
  const state = randomBytes(32).toString("base64url")
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule
  await cache.set(stateKey(state), { issued_at: Date.now() }, STATE_TTL_SECONDS)

  // SameSite=Lax so the cookie survives Facebook's top-level redirect back to
  // the callback; Secure off only for the localhost dev default (http).
  const secureCookie = !redirectUri.startsWith("http://localhost")
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    maxAge: STATE_TTL_MS,
    path: CALLBACK_PATH,
  })

  const authorizeUrl = new URL(FB_OAUTH_DIALOG_URL)
  authorizeUrl.searchParams.set("client_id", clientId)
  authorizeUrl.searchParams.set("redirect_uri", redirectUri)
  authorizeUrl.searchParams.set("state", state)
  authorizeUrl.searchParams.set("scope", FB_SCOPES)
  authorizeUrl.searchParams.set("response_type", "code")

  res.redirect(302, authorizeUrl.toString())
}
