import { execSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { join } from "node:path"

import { expect, test, type Page } from "@playwright/test"

/**
 * TEST-08 — Facebook login.
 *
 * Chain under test: complete FB login → customer + ONE `customer_social_identity`
 * row → session returned (and the checkout Full Name prefill, INTEGRATION-06).
 *
 * ── How "complete FB login" works (user-approved seam, 2026-06-06) ───────────
 * Dev has no real Facebook app, and the vendored provider
 * (`backend/src/modules/auth-facebook/service.ts`) calls graph.facebook.com
 * server-side — unreachable for Playwright interception. So, mirroring the
 * TEST-04 Bakong mock, this spec hosts a MOCK Facebook Graph API on
 * `127.0.0.1:${MOCK_GRAPH_PORT}` (token exchange + `/me` profile) and the
 * dev-only, loopback-only `FB_GRAPH_DEV_BASE_URL` escape in the provider
 * (inert when NODE_ENV=production) points the backend's Graph calls at it.
 * Everything else runs UNMODIFIED and live: the OAuth start route (state
 * cookie + Redis entry), the storefront's same-origin `/store/auth/*` proxy
 * (publishable-key injection — this spec attaches NO key on the browser path),
 * the callback's state/CSRF verify, the code exchange, customer + identity-row
 * creation, the `connect.sid` session, and the 302 → /checkout return. The
 * ONLY thing the seam replaces is Facebook's consent screen: the spec performs
 * the exact `?code&state` redirect-back navigation Facebook would trigger.
 * The real consent round-trip against a live FB app remains a UAT item (same
 * caveat as TEST-04's real-Bakong path).
 *
 * Prerequisites (see playwright.config.ts for the dev-stack basics):
 *  - backend :9000 + storefront :8000 running;
 *  - backend/.env must carry the dev-mock Facebook block (FB_APP_ID/
 *    FB_APP_SECRET=dev-mock-*, FB_OAUTH_REDIRECT_URI on the :8000 origin,
 *    FB_GRAPH_DEV_BASE_URL=http://127.0.0.1:4281) and the backend must have
 *    been (re)started after setting it — the spec fails with a setup message
 *    when the seam isn't active;
 *  - while this env block is set, "Continue with Facebook" 302s to a real FB
 *    dialog that rejects the mock client_id — blank FB_APP_ID/FB_APP_SECRET to
 *    return to the 503 facebook_login_unavailable behavior.
 *
 * Serial on purpose: the mock binds a fixed port and the returning-login test
 * reuses the first test's customer, so they must run in a single worker, in
 * order.
 *
 * Rate limits (security.md): start + callback each allow 10/min/IP; a full run
 * makes 2 of each — comfortably inside the budget, parallel suite included.
 *
 * Side effects per run (dev DB): one customer + one auth identity + one
 * `customer_social_identity` row, all keyed to the synthetic per-run
 * `fbe2e<hex>` Facebook user id (inert; identifiable for cleanup).
 */

test.describe.configure({ mode: "serial" })

const BACKEND_URL = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
const BACKEND_DIR = join(__dirname, "..", "..", "backend")

/** Must match FB_GRAPH_DEV_BASE_URL in backend/.env (dev-mock block). */
const MOCK_GRAPH_PORT = 4281
/** Must match the provider's pinned Graph version (auth-facebook/service.ts). */
const FB_GRAPH_VERSION = "v21.0"
/** Must match FB_APP_ID / FB_APP_SECRET in backend/.env (dev-mock block). */
const MOCK_APP_ID = "dev-mock-fb-app-id"
const MOCK_APP_SECRET = "dev-mock-fb-app-secret"
/** Must match FB_OAUTH_REDIRECT_URI in backend/.env (storefront origin). */
const EXPECTED_REDIRECT_URI =
  "http://localhost:8000/store/auth/facebook/callback"

// Per-run synthetic Facebook user. The hex tag keeps the provider user id and
// email unique per run (no email_conflict on re-runs) and shell-safe for the
// `medusa exec` guard below.
const RUN_TAG = randomBytes(6).toString("hex")
const FB_USER_ID = `fbe2e${RUN_TAG}`
const FB_USER_NAME = "Fb E2e Tester"
const FB_USER_EMAIL = `fb-e2e-${RUN_TAG}@alistore.dev`
const MOCK_CODE = `mockcode${RUN_TAG}`
const MOCK_ACCESS_TOKEN = `mocktoken${RUN_TAG}`

// ── Mock Facebook Graph API ───────────────────────────────────────────────────

/** Hit counters — used for seam diagnostics when the flow fails mid-chain. */
const mockHits = { token: 0, profile: 0, rejected: 0 }

let mockGraph: Server | undefined

/**
 * Minimal stand-in for the two Graph endpoints the vendored provider calls
 * (auth-facebook/service.ts): `GET /v21.0/oauth/access_token` answers the code
 * exchange — only for OUR app id/secret/redirect_uri and this run's code — and
 * `GET /v21.0/me` returns the synthetic profile — only for the token the
 * exchange issued. Anything else is rejected, so a pass proves the backend
 * sent exactly the configured credentials.
 */
function startMockGraph(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_GRAPH_PORT}`)
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }

    if (
      req.method === "GET" &&
      url.pathname === `/${FB_GRAPH_VERSION}/oauth/access_token`
    ) {
      const ok =
        url.searchParams.get("client_id") === MOCK_APP_ID &&
        url.searchParams.get("client_secret") === MOCK_APP_SECRET &&
        url.searchParams.get("redirect_uri") === EXPECTED_REDIRECT_URI &&
        url.searchParams.get("code") === MOCK_CODE
      if (!ok) {
        mockHits.rejected += 1
        return respond(400, { error: { message: "Invalid verification code" } })
      }
      mockHits.token += 1
      return respond(200, {
        access_token: MOCK_ACCESS_TOKEN,
        token_type: "bearer",
        expires_in: 5_183_944,
      })
    }

    if (req.method === "GET" && url.pathname === `/${FB_GRAPH_VERSION}/me`) {
      // The provider sends the token via `Authorization: Bearer` (never the
      // URL — security.md logging rule); the mock accepts nothing else.
      if (req.headers.authorization !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
        mockHits.rejected += 1
        return respond(400, {
          error: { message: "Invalid OAuth access token" },
        })
      }
      mockHits.profile += 1
      return respond(200, {
        id: FB_USER_ID,
        name: FB_USER_NAME,
        email: FB_USER_EMAIL,
      })
    }

    mockHits.rejected += 1
    respond(404, { error: "unknown_mock_path" })
  })

  return new Promise((resolve, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `Mock FB Graph port ${MOCK_GRAPH_PORT} is already in use — ` +
                "is another fb-login.spec run (or a stale process) holding it?"
            )
          : err
      )
    })
    server.listen(MOCK_GRAPH_PORT, "127.0.0.1", () => resolve(server))
  })
}

test.beforeAll(async () => {
  mockGraph = await startMockGraph()
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!mockGraph) return resolve()
    mockGraph.close(() => resolve())
  })
})

// ── Shared helpers (cod/khqr.spec.ts precedents) ──────────────────────────────

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
  "Is the TEST-08 dev seam active? backend/.env needs the dev-mock Facebook " +
  "block (FB_APP_ID/FB_APP_SECRET=dev-mock-*, FB_OAUTH_REDIRECT_URI on the " +
  ":8000 origin, FB_GRAPH_DEV_BASE_URL=http://127.0.0.1:4281) and the backend " +
  "must be restarted after setting it (spec header)."

/**
 * Drive one full Facebook login round-trip through the real user path and
 * return the signed-in customer (the "session returned" proof).
 *
 *  1. `GET /store/auth/facebook` on the :8000 origin — exactly what the
 *     "Continue with Facebook" anchor does — WITHOUT following the redirect,
 *     so the browser never visits facebook.com. The response must be the
 *     dialog 302 (NOT the pub-key 400 → proves the INTEGRATION-06 proxy
 *     injected the key; NOT the 503 → proves the provider is configured) and
 *     sets the `_fb_oauth_state` cookie into this context's jar.
 *  2. Navigate the `?code&state` redirect-back Facebook's consent screen would
 *     trigger. The REAL callback chain runs: state verify (cookie + Redis,
 *     single-use), code exchange + profile via the mock Graph, customer +
 *     identity resolution, session establishment, 302 → /checkout.
 *  3. Read `/store/customers/me` against the backend directly, authenticated
 *     ONLY by the `connect.sid` cookie the callback set — the session proof.
 */
async function completeFacebookLogin(
  page: Page
): Promise<{ id: string; email: string | null; first_name: string | null }> {
  const context = page.context()

  // 1) OAuth start (no publishable key attached — the proxy must inject it).
  const startRes = await context.request.get("/store/auth/facebook", {
    maxRedirects: 0,
  })
  expect(
    startRes.status(),
    `OAuth start returned ${startRes.status()}. ${SEAM_HINT}`
  ).toBe(302)

  const location = startRes.headers()["location"]
  expect(location, "OAuth start 302 had no Location header").toBeTruthy()
  const dialog = new URL(location!)

  // The dialog redirect carries OUR configured app + the locked-down params
  // (BACKEND-05): mock client_id, allowlisted redirect_uri, minimal scopes.
  expect(`${dialog.origin}${dialog.pathname}`).toBe(
    `https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`
  )
  expect(dialog.searchParams.get("client_id")).toBe(MOCK_APP_ID)
  expect(dialog.searchParams.get("redirect_uri")).toBe(EXPECTED_REDIRECT_URI)
  expect(dialog.searchParams.get("scope")).toBe("email,public_profile")
  expect(dialog.searchParams.get("response_type")).toBe("code")
  const state = dialog.searchParams.get("state")
  expect(state, "OAuth start issued no state").toBeTruthy()

  // The browser-binding state cookie is in the jar (path-scoped to the
  // callback), ready for the redirect-back.
  const stateCookie = (await context.cookies()).find(
    (c) => c.name === "_fb_oauth_state"
  )
  expect(stateCookie?.value, "no _fb_oauth_state cookie after start").toBe(
    state
  )

  // 2) The consent redirect-back. On success the callback 302s and the browser
  // lands on /checkout.
  const response = await page.goto(
    `/store/auth/facebook/callback?code=${encodeURIComponent(
      MOCK_CODE
    )}&state=${encodeURIComponent(state!)}`,
    { waitUntil: "domcontentloaded" }
  )
  if (!new URL(page.url()).pathname.startsWith("/checkout")) {
    const body = (await response?.text().catch(() => "")) ?? ""
    throw new Error(
      `Callback did not land on /checkout (got ${page.url()}; body: ` +
        `${body.slice(0, 200)}; mock Graph hits: ${JSON.stringify(
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
 * Facebook user, read from the DB by the read-only dev helper. (No public API
 * exposes them — TEST-04/05 `medusa exec` precedent; see khqr.spec.ts for the
 * Windows shell + injection-guard rationale.)
 */
function verifyIdentityRows(): Array<{
  id: string
  customer_id: string
  provider: string
  provider_user_id: string
}> {
  if (!/^[a-z0-9]+$/.test(FB_USER_ID)) {
    throw new Error("unsafe provider user id — refusing to shell out")
  }
  const verifyOut = execSync(
    `npx medusa exec ./src/scripts/dev-verify-fb-login.ts ${FB_USER_ID}`,
    {
      cwd: BACKEND_DIR,
      encoding: "utf8",
      timeout: 240_000,
      maxBuffer: 10 * 1024 * 1024,
    }
  )
  const marker = verifyOut.match(/FB_LOGIN_VERIFY_RESULT (\{.*\})/)
  expect(
    marker,
    "no FB_LOGIN_VERIFY_RESULT line in medusa exec output"
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

// ── The TEST-08 chain ─────────────────────────────────────────────────────────

/** Set by the first test; the returning-login test must resolve the SAME one. */
let firstLoginCustomerId: string | undefined

test.describe("Facebook login (TEST-08)", () => {
  test("completed login creates the customer, ONE identity row, and a session", async ({
    page,
  }) => {
    // Full OAuth drive + a `medusa exec` boot — generous budget (TEST-04).
    test.setTimeout(420_000)

    const customer = await completeFacebookLogin(page)
    firstLoginCustomerId = customer.id

    // The session resolved the profile the mock Graph issued — a brand-new
    // customer for this run's synthetic Facebook user (BACKEND-05B never links
    // by email).
    expect(customer.email).toBe(FB_USER_EMAIL)
    expect(customer.first_name).toBe(FB_USER_NAME)

    // INTEGRATION-06 acceptance, live: back on /checkout the session prefills
    // the Full Name field (FacebookLogin → getSocialLoginPrefillName). The
    // generous timeout absorbs dev-server compile of the server action.
    await expect(page.locator("#delivery-full-name")).toHaveValue(
      FB_USER_NAME,
      { timeout: 30_000 }
    )

    // Backend truth: EXACTLY ONE customer_social_identity row, linking this
    // run's Facebook user to the customer the session returned.
    const identities = verifyIdentityRows()
    expect(identities).toHaveLength(1)
    expect(identities[0].provider).toBe("facebook")
    expect(identities[0].provider_user_id).toBe(FB_USER_ID)
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

    // A fresh browser state (no cookies) — the same Facebook user coming back.
    await page.context().clearCookies()

    const customer = await completeFacebookLogin(page)

    // Matched by the immutable provider_user_id → the SAME customer, no
    // duplicate account.
    expect(customer.id).toBe(firstLoginCustomerId)

    // And the ledger did not grow: still exactly one identity row.
    const identities = verifyIdentityRows()
    expect(identities).toHaveLength(1)
    expect(identities[0].customer_id).toBe(firstLoginCustomerId)
  })
})
