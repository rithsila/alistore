/**
 * Facebook auth provider — BACKEND-05B (registered under Medusa's Auth Module).
 *
 * Ported from Medusa's built-in Google provider (`@medusajs/auth-google`) to the
 * Facebook Graph OAuth endpoints. It owns the two provider-level concerns:
 *  - `authenticate()`  — builds the Facebook authorize redirect (standard flow).
 *  - `validateCallback()` — exchanges the `code` for an access token, fetches the
 *    profile, and creates/retrieves the `auth_identity` keyed by the Facebook
 *    user id (`entity_id`), storing the profile in `user_metadata`.
 *
 * STATE / CSRF: the storefront drives this through the custom store routes
 * (`GET /store/auth/facebook` → BACKEND-05, `…/callback` → BACKEND-05B). Those
 * routes generate, store (Redis), and verify the OAuth `state` (single-use,
 * session-bound cookie) themselves — so `validateCallback` here does NOT re-check
 * provider state; the calling route is the CSRF authority.
 *
 * DEV SEAM (TEST-08): the token-exchange + profile Graph calls resolve through
 * `graphOrigin()`, which is `https://graph.facebook.com` everywhere except
 * under the dev-only, loopback-only `FB_GRAPH_DEV_BASE_URL` escape (see
 * `devGraphOrigin` below) used by `storefront/tests/fb-login.spec.ts`.
 *
 * SECURITY (security.md): never log the `code`, access token, or profile (PII).
 * Scopes are restricted to `email,public_profile`.
 */
import { AbstractAuthModuleProvider, MedusaError } from "@medusajs/framework/utils"
import type {
  AuthIdentityProviderService,
  AuthenticationInput,
  AuthenticationResponse,
  Logger,
} from "@medusajs/framework/types"
import { randomBytes } from "crypto"

/** Graph API version pinned for the OAuth + profile endpoints. */
const FB_GRAPH_VERSION = "v21.0"

/** Minimal scopes (security.md): email + public_profile only. */
const FB_SCOPES = "email,public_profile"

/** Production Graph API origin for the token-exchange + profile endpoints. */
const FB_GRAPH_ORIGIN = "https://graph.facebook.com"

/**
 * Dev-only mock-Graph escape (TEST-08 — mirrors the Bakong
 * `BAKONG_PROXY_DEV_ALLOW_LOOPBACK` seam in `bakong-payment/lib/proxy.ts`):
 * when the process is NOT production AND `FB_GRAPH_DEV_BASE_URL` targets a
 * LOOPBACK host (localhost, 127.0.0.0/8, ::1), the code-exchange + profile
 * fetches resolve against that base instead of graph.facebook.com — so
 * `storefront/tests/fb-login.spec.ts` can host a mock Graph API and drive the
 * full callback chain (state verify → exchange → identity → session) without
 * real Facebook credentials. Loopback-only by construction (a non-loopback
 * value is ignored, so this can never redirect real traffic off-box) and inert
 * in production: `NODE_ENV=production` disables it regardless of the value.
 */
function devGraphOrigin(): string | null {
  if (process.env.NODE_ENV === "production") return null
  const raw = process.env.FB_GRAPH_DEV_BASE_URL?.trim()
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

  return url.origin
}

/** Graph origin for server-side calls: the dev mock when active, else real. */
function graphOrigin(): string {
  return devGraphOrigin() ?? FB_GRAPH_ORIGIN
}

interface Options {
  clientId: string
  clientSecret: string
  callbackUrl: string
}

interface InjectedDependencies {
  logger: Logger
}

class FacebookAuthService extends AbstractAuthModuleProvider {
  static identifier = "facebook"
  static DISPLAY_NAME = "Facebook Authentication"

