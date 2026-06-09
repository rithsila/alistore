import { execSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

/**
 * TEST-08B — Google login (parallel to TEST-08, Facebook).
 *
 * Chain under test: complete Google login → customer + ONE
 * `customer_social_identity` row (`provider=google`) → session returned (and
 * the checkout Full Name prefill, INTEGRATION-06B).
 *
 * ── How "complete Google login" works (user-approved seam, 2026-06-06) ───────
 * Dev has no real Google OAuth client, and the callback route
 * (`backend/src/api/store/auth/google/callback/route.ts`, BACKEND-05D approach
 * (b)) exchanges the code server-side at oauth2.googleapis.com — unreachable
 * for Playwright interception. So, mirroring the TEST-08 Facebook seam, this
 * spec hosts a MOCK Google token endpoint on `127.0.0.1:${MOCK_TOKEN_PORT}`
 * and the dev-only, loopback-only `GOOGLE_TOKEN_DEV_BASE_URL` escape in the
 * callback (inert when NODE_ENV=production) points the backend's exchange at
 * it. Google has no separate profile fetch — the `id_token` carries the
 * profile, and the callback's claims-only verification (OIDC §3.1.3.7 posture,
 * no JWKS round-trip) means the mock can mint it. Everything else runs
 * UNMODIFIED and live: the OAuth start route (state cookie + Redis entry), the
 * storefront's same-origin `/store/auth/*` proxy (publishable-key injection —
 * this spec attaches NO key on the browser path), the callback's state/CSRF
 * verify, the code exchange, the id_token claims verification
 * (aud/iss/exp/email_verified), customer + identity-row creation, the
 * `connect.sid` session, and the 302 → /checkout return. The ONLY thing the
 * seam replaces is Google's consent screen: the spec performs the exact
 * `?code&state` redirect-back navigation Google would trigger. The real
 * consent round-trip against a live Google OAuth client remains a UAT item
 * (same caveat as TEST-08's real-Facebook path).
 *
 * Prerequisites (see playwright.config.ts for the dev-stack basics):
 *  - backend :9000 + storefront :8000 running;
 *  - backend/.env must carry the dev-mock Google block (GOOGLE_CLIENT_ID/
 *    GOOGLE_CLIENT_SECRET=dev-mock-*, GOOGLE_OAUTH_REDIRECT_URI on the :8000
 *    origin, GOOGLE_TOKEN_DEV_BASE_URL=http://127.0.0.1:4282) and the backend
 *    must have been (re)started after setting it — the spec fails with a setup
 *    message when the seam isn't active;
 *  - while this env block is set, "Continue with Google" 302s to a real Google
 *    dialog that rejects the mock client_id — blank GOOGLE_CLIENT_ID/
 *    GOOGLE_CLIENT_SECRET to return to the 503 google_login_unavailable
 *    behavior.
 *
 * Serial on purpose: the mock binds a fixed port and the returning-login test
 * reuses the first test's customer, so they must run in a single worker, in
 * order.
 *
 * Rate limits (security.md): start + callback each allow 10/min/IP; a full run
 * makes 2 of each — comfortably inside the budget, parallel suite included
 * (fb-login.spec's budget is per-route, so the two specs don't share buckets).
 *
 * Side effects per run (dev DB): one customer + one auth identity + one
 * `customer_social_identity` row, all keyed to the synthetic per-run
 * `ge2e<hex>` Google subject (inert; identifiable for cleanup).
 */

test.describe.configure({ mode: "serial" })

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

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
// unique per run (no email_conflict on re-runs) and shell-safe for the
// `medusa exec` guard below.
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
                "is another google-login.spec run (or a stale process) holding it?"
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

// ── Shared helpers (fb-login/cod/khqr.spec.ts precedents) ─────────────────────

/** Read a storefront env value: process env first, then .env.local / .env. */
function readStorefrontEnv(name: string): string | undefined {
  if (process.env[name]) {
    return process.env[name]
  }
  for (const file of [".env.local", ".env"]) {
    try {
      const content = readFileSync(join(__dirname, "..", file), "utf8")
      const match = content.match(new RegExp(`^${name}=(.*)$`, "m"))
      if (match) {
        return match[1].trim()
      }
    } catch {
      // File absent — try the next one.
    }
  }
  return undefined
}

function publishableKeyHeaders(): Record<string, string> {
  const publishableKey = readStorefrontEnv("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")
  expect(
    publishableKey,
    "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY missing (storefront env)"
  ).toBeTruthy()
  return {
    "x-publishable-api-key": publishableKey!,
    "content-type": "application/json",
  }
}

// ── Flow driver ───────────────────────────────────────────────────────────────

const SEAM_HINT =
  "Is the TEST-08B dev seam active? backend/.env needs the dev-mock Google " +
  "block (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET=dev-mock-*, " +
  "GOOGLE_OAUTH_REDIRECT_URI on the :8000 origin, " +
  "GOOGLE_TOKEN_DEV_BASE_URL=http://127.0.0.1:4282) and the backend must be " +
  "restarted after setting it (spec header)."

/**
 * Drive one full Google login round-trip through the real user path and
 * return the signed-in customer (the "session returned" proof).
 *
 *  1. `GET /store/auth/google` on the :8000 origin — exactly what the
 *     "Continue with Google" anchor does — WITHOUT following the redirect,
 *     so the browser never visits accounts.google.com. The response must be
 *     the dialog 302 (NOT the pub-key 400 → proves the INTEGRATION-06 proxy
 *     injected the key; NOT the 503 → proves the provider is configured) and
 *     sets the `_google_oauth_state` cookie into this context's jar.
 *  2. Navigate the `?code&state` redirect-back Google's consent screen would
 *     trigger. The REAL callback chain runs: state verify (cookie + Redis,
 *     single-use), code exchange via the mock token endpoint, id_token claims
 *     verification, customer + identity resolution, session establishment,
 *     302 → /checkout.
 *  3. Read `/store/customers/me` against the backend directly, authenticated
 *     ONLY by the `connect.sid` cookie the callback set — the session proof.
 */
async function completeGoogleLogin(
  page: Page
): Promise<{ id: string; email: string | null; first_name: string | null }> {
  const context = page.context()

  // 1) OAuth start (no publishable key attached — the proxy must inject it).
  const startRes = await context.request.get("/store/auth/google", {
    maxRedirects: 0,
  })
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
  // lands on /checkout.
  const response = await page.goto(
    `/store/auth/google/callback?code=${encodeURIComponent(
      MOCK_CODE
    )}&state=${encodeURIComponent(state!)}`,
    { waitUntil: "domcontentloaded" }
  )
  if (!new URL(page.url()).pathname.startsWith("/checkout")) {
    const body = (await response?.text().catch(() => "")) ?? ""
    throw new Error(
      `Callback did not land on /checkout (got ${page.url()}; body: ` +
        `${body.slice(0, 200)}; mock token hits: ${JSON.stringify(
          mockHits
        )}). ` +
        SEAM_HINT
    )
  }

  // 3) Session proof: connect.sid (HttpOnly, set on the :8000 origin through
  // the proxy) authenticates the customer read against the backend, exactly as
  // @lib/auth forwards it (raw value — never re-encoded).
  const sid = (await context.cookies()).find((c) => c.name === "connect.sid")
  expect(sid, "no connect.sid session cookie after callback").toBeTruthy()
  const meRes = await context.request.get(`${BACKEND_URL}/store/customers/me`, {
    headers: {
      ...publishableKeyHeaders(),
      cookie: `connect.sid=${sid!.value}`,
    },
  })
  expect(meRes.status(), "session did not authenticate /customers/me").toBe(200)
  const { customer } = (await meRes.json()) as {
    customer: { id: string; email: string | null; first_name: string | null }
  }
  expect(customer.id).toMatch(/^cus_[A-Za-z0-9]+$/)
  return customer
}

/**
 * Backend truth: the `customer_social_identity` rows for this run's synthetic
 * Google subject, read from the DB by the read-only dev helper. (No public API
 * exposes them — TEST-04/05 `medusa exec` precedent; see khqr.spec.ts for the
 * Windows shell + injection-guard rationale.)
 */
function verifyIdentityRows(): Array<{
  id: string
  customer_id: string
  provider: string
  provider_user_id: string
}> {
  if (!/^[a-z0-9]+$/.test(GOOGLE_USER_ID)) {
    throw new Error("unsafe provider user id — refusing to shell out")
  }
  const verifyOut = execSync(
    `npx medusa exec ./src/scripts/dev-verify-google-login.ts ${GOOGLE_USER_ID}`,
    {
      cwd: BACKEND_DIR,
      encoding: "utf8",
      timeout: 240_000,
      maxBuffer: 10 * 1024 * 1024,
    }
  )
  const marker = verifyOut.match(/GOOGLE_LOGIN_VERIFY_RESULT (\{.*\})/)
  expect(
    marker,
    "no GOOGLE_LOGIN_VERIFY_RESULT line in medusa exec output"
  ).toBeTruthy()
  return (
    JSON.parse(marker![1]) as {
      identities: Array<{
        id: string
        customer_id: string
        provider: string
        provider_user_id: string
      }>
    }
  ).identities
}

// ── The TEST-08B chain ────────────────────────────────────────────────────────

/** Set by the first test; the returning-login test must resolve the SAME one. */
let firstLoginCustomerId: string | undefined

test.describe("Google login (TEST-08B)", () => {
  test("completed login creates the customer, ONE identity row, and a session", async ({
    page,
  }) => {
    // Full OAuth drive + a `medusa exec` boot — generous budget (TEST-04).
    test.setTimeout(420_000)

    const customer = await completeGoogleLogin(page)
    firstLoginCustomerId = customer.id

    // The session resolved the profile the mock id_token carried — a brand-new
    // customer for this run's synthetic Google subject (BACKEND-05D never links
    // by email).
    expect(customer.email).toBe(GOOGLE_USER_EMAIL)
    expect(customer.first_name).toBe(GOOGLE_USER_NAME)

    // INTEGRATION-06B acceptance, live: back on /checkout the session prefills
    // the Full Name field (GoogleLogin → getSocialLoginPrefillName). The
    // generous timeout absorbs dev-server compile of the server action.
    await expect(page.locator("#delivery-full-name")).toHaveValue(
      GOOGLE_USER_NAME,
      { timeout: 30_000 }
    )

    // Backend truth: EXACTLY ONE customer_social_identity row, provider=google,
    // linking this run's Google subject to the customer the session returned.
    const identities = verifyIdentityRows()
    expect(identities).toHaveLength(1)
    expect(identities[0].provider).toBe("google")
    expect(identities[0].provider_user_id).toBe(GOOGLE_USER_ID)
    expect(identities[0].customer_id).toBe(customer.id)
  })

  test("returning login reuses the customer — still exactly one identity row", async ({
    page,
  }) => {
    test.setTimeout(420_000)
    expect(
      firstLoginCustomerId,
      "first login test must have passed (serial order)"
    ).toBeTruthy()

    // A fresh browser state (no cookies) — the same Google user coming back.
    await page.context().clearCookies()

    const customer = await completeGoogleLogin(page)

    // Matched by the immutable provider_user_id → the SAME customer, no
    // duplicate account.
    expect(customer.id).toBe(firstLoginCustomerId)

    // And the ledger did not grow: still exactly one identity row.
    const identities = verifyIdentityRows()
    expect(identities).toHaveLength(1)
    expect(identities[0].customer_id).toBe(firstLoginCustomerId)
  })
})
