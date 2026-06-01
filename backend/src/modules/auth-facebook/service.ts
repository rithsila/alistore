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
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/oauth/access_token`
      )
      tokenUrl.searchParams.set("client_id", this.config_.clientId)
      tokenUrl.searchParams.set("client_secret", this.config_.clientSecret)
      tokenUrl.searchParams.set("redirect_uri", this.config_.callbackUrl)
      tokenUrl.searchParams.set("code", code)

      const tokenRes = await fetch(tokenUrl.toString(), { method: "GET" })
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
      const meUrl = new URL(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/me`
      )
      meUrl.searchParams.set("fields", "id,name,email")
      meUrl.searchParams.set("access_token", accessToken)

      const meRes = await fetch(meUrl.toString(), { method: "GET" })
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
