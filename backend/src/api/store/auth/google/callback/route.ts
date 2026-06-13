/**
 * GET /store/auth/google/callback — BACKEND-05D (Google OAuth, callback).
 *
 * Completes the optional Google social login that BACKEND-05C started. Approach
 * (b) (chosen for this task): the route performs the Google code→token exchange
 * and `id_token` verification ITSELF — it does NOT call the built-in provider's
 * `validateCallback` (whose own OAuth-state check is incompatible with our
 * route-owned `state`). The built-in `@medusajs/auth-google` stays registered
 * (BACKEND-05C) but is not exercised here; this route is the CSRF authority.
 *
 * Flow (mirrors the Facebook callback, BACKEND-05B):
 *  1. Verify the OAuth `state` set by 05C — query `state` must equal the HttpOnly
 *     `_google_oauth_state` cookie AND a live Redis entry must exist; the entry
 *     is then consumed (single-use). This is the CSRF authority.
 *  2. Exchange the `code` at Google's token endpoint (hard-coded host) for an
 *     `id_token`, then verify the token's claims.
 *  3. Resolve the customer: a returning Google user (matched by the immutable
 *     `provider_user_id` = the token `sub`) reuses their customer; otherwise a
 *     NEW customer is created and linked. Per security.md (account-link safety —
 *     same rule as 05B) we NEVER auto-link to a pre-existing customer by email —
 *     a fresh customer is created, or 409 on an email collision.
 *  4. Write one `customer_social_identity` row for new links.
 *  5. Establish a real session (`req.session.auth_context` → HttpOnly cookie) and
 *     302-redirect the browser back to `/checkout` (INTEGRATION-06B), where the
 *     storefront reads this session and prefills the form.
 *
 * Any failure returns 401 `{ error, request_id }` (no internal detail leaked).
 *
 * DEV SEAM (TEST-08B): the code-exchange POST resolves through `tokenUrl()`,
 * which is `https://oauth2.googleapis.com/token` everywhere except under the
 * dev-only, loopback-only `GOOGLE_TOKEN_DEV_BASE_URL` escape (see `devTokenUrl`
 * below) used by `storefront/tests/google-login.spec.ts`.
 *
 * SECURITY (security.md): scopes minimal (set in 05C); the code exchange targets
 * a hard-coded Google host (no user-controlled URL → no SSRF) and rejects
 * redirects; `id_token` is read straight from Google's token endpoint over TLS,
 * so its claims (`aud`/`iss`/`exp`/`email_verified`) are validated without a JWKS
 * round-trip (OIDC §3.1.3.7); never log the code, tokens, email, or other PII;
 * rate-limited 10/min per client IP.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { overLimitAtomic } from "../../../../../lib/rate-limit"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"
import { randomUUID } from "crypto"
import jwt from "jsonwebtoken"
import { z } from "zod"
import { SOCIAL_IDENTITY_MODULE } from "../../../../../modules/social-identity"

/** The OAuth provider id registered under the Auth Module (medusa-config.ts). */
const GOOGLE_PROVIDER_ID = "google"

/** Google's OAuth 2.0 token endpoint (hard-coded host — not user-controlled). */
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"

/**
 * Dev-only mock token-endpoint escape (TEST-08B — mirrors the TEST-08
 * `FB_GRAPH_DEV_BASE_URL` seam in `auth-facebook/service.ts` and the Bakong
 * `BAKONG_PROXY_DEV_ALLOW_LOOPBACK` seam): when the process is NOT production
 * AND `GOOGLE_TOKEN_DEV_BASE_URL` targets a LOOPBACK host (localhost,
 * 127.0.0.0/8, ::1), the code exchange POSTs to `<base>/token` instead of
 * Google's token endpoint — so `storefront/tests/google-login.spec.ts` can mint
 * the `id_token` and drive the full callback chain (state verify → exchange →
 * claims verify → identity → session) without real Google credentials.
 * Loopback-only by construction (a non-loopback value is ignored, so this can
 * never redirect real traffic off-box) and inert in production:
 * `NODE_ENV=production` disables it regardless of the value. The claims-only
 * id_token verification (`verifyGoogleIdToken`) is unchanged — in dev the
 * TLS-channel assumption is consciously replaced by the loopback boundary.
 */
