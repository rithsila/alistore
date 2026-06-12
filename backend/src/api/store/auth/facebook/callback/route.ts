/**
 * GET /store/auth/facebook/callback — BACKEND-05B (Facebook OAuth, callback).
 *
 * Completes the optional social login that BACKEND-05 started:
 *  1. Verify the OAuth `state` set by the start route — query `state` must equal
 *     the HttpOnly `_fb_oauth_state` cookie AND a live Redis entry must exist;
 *     the entry is then consumed (single-use). This is the CSRF authority.
 *  2. Exchange the `code` + load the Facebook profile via the registered
 *     `facebook` auth provider (`authModule.validateCallback`), yielding an
 *     `auth_identity` keyed by the Facebook user id.
 *  3. Resolve the customer: a returning Facebook user (matched by
 *     `provider_user_id`) reuses their customer; otherwise a NEW customer is
 *     created and linked. Per security.md ("FB identity may link only to a
 *     customer who proved phone ownership in the same session"; "FB email is not
 *     proof of customer ownership") we NEVER auto-link to a pre-existing customer
 *     by email — a fresh customer is created, or 409 on an email collision.
 *  4. Write one `customer_social_identity` row for new links.
 *  5. Establish a real session (`req.session.auth_context` → HttpOnly cookie,
 *     the same mechanism as Medusa's `/auth/session`) and return `{ customer }`.
 *
 * Any failure returns 401 `{ error, request_id }` (no internal detail leaked).
 *
 * SECURITY (security.md): scopes minimal (set in BACKEND-05); never log the
 * code, tokens, email, or other PII; rate-limited 10/min per client IP.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Logger } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCustomerAccountWorkflow } from "@medusajs/medusa/core-flows"
import { randomUUID } from "crypto"
import { z } from "zod"
import { SOCIAL_IDENTITY_MODULE } from "../../../../../modules/social-identity"

/** The OAuth provider id registered under the Auth Module (medusa-config.ts). */
const FB_PROVIDER_ID = "facebook"

/** Cookie BACKEND-05 set to bind the OAuth `state` to this browser. */
const STATE_COOKIE = "_fb_oauth_state"

/** Path the state cookie was scoped to (must match BACKEND-05). */
const CALLBACK_PATH = "/store/auth/facebook/callback"

/**
 * Post-login return paths (BACKEND-11). The start route (BACKEND-05) stored a
 * `return_to` in the single-use state entry, resolved from an optional `?intent=`
 * against this same hard-coded allowlist. The callback re-validates the stored
 * value here (defense in depth) before using it as the terminal redirect — an
 * absent/unrecognized value falls back to `/checkout`, the unchanged default.
 * Relative + hard-coded (security.md: redirect targets come from a hard-coded
 * allowlist, never echoed client input — no `?next=`/`?return_to=`). Through the
 * storefront's `/store/auth/*` rewrite each resolves to `<storefront-origin>`
 * + the path, where `@lib/auth` reads this session.
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

/** Redis key prefix BACKEND-05 stored the live `state` under. */
function stateKey(state: string): string {
  return `fb:oauth:state:${state}`
}

/** Rate limit (security.md): 10/min per client IP. */
const IP_RATE_LIMIT = { windowMs: 60_000, limit: 10, ttl: 60 } as const

/** Validated OAuth callback query (zod — security.md: validate every input). */
const CallbackQuery = z.object({
  code: z.string().min(1).max(1024),
  state: z.string().min(1).max(512),
})

type CacheModule = {
  get<T>(key: string): Promise<T | null>
  set(key: string, data: unknown, ttl?: number): Promise<void>
}

interface ProviderIdentity {
  provider: string
  entity_id: string
  user_metadata?: Record<string, unknown> | null
}

interface AuthIdentity {
  id: string
  provider_identities?: ProviderIdentity[]
  app_metadata?: Record<string, unknown> | null
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
      `rl:fb_cb:ip:${getClientIp(req)}`,
      IP_RATE_LIMIT.windowMs,
      IP_RATE_LIMIT.limit,
      IP_RATE_LIMIT.ttl
    )
  ) {
    return fail(res, 429, "rate_limited", requestId)
  }

  // Optional feature: unavailable rather than erroring when not configured.
  if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET) {
    return fail(res, 503, "facebook_login_unavailable", requestId)
  }

  // Facebook signals user-denied / errors via query params — treat as auth fail.
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

  // 2) Exchange the code + load the profile via the registered FB provider.
  let authIdentity: AuthIdentity | undefined
  try {
    const authModule = req.scope.resolve(Modules.AUTH)
    const result = await authModule.validateCallback(FB_PROVIDER_ID, {
      actor_type: "customer",
      url: req.url,
      headers: req.headers,
      query: req.query,
      body: req.body,
      protocol: req.protocol,
    } as any)
    if (!result.success || !result.authIdentity) {
      return fail(res, 401, "authentication_failed", requestId)
    }
    authIdentity = result.authIdentity as unknown as AuthIdentity
  } catch {
    logger.warn(
      `[auth/facebook/callback] validateCallback failed (request_id=${requestId})`
    )
    return fail(res, 401, "authentication_failed", requestId)
  }

  const fbIdentity = authIdentity.provider_identities?.find(
    (p) => p.provider === FB_PROVIDER_ID
  )
  const providerUserId = fbIdentity?.entity_id
  if (!providerUserId) {
    return fail(res, 401, "authentication_failed", requestId)
  }
  const email =
    (fbIdentity?.user_metadata?.email as string | undefined) ?? undefined
  const name =
    (fbIdentity?.user_metadata?.name as string | undefined) ?? undefined

  // 3) Resolve the customer.
  const socialService = req.scope.resolve(SOCIAL_IDENTITY_MODULE) as {
    listSocialIdentities(filters: Record<string, unknown>): Promise<
      { id: string; customer_id: string }[]
    >
    createSocialIdentities(data: Record<string, unknown>): Promise<unknown>
  }

  let customerId: string | undefined =
    (authIdentity.app_metadata?.customer_id as string | undefined) ?? undefined

  if (!customerId) {
    // Returning Facebook user? Match by the immutable provider_user_id only.
    const existing = await socialService.listSocialIdentities({
      provider: FB_PROVIDER_ID,
      provider_user_id: providerUserId,
    })
    if (existing.length > 0) {
      customerId = existing[0].customer_id
    }
  }

  if (!customerId) {
    // New social login. security.md: never auto-link by email — create fresh.
    if (!email) {
      // Without an email Medusa can't create the account; surface a clear 401.
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
        `[auth/facebook/callback] customer creation failed (request_id=${requestId})`
      )
      return fail(res, 500, "login_failed", requestId)
    }

    // 4) Record the Facebook ↔ customer link.
    await socialService.createSocialIdentities({
      customer_id: customerId,
      provider: FB_PROVIDER_ID,
      provider_user_id: providerUserId,
    })
  }

  // 5) Establish the session (HttpOnly connect.sid — same as /auth/session).
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
