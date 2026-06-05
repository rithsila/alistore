import { NextRequest, NextResponse } from "next/server"

/**
 * Same-origin Medusa proxy — INTEGRATION-06/06B (OAuth) + INTEGRATION-07 (invoice).
 *
 * The storefront has no middleware by design (flat routing). This single,
 * narrowly-scoped one exists because Medusa gates the entire `/store` namespace
 * behind the `x-publishable-api-key` request header, and a plain *browser
 * navigation* (an `<a>` click or a top-level redirect) can't set that header —
 * nor can a `next.config` rewrite inject it — so those hops would 400
 * ("Publishable API key required"). Two flows are pure browser navigations and
 * therefore need this proxy:
 *
 *  - **Social-login OAuth** (`/store/auth/*`) — the OAuth start + callback are a
 *    series of top-level redirects. Routing them through the storefront origin
 *    is also what makes the backend set its OAuth `state` and `connect.sid`
 *    session cookies on THIS origin, so they survive the redirects and the
 *    post-login `302 → /checkout` lands back here with a session the server can
 *    read (`@lib/auth`).
 *  - **Invoice** (`/store/orders/:id/invoice`) — INTEGRATION-07 links the order
 *    confirmation to the printable invoice (BACKEND-06) as a same-origin `<a>`.
 *    That route is order-token authed (`?token=`), so the only thing this proxy
 *    adds is the (public) publishable key for the browser GET to clear the gate.
 *
 * This middleware rewrites those paths to the Medusa backend on the same
 * (storefront) origin, injecting the publishable key.
 *
 * Security (security.md):
 *  - Only the publishable key is injected — a `NEXT_PUBLIC_*` value that is
 *    public by definition (the admin key / secrets are never touched here).
 *  - The matcher is limited to `/store/auth/*` and the single
 *    `/store/orders/:id/invoice` GET; every other `/store` route (carts,
 *    customers, payments) is called directly by the Medusa SDK, which adds the
 *    key itself, so this proxy never sees that traffic. The invoice route guards
 *    itself with the per-order token (403 on a wrong/missing token), so widening
 *    the matcher to it grants no unauthenticated order access.
 *  - All incoming headers (notably the `_fb_oauth_state` / `connect.sid`
 *    cookies) are forwarded unchanged so the backend's CSRF + session checks
 *    still hold.
 */

const MEDUSA_BACKEND_URL =
  process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

export function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl
  const destination = new URL(`${pathname}${search}`, MEDUSA_BACKEND_URL)

  const requestHeaders = new Headers(req.headers)
  if (PUBLISHABLE_KEY) {
    requestHeaders.set("x-publishable-api-key", PUBLISHABLE_KEY)
  }

  return NextResponse.rewrite(destination, {
    request: { headers: requestHeaders },
  })
}

export const config = {
  matcher: ["/store/auth/:path*", "/store/orders/:id/invoice"],
}