function devTokenUrl(): string | null {
  if (process.env.NODE_ENV === "production") return null
  const raw = process.env.GOOGLE_TOKEN_DEV_BASE_URL?.trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null

  const host = url.hostname.toLowerCase()
  // WHATWG URL keeps the brackets on IPv6 hostnames (`[::1]`); the bare `::1`
  // form is kept as defense-in-depth should that normalization ever change.
  const isLoopback =
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  if (!isLoopback) return null

  return new URL("/token", url.origin).toString()
}

/** Token endpoint for the code exchange: the dev mock when active, else real. */
function tokenUrl(): string {
  return devTokenUrl() ?? GOOGLE_TOKEN_URL
}

/** Accepted `iss` values for a Google-issued id_token. */
const GOOGLE_ISSUERS = new Set([
  "accounts.google.com",
  "https://accounts.google.com",
])

/** Cookie BACKEND-05C set to bind the OAuth `state` to this browser. */
const STATE_COOKIE = "_google_oauth_state"

/** Path the state cookie was scoped to (must match BACKEND-05C). */
const CALLBACK_PATH = "/store/auth/google/callback"

/** Dev-only default callback (must match BACKEND-05C's start route). */
const DEV_DEFAULT_REDIRECT_URI = `http://localhost:9000${CALLBACK_PATH}`

/**
 * Post-login return paths (BACKEND-11; mirrors the Facebook callback). The start
 * route (BACKEND-05C) stored a `return_to` in the single-use state entry,
 * resolved from an optional `?intent=` against this same hard-coded allowlist.
 * The callback re-validates the stored value here (defense in depth) before
 * using it as the terminal redirect — an absent/unrecognized value falls back to
 * `/checkout`, the unchanged default. Relative + hard-coded (security.md:
 * redirect targets come from a hard-coded allowlist, never echoed client input —
 * no `?next=`/`?return_to=`). Through the storefront's `/store/auth/*` proxy each
 * resolves to `<storefront-origin>` + the path, where `@lib/auth` reads this
 * session.
 */
const RETURN_PATHS = { checkout: "/checkout", account: "/account" } as const
const DEFAULT_RETURN_PATH = RETURN_PATHS.checkout
const ALLOWED_RETURN_PATHS: ReadonlySet<string> = new Set(
  Object.values(RETURN_PATHS)
)

/** Re-validate the state-stored return path against the hard-coded allowlist. */
function resolveReturnPath(stored: unknown): string {
  return typeof stored === "string" && ALLOWED_RETURN_PATHS.has(stored)
    ? stored
    : DEFAULT_RETURN_PATH
}

/** Redis key prefix BACKEND-05C stored the live `state` under. */
function stateKey(state: string): string {
  return `google:oauth:state:${state}`
}

/** Rate limit (security.md): 10/min per client IP. */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 10, ttl: 60 } as const

/** Validated OAuth callback query (zod — security.md: validate every input). */
const CallbackQuery = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(512),
})

type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
}

/** Minimal shape of the Google id_token payload claims we rely on. */
interface GoogleIdTokenPayload {
  iss?: string
  aud?: string
  exp?: number
  sub?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  given_name?: string
  family_name?: string
  picture?: string
}

interface ProviderIdentityRecord {
  provider: string
  entity_id: string
  user_metadata?: Record<string, unknown> | null
}

interface AuthIdentityRecord {
  id: string
  provider_identities?: ProviderIdentityRecord[]
  app_metadata?: Record<string, unknown> | null
}

type AuthModuleService = {
  listAuthIdentities(
    filters: Record<string, unknown>
  ): Promise<AuthIdentityRecord[]>
  createAuthIdentities(
    data: Record<string, unknown>
  ): Promise<AuthIdentityRecord>
}

function getRequestId(req: MedusaRequest): string {
  const header = req.headers["x-request-id"]
  if (typeof header === "string" && header.length > 0) return header
  return randomUUID()
}

/**
 * Resolve the client IP from a *trusted* hop only (see the KHQR/COD routes for
 * the full rationale). Default `TRUSTED_PROXY_COUNT=0` = direct socket address.
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

/** Read one cookie value from the raw Cookie header (no parser dependency). */
function readCookie(req: MedusaRequest, name: string): string | undefined {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return undefined
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
  _cache: CacheModule,
  keyPrefix: string,
  windowMs: number,
  limit: number,
  ttl: number
): Promise<boolean> {
  // C-02 fix: atomic fixed-window counter (Redis INCR in prod, race-free
  // in-process fallback in dev). `_cache` is retained for call-site
  // compatibility but no longer used. See src/lib/rate-limit.ts.
  return overLimitAtomic(keyPrefix, windowMs, limit, ttl)
}