  protected config_: Options
  protected logger_: Logger

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.clientId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Facebook clientId is required"
      )
    }
    if (!options.clientSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Facebook clientSecret is required"
      )
    }
    if (!options.callbackUrl) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Facebook callbackUrl is required"
      )
    }
  }

  constructor({ logger }: InjectedDependencies, options: Options) {
    // @ts-ignore — base ctor signature is internal (matches @medusajs/auth-google)
    super(...arguments)
    this.config_ = options
    this.logger_ = logger
  }

  async register(): Promise<AuthenticationResponse> {
    return {
      success: false,
      error:
        "Facebook does not support registration. Use the `authenticate` flow instead.",
    }
  }

  /**
   * Standard-flow entrypoint: returns a redirect to Facebook's authorize dialog.
   * Stores `callback_url` in provider state (used only by the standard
   * `/auth/customer/facebook` flow; the custom store routes manage their own
   * state). Kept for provider completeness/idiomatic parity with Google.
   */
  async authenticate(
    req: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const query = (req.query ?? {}) as Record<string, string>
    if (query.error) {
      return {
        success: false,
        error: query.error_description || query.error,
      }
    }

    const stateKey = randomBytes(32).toString("hex")
    await authIdentityService.setState(stateKey, {
      callback_url: this.config_.callbackUrl,
    })

    const authUrl = new URL(
      `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`
    )
    authUrl.searchParams.set("client_id", this.config_.clientId)
    authUrl.searchParams.set("redirect_uri", this.config_.callbackUrl)
    authUrl.searchParams.set("state", stateKey)
    authUrl.searchParams.set("scope", FB_SCOPES)
    authUrl.searchParams.set("response_type", "code")

    return { success: true, location: authUrl.toString() }
  }

  /**
   * Exchanges the `code` for an access token, fetches the Facebook profile, and
   * creates/retrieves the auth identity keyed by the Facebook user id.
   * Returns `{ success, authIdentity }` — the calling route links it to a
   * customer and issues the session.
   */
  async validateCallback(
    req: AuthenticationInput,
    authIdentityService: AuthIdentityProviderService
  ): Promise<AuthenticationResponse> {
    const query = (req.query ?? {}) as Record<string, string>
    const body = (req.body ?? {}) as Record<string, string>

    if (query.error) {
      return {
        success: false,
        error: query.error_description || query.error,
      }
    }

    const code = query.code ?? body.code
    if (!code) {
      return { success: false, error: "No code provided" }
    }

    try {
      // 1) Exchange the authorization code for a short-lived access token.
      const tokenUrl = new URL(
        `${graphOrigin()}/${FB_GRAPH_VERSION}/oauth/access_token`
      )
      tokenUrl.searchParams.set("client_id", this.config_.clientId)
      tokenUrl.searchParams.set("client_secret", this.config_.clientSecret)
      tokenUrl.searchParams.set("redirect_uri", this.config_.callbackUrl)
      tokenUrl.searchParams.set("code", code)

      const tokenRes = await fetch(tokenUrl.toString(), {
        method: "GET",
        redirect: "manual", // never follow redirects (Bakong proxy posture)
      })
      if (!tokenRes.ok) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Could not exchange token (${tokenRes.status})`
        )
      }
      const tokenJson = (await tokenRes.json()) as { access_token?: string }
      const accessToken = tokenJson.access_token
      if (!accessToken) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No access token returned"
        )
      }

      // 2) Fetch the profile (id is the stable identifier; email may be absent).
      // The token rides the Authorization header (Graph API supports both) —
      // never the URL, where it could leak into request logs (security.md:
      // tokens are never logged).
      const meUrl = new URL(`${graphOrigin()}/${FB_GRAPH_VERSION}/me`)
      meUrl.searchParams.set("fields", "id,name,email")

      const meRes = await fetch(meUrl.toString(), {
        method: "GET",
        redirect: "manual", // never follow redirects (Bakong proxy posture)
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!meRes.ok) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Could not fetch profile (${meRes.status})`
        )
      }
      const profile = (await meRes.json()) as {
        id?: string
        name?: string
        email?: string
      }
      if (!profile.id) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "No user id returned from Facebook"
        )
      }

      const entity_id = profile.id
      const userMetadata = {
        name: profile.name,
        email: profile.email,
      }

      // 3) Retrieve-or-create the auth identity for this Facebook user.
      let authIdentity
      try {
        authIdentity = await authIdentityService.retrieve({ entity_id })
      } catch (error: any) {
        if (error.type === MedusaError.Types.NOT_FOUND) {
          authIdentity = await authIdentityService.create({
            entity_id,
            user_metadata: userMetadata,
          })
        } else {
          return { success: false, error: error.message }
        }
      }

      return { success: true, authIdentity }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }
}

export default FacebookAuthService
