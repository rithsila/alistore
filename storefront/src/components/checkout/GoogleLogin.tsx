"use client"

import { useEffect, useRef } from "react"

import { getSocialLoginPrefillName } from "@lib/auth"

/**
 * "Continue with Google" optional social sign-in (FRONTEND-17B; wired in
 * INTEGRATION-06B).
 *
 * Direct mirror of `FacebookLogin` (FRONTEND-17) — same placement/pattern, only
 * the OAuth start endpoint differs.
 *
 * - Renders a "Continue with Google" pill linking to the backend OAuth start
 *   endpoint `/store/auth/google` (BACKEND-05C). The href is relative on
 *   purpose: the storefront has no public backend origin a client component can
 *   read (`MEDUSA_BACKEND_URL` is server-only), and the same-origin rewrite of
 *   `/store/auth/*` to the Medusa backend (`src/middleware.ts`, INTEGRATION-06)
 *   keeps the OAuth `state` + session cookies on the storefront origin.
 *   `loginHref` is overridable so wiring can point it elsewhere if needed.
 * - Prefills the name on return: after the OAuth round-trip the Google callback
 *   (BACKEND-05D) establishes the customer session and 302-redirects back to
 *   `/checkout`. On mount this component reads the signed-in customer via the
 *   shared `getSocialLoginPrefillName()` (`@lib/auth`) — which resolves the
 *   session (`connect.sid` and/or JWT) server-side — and, if one exists, emits
 *   the display name through `onPrefillName` for the checkout page to drop into
 *   the Full Name field. Guests resolve to `null` and nothing is prefilled.
 *
 * INTEGRATION-06B reconciles BACKEND-05D's session cookie with the prefill read:
 * the callback establishes a `connect.sid` session (no `_medusa_jwt`), so the
 * starter's token-only `retrieveCustomer` would return nothing — this component
 * reuses the session-aware `getSocialLoginPrefillName()` shared with Facebook
 * (`@lib/auth`), per the "reuse, do not fork" requirement.
 *
 * Accent is NOT used: design.md reserves coral for the sale price and the
 * "Pay with KHQR" CTA only — a social-login button is neither, so this is an
 * ink outline pill. No third-party social-button library is introduced
 * (design.md); the project's own pill geometry is reused.
 */

const DEFAULT_LOGIN_HREF = "/store/auth/google"

interface GoogleLoginProps {
  /** Emitted with the customer's display name after a completed Google round-trip. */
  onPrefillName?: (name: string) => void
  /** Backend OAuth start endpoint. Relative by default (same-origin rewrite). */
  loginHref?: string
  className?: string
}

// Ink outline pill (PillButton geometry; ink, never accent).
const BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-pill border border-ink bg-canvas px-6 py-3 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-90"

export default function GoogleLogin({
  onPrefillName,
  loginHref = DEFAULT_LOGIN_HREF,
  className = "",
}: GoogleLoginProps) {
  // Keep the latest callback without re-running the mount-only prefill effect.
  const onPrefillNameRef = useRef(onPrefillName)
  onPrefillNameRef.current = onPrefillName

  useEffect(() => {
    let active = true

    // The Google round-trip is a full navigation, so the customer session (if
    // any) is read once on mount. getSocialLoginPrefillName swallows errors → null.
    void (async () => {
      const name = await getSocialLoginPrefillName()
      if (active && name) {
        onPrefillNameRef.current?.(name)
      }
    })()

    return () => {
      active = false
    }
    // Mount-only: the prefill reflects the session present when the page loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <a href={loginHref} className={`${BUTTON} ${className}`.trim()}>
      Continue with Google
    </a>
  )
}