/**
 * Resolve the server-configured `redirect_uri` (must match BACKEND-05C exactly,
 * since Google requires the token-exchange `redirect_uri` to equal the one sent
 * in the authorize request). Same hard-coded one-entry allowlist as 05C.
 */
function resolveRedirectUri(): string | null {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
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

/**
 * Exchange the authorization `code` for tokens at Google's token endpoint.
 * Secrets travel in the POST body (never the URL); redirects are rejected.
 * Returns the raw `id_token`, or null on any failure. Bodies are never logged.
 */
async function exchangeCodeForIdToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })

  let response: Response
  try {
    response = await fetch(tokenUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error",
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return null
  }
  const idToken = (json as { id_token?: unknown })?.id_token
  return typeof idToken === "string" && idToken.length > 0 ? idToken : null
}

/**
 * Decode and validate the Google id_token claims. The token is read directly
 * from Google's token endpoint over TLS, so per OIDC §3.1.3.7 the TLS channel
 * authenticates the issuer and a JWKS signature round-trip is not required; we
 * still enforce `aud`/`iss`/`exp`/`email_verified`. Returns null if any check
 * fails.
 */
function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): GoogleIdTokenPayload | null {
  let payload: GoogleIdTokenPayload
  try {
    const decoded = jwt.decode(idToken, { complete: true })
    if (!decoded || typeof decoded.payload !== "object") return null
    payload = decoded.payload as GoogleIdTokenPayload
  } catch {
    return null
  }

  if (payload.aud !== clientId) return null
  if (!payload.iss || !GOOGLE_ISSUERS.has(payload.iss)) return null
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    return null
  }
  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true"
  if (!emailVerified) return null
  if (!payload.sub) return null

  return payload
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const requestId = getRequestId(req)
  const logger = req.scope.resolve<Logger>(ContainerRegistrationKeys.LOGGER)
  const cache = req.scope.resolve(Modules.CACHE) as CacheModule

  // Rate limit (10/min/IP).
  if (
    await overLimit(
      cache,
      `rl:google_cb:ip:${getClientIp(req)}`,
      IP_RATE_LIMIT.windowMs,
      IP_RATE_LIMIT.limit,
      IP_RATE_LIMIT.ttl
    )
  ) {
    return fail(res, 429, "rate_limited", requestId)
  }

  // Optional feature: unavailable rather than erroring when not configured.
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    return fail(res, 503, "google_login_unavailable", requestId)
  }

  // Google signals user-denied / errors via query params — treat as auth fail.
  if (req.query.error) {
    return fail(res, 401, "authentication_failed", requestId)
  }

  const parsedQuery = CallbackQuery.safeParse(req.query)
  if (!parsedQuery.success) {
    return fail(res, 401, "authentication_failed", requestId)
  }
  const { code, state } = parsedQuery.data

  // 1) CSRF: query state must equal the browser cookie AND a live Redis entry.
  const cookieState = readCookie(req, STATE_COOKIE)
  const storedState = await cache.get<{ return_to?: unknown }>(stateKey(state))
  if (!cookieState || cookieState !== state || storedState === null) {
    return fail(res, 401, "invalid_state", requestId)
  }
  // Post-login return path the start route stashed in the (now verified) state.
  const returnTo = resolveReturnPath(storedState.return_to)
  // Consume (single-use) + clear the binding cookie.
  await cache.set(stateKey(state), null, 1).catch(() => undefined)
  res.clearCookie(STATE_COOKIE, { path: CALLBACK_PATH })

  // The token-exchange redirect_uri must equal the one 05C sent to Google.
  const redirectUri = resolveRedirectUri()
  if (!redirectUri) {
    logger.error(
      `[auth/google/callback] GOOGLE_OAUTH_REDIRECT_URI failed validation (request_id=${requestId})`
    )
    return fail(res, 500, "google_login_misconfigured", requestId)
  }

  // 2) Exchange the code + verify the id_token (claims only — see fn doc).
  const idToken = await exchangeCodeForIdToken(
    code,
    redirectUri,
    clientId,
    clientSecret
  )
  if (!idToken) {
    logger.warn(
      `[auth/google/callback] token exchange failed (request_id=${requestId})`
    )
    return fail(res, 401, "authentication_failed", requestId)
  }

  const payload = verifyGoogleIdToken(idToken, clientId)
  if (!payload || !payload.sub) {
    return fail(res, 401, "authentication_failed", requestId)
  }
  const providerUserId = payload.sub
  const email = payload.email
  const name =
    payload.name ||
    [payload.given_name, payload.family_name].filter(Boolean).join(" ") ||
    undefined

  // 3) Retrieve-or-create the auth identity keyed by the immutable Google `sub`,
  // so both new and returning users have a stable auth_identity_id for the
  // session (mirrors the built-in provider's verify_ semantics).
  const authModule = req.scope.resolve(Modules.AUTH) as AuthModuleService
  let authIdentity: AuthIdentityRecord
  try {
    const existingIdentities = await authModule.listAuthIdentities({
      provider_identities: {
        provider: GOOGLE_PROVIDER_ID,
        entity_id: providerUserId,
      },
    })
    if (existingIdentities.length > 0) {
      authIdentity = existingIdentities[0]
    } else {
      authIdentity = await authModule.createAuthIdentities({
        provider_identities: [
          {
            provider: GOOGLE_PROVIDER_ID,
            entity_id: providerUserId,
            user_metadata: {
              email,
              name,
              picture: payload.picture,
            },
          },
        ],
      })
    }
  } catch (err) {
    logger.error(
      `[auth/google/callback] auth identity resolve failed (request_id=${requestId})`
    )
    return fail(res, 500, "login_failed", requestId)
  }

  // 4) Resolve the customer.
  const socialService = req.scope.resolve(SOCIAL_IDENTITY_MODULE) as {
    listSocialIdentities(
      filters: Record<string, unknown>
    ): Promise<{ id: string; customer_id: string }[]>
    createSocialIdentities(data: Record<string, unknown>): Promise<unknown>
  }

  let customerId: string | undefined =
    (authIdentity.app_metadata?.customer_id as string | undefined) ?? undefined

  if (!customerId) {
    // Returning Google user? Match by the immutable provider_user_id only.
    const existing = await socialService.listSocialIdentities({
      provider: GOOGLE_PROVIDER_ID,
      provider_user_id: providerUserId,
    })
    if (existing.length > 0) {
      customerId = existing[0].customer_id
    }
  }

  if (!customerId) {
    // New social login. security.md: never auto-link by email — create fresh.
    if (!email) {
      return fail(res, 401, "email_required", requestId)
    }
    try {
      const { result: customer } = await createCustomerAccountWorkflow(
        req.scope
      ).run({
        input: {
          authIdentityId: authIdentity.id,
          customerData: { email, first_name: name },
        },
      })
      customerId = (customer as { id: string }).id
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      // An existing account with this email — do NOT link (security.md).
      if (/exist|duplicate|unique/i.test(message)) {
        return fail(res, 409, "email_conflict", requestId)
      }
      logger.error(
        `[auth/google/callback] customer creation failed (request_id=${requestId})`
      )
      return fail(res, 500, "login_failed", requestId)
    }

    // 5) Record the Google ↔ customer link.
    await socialService.createSocialIdentities({
      customer_id: customerId,
      provider: GOOGLE_PROVIDER_ID,
      provider_user_id: providerUserId,
    })
  }

  // 6) Establish the session (HttpOnly connect.sid — same as /auth/session).
  const session = (
    req as MedusaRequest & { session?: { auth_context?: unknown } }
  ).session
  if (session) {
    session.auth_context = {
      actor_id: customerId,
      actor_type: "customer",
      auth_identity_id: authIdentity.id,
      app_metadata: { customer_id: customerId },
    }
  }

  // Session established (HttpOnly connect.sid) — no tokens in the response.
  // Return the browser to the intent-selected path carried by the single-use
  // state (BACKEND-11): `/account` when login began with `?intent=account`, else
  // `/checkout` (the unchanged default). The target was re-validated against the
  // hard-coded allowlist above (security.md: no open redirect, no echoed return
  // target); the storefront reads this session and prefills the form.
  res.redirect(302, returnTo)
}
