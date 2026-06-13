import { randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"

import { expect, test, type Page } from "@playwright/test"

/**
 * TEST-12 — Account area E2E (Customer Accounts, Wave 1).
 *
 * Proves the account flow end-to-end against the real dev stack: the signed-out
 * nav popover offers both providers, a guest is guarded off `/account`, a
 * completed social login lands on `/account` (home greets by name; profile
 * prefills name + email), and logout clears the session.
 *
 * ── Seam reuse (TEST-08B `google-login.spec.ts`) ─────────────────────────────
 * This spec reuses TEST-08B's Google dev-mock seam VERBATIM (mock token server +
 * helpers): dev has no real Google OAuth client and the callback exchanges the
 * code server-side at oauth2.googleapis.com (unreachable for Playwright), so the
 * spec hosts a MOCK Google token endpoint on `127.0.0.1:${MOCK_TOKEN_PORT}` and
 * the dev-only, loopback-only `GOOGLE_TOKEN_DEV_BASE_URL` escape in the callback
 * (inert when NODE_ENV=production) points the backend's exchange at it. The only
 * delta from TEST-08B is the login DRIVER: the OAuth start carries
 * `?intent=account` (BACKEND-11) so the verified callback returns to `/account`
 * instead of `/checkout`. Everything else (state cookie + Redis entry, the
 * same-origin `/store/auth/*` proxy that injects the publishable key, the
 * callback's CSRF/state verify, the claims-only id_token verification, customer +
 * identity-row creation, the `connect.sid` session) runs UNMODIFIED and live.
 *
 * Prerequisites (see playwright.config.ts for the dev-stack basics):
 *  - backend :9000 + storefront :8000 running;
 *  - backend/.env must carry the dev-mock Google block (GOOGLE_CLIENT_ID/
 *    GOOGLE_CLIENT_SECRET=dev-mock-*, GOOGLE_OAUTH_REDIRECT_URI on the :8000
 *    origin, GOOGLE_TOKEN_DEV_BASE_URL=http://127.0.0.1:4282) and the backend
 *    must have been (re)started after setting it — the spec fails with a setup
 *    message when the seam isn't active.
 *
 * Serial on purpose: the mock binds a fixed port (`:4282`) shared with
 * `google-login.spec.ts`, so run this spec TARGETED
 * (`npx playwright test account.spec.ts`) and NOT concurrently with that spec.
 *
 * Side effects per run (dev DB): one customer + one auth identity + one
 * `customer_social_identity` row, keyed to the synthetic per-run `ge2e<hex>`
 * Google subject (inert; identifiable for cleanup).
 */

test.describe.configure({ mode: "serial" })

/** Must match GOOGLE_TOKEN_DEV_BASE_URL in backend/.env (dev-mock block). */
const MOCK_TOKEN_PORT = 4282
/** Must match GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in backend/.env. */
const MOCK_CLIENT_ID = "dev-mock-google-client-id"
const MOCK_CLIENT_SECRET = "dev-mock-google-client-secret"
/** Must match GOOGLE_OAUTH_REDIRECT_URI in backend/.env (storefront origin). */
const EXPECTED_REDIRECT_URI = "http://localhost:8000/store/auth/google/callback"
/** The authorize dialog the start route (BACKEND-05C) must redirect to. */
const GOOGLE_DIALOG_URL = "https://accounts.google.com/o/oauth2/v2/auth"

// Per-run synthetic Google user. The hex tag keeps the subject and email
// unique per run (no email_conflict on re-runs).
const RUN_TAG = randomBytes(6).toString("hex")
const GOOGLE_USER_ID = `ge2e${RUN_TAG}`
const GOOGLE_USER_NAME = "Google E2e Tester"
const GOOGLE_USER_EMAIL = `google-e2e-${RUN_TAG}@alistore.dev`
const MOCK_CODE = `mockcode${RUN_TAG}`

// ── Mock Google token endpoint ────────────────────────────────────────────────

/** Hit counters — used for seam diagnostics when the flow fails mid-chain. */
const mockHits = { token: 0, rejected: 0 }

let mockToken: Server | undefined

/** base64url an arbitrary input (JWT segment encoding). */
function b64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input
  return buffer.toString("base64url")
}

/**
 * Mint the id_token the mock exchange returns. The callback verifies CLAIMS
 * only — `aud`/`iss`/`exp`/`email_verified`/`sub` via `jwt.decode` (the OIDC
 * §3.1.3.7 direct-channel posture, no JWKS) — so the signature segment is
 * opaque filler; what matters is that every claim matches what the backend
 * was configured with.
 */
function mintIdToken(): string {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = { alg: "RS256", typ: "JWT", kid: `devmock${RUN_TAG}` }
  const payload = {
    iss: "https://accounts.google.com",
    aud: MOCK_CLIENT_ID,
    sub: GOOGLE_USER_ID,
    email: GOOGLE_USER_EMAIL,
    email_verified: true,
    name: GOOGLE_USER_NAME,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  }
  return [
    b64url(JSON.stringify(header)),
    b64url(JSON.stringify(payload)),
    b64url(randomBytes(32)),
  ].join(".")
}

/**
 * Minimal stand-in for the one Google endpoint the callback calls
 * (BACKEND-05D's `exchangeCodeForIdToken`): `POST /token` answers the code
 * exchange — only for OUR client id/secret/redirect_uri, this run's code, and
 * `grant_type=authorization_code`, all read from the x-www-form-urlencoded
 * body exactly as Google would. Anything else is rejected, so a pass proves
 * the backend sent exactly the configured credentials.
 */
function startMockToken(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_TOKEN_PORT}`)
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }

    if (req.method !== "POST" || url.pathname !== "/token") {
      mockHits.rejected += 1
      return respond(404, { error: "unknown_mock_path" })
    }

    let rawBody = ""
    req.on("data", (chunk) => {
      rawBody += chunk
    })
    req.on("end", () => {
      const contentType = req.headers["content-type"] ?? ""
      const params = new URLSearchParams(rawBody)
      const ok =
        contentType.includes("application/x-www-form-urlencoded") &&
        params.get("client_id") === MOCK_CLIENT_ID &&
        params.get("client_secret") === MOCK_CLIENT_SECRET &&
        params.get("redirect_uri") === EXPECTED_REDIRECT_URI &&
        params.get("code") === MOCK_CODE &&
        params.get("grant_type") === "authorization_code"
      if (!ok) {
        mockHits.rejected += 1
        return respond(400, {
          error: "invalid_grant",
          error_description: "Bad Request",
        })
      }
      mockHits.token += 1
      respond(200, {
        access_token: `mockaccess${RUN_TAG}`,
        expires_in: 3599,
        scope: "openid email profile",
        token_type: "Bearer",
        id_token: mintIdToken(),
      })
    })
  })

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `Mock Google token port ${MOCK_TOKEN_PORT} is already in use — ` +
                "is another google-login.spec / account.spec run (or a stale process) holding it?"
            )
          : err
      )
    })
    server.listen(MOCK_TOKEN_PORT, "127.0.0.1", () => resolve(server))
  })
}

test.beforeAll(async () => {
  mockToken = await startMockToken()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!mockToken) return resolve()
    mockToken.close(() => resolve())
  })
})

// ── Flow driver ───────────────────────────────────────────────────────────────

const SEAM_HINT =
  "Is the TEST-08B dev seam active? backend/.env needs the dev-mock Google " +
  "block (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET=dev-mock-*, " +
  "GOOGLE_OAUTH_REDIRECT_URI on the :8000 origin, " +
  "GOOGLE_TOKEN_DEV_BASE_URL=http://127.0.0.1:4282) and the backend must be " +
  "restarted after setting it (spec header)."

/**
 * Drive one full Google login round-trip through the real user path WITH
 * `?intent=account` (BACKEND-11), landing the browser on `/account`. Identical
 * to TEST-08B's `completeGoogleLogin` except the start carries the account
 * intent and the post-callback landing is asserted to be `/account`. We assert
 * the rest of the account flow via the UI, so the helper returns void.
 *
 *  1. `GET /store/auth/google?intent=account` on the :8000 origin — what the
 *     "Continue with Google" popover anchor does — WITHOUT following the
 *     redirect, so the browser never visits accounts.google.com. The response
 *     must be the dialog 302 (NOT the pub-key 400 → proves the proxy injected
 *     the key; NOT the 503 → proves the provider is configured) and sets the
 *     `_google_oauth_state` cookie into this context's jar.
 *  2. Navigate the `?code&state` redirect-back the consent screen would
 *     trigger. The REAL callback chain runs and, because the start stashed the
 *     allowlisted `account` return target in the (now CSRF-verified) state
 *     entry, 302s to `/account`.
 *  3. Confirm the `connect.sid` session cookie was set on this origin.
 */
async function completeGoogleLogin(page: Page): Promise<void> {
  const context = page.context()

  // 1) OAuth start WITH intent=account (no publishable key attached — the proxy
  // must inject it).
  const startRes = await context.request.get(
    "/store/auth/google?intent=account",
    { maxRedirects: 0 }
  )
  expect(
    startRes.status(),
    `OAuth start returned ${startRes.status()}. ${SEAM_HINT}`
  ).toBe(302)

  const location = startRes.headers()["location"]
  expect(location, "OAuth start 302 had no Location header").toBeTruthy()
  const dialog = new URL(location!)

  // The dialog redirect carries OUR configured client + the locked-down params
  // (BACKEND-05C): mock client_id, allowlisted redirect_uri, minimal scopes.
  expect(`${dialog.origin}${dialog.pathname}`).toBe(GOOGLE_DIALOG_URL)
  expect(dialog.searchParams.get("client_id")).toBe(MOCK_CLIENT_ID)
  expect(dialog.searchParams.get("redirect_uri")).toBe(EXPECTED_REDIRECT_URI)
  expect(dialog.searchParams.get("scope")).toBe("email profile openid")
  expect(dialog.searchParams.get("response_type")).toBe("code")
  const state = dialog.searchParams.get("state")
  expect(state, "OAuth start issued no state").toBeTruthy()

  // The browser-binding state cookie is in the jar (path-scoped to the
  // callback), ready for the redirect-back.
  const stateCookie = (await context.cookies()).find(
    (c) => c.name === "_google_oauth_state"
  )
  expect(stateCookie?.value, "no _google_oauth_state cookie after start").toBe(
    state
  )

  // 2) The consent redirect-back. On success the callback 302s and the browser
  // lands on /account (the intent target the start route stashed in state).
  const response = await page.goto(
    `/store/auth/google/callback?code=${encodeURIComponent(
      MOCK_CODE
    )}&state=${encodeURIComponent(state!)}`,
    { waitUntil: "domcontentloaded" }
  )
  if (!new URL(page.url()).pathname.startsWith("/account")) {
    const body = (await response?.text().catch(() => "")) ?? ""
    throw new Error(
      `Callback did not land on /account (got ${page.url()}; body: ` +
        `${body.slice(0, 200)}; mock token hits: ${JSON.stringify(
          mockHits
        )}). ` +
        SEAM_HINT
    )
  }

  // 3) Session proof: connect.sid (HttpOnly, set on the :8000 origin through the
  // proxy) is the credential the account guard + reads rely on.
  const sid = (await context.cookies()).find((c) => c.name === "connect.sid")
  expect(sid, "no connect.sid session cookie after callback").toBeTruthy()
}

// ── The TEST-12 chain ─────────────────────────────────────────────────────────

test.describe("Account area (TEST-12)", () => {
  test("signed-out account icon offers both social providers", async ({
    page,
  }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Account" }).click()

    await expect(
      page.getByRole("menuitem", { name: "Continue with Facebook" })
    ).toBeVisible()
    const google = page.getByRole("menuitem", { name: "Continue with Google" })
    await expect(google).toBeVisible()
    // Login-from-nav carries the account intent (BACKEND-11).
    await expect(google).toHaveAttribute("href", /intent=account/)
  })

  test("guest hitting /account is redirected home", async ({ page }) => {
    await page.goto("/account")
    await expect(page).toHaveURL(/\/$/)
  })

  test("completed login lands on /account, greets by name, and prefills profile", async ({
    page,
  }) => {
    // Full OAuth drive + dev-server compile of the account route — generous
    // budget (TEST-04/08B precedent).
    test.setTimeout(420_000)

    await completeGoogleLogin(page) // lands on /account (asserted in helper)

    // Home greets by name (createCustomerAccountWorkflow populates first_name
    // from the full Google `name` claim — TEST-08B confirmed it is not split).
    await expect(
      page.getByRole("heading", { name: "My account" })
    ).toBeVisible()

    // Profile is prefilled from the session.
    await page.goto("/account/profile")
    await expect(page.locator("#first_name")).toHaveValue(GOOGLE_USER_NAME)
    await expect(page.locator("#email")).toHaveValue(GOOGLE_USER_EMAIL)
  })

  test("logout clears the session and restores the signed-out menu", async ({
    page,
  }) => {
    test.setTimeout(420_000)

    await completeGoogleLogin(page)

    await page.goto("/account")
    await page.getByRole("button", { name: "Log out" }).click()
    await expect(page).toHaveURL(/\/$/)

    // Session gone: the nav menu offers providers again, and /account re-guards.
    await page.getByRole("button", { name: "Account" }).click()
    await expect(
      page.getByRole("menuitem", { name: "Continue with Google" })
    ).toBeVisible()
    await page.goto("/account")
    await expect(page).toHaveURL(/\/$/)
  })
})
