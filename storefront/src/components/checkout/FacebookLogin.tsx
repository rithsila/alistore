"use client"

import { useEffect, useRef } from "react"

import { retrieveCustomer } from "@lib/data/customer"

/**
 * "Continue with Facebook" optional social sign-in (FRONTEND-17).
 *
 * - Renders a "Continue with Facebook" pill linking to the backend OAuth start
 *   endpoint `/store/auth/facebook` (BACKEND-05). The href is relative on
 *   purpose: the storefront has no public backend origin a client component can
 *   read (`MEDUSA_BACKEND_URL` is server-only), and a same-origin rewrite of
 *   `/store/*` to the Medusa backend — added at INTEGRATION — also keeps the
 *   `SameSite=Strict` session cookie usable. `loginHref` is overridable so that
 *   wiring can point it at an absolute URL if a rewrite isn't used.
 * - Prefills the name on return: after the OAuth round-trip the callback
 *   (BACKEND-05B) establishes the customer session and returns `{ customer }`
 *   (PRD §7). On mount this component reads the current customer via the
 *   existing `retrieveCustomer()` data function and, if one is signed in, emits
 *   the display name through `onPrefillName` for the checkout page to drop into
 *   the Full Name field. Guests (no session) resolve to `null` and nothing is
 *   prefilled.
 *
 * Accent is NOT used: design.md reserves coral for the sale price and the
 * "Pay with KHQR" CTA only — a social-login button is neither, so this is an
 * ink outline pill. No third-party social-button library is introduced
 * (design.md); the project's own pill geometry is reused.
 *
 * Scope note: this task's only deliverable is this component. Mounting it inside
 * the checkout page and binding `onPrefillName` to the form state belongs to the
 * checkout page (FRONTEND-16 / INTEGRATION), which is out of this task's edit
 * surface. Reconciling BACKEND-05's session cookie with the starter's
 * token-auth header (`retrieveCustomer` reads the latter) is likewise an
 * INTEGRATION concern; `retrieveCustomer` is the correct seam to build against.
 */

const DEFAULT_LOGIN_HREF = "/store/auth/facebook"

interface FacebookLoginProps {
  /** Emitted with the customer's display name after a completed FB round-trip. */
  onPrefillName?: (name: string) => void
  /** Backend OAuth start endpoint. Relative by default (same-origin rewrite). */
  loginHref?: string
  className?: string
}

// Ink outline pill (PillButton geometry; ink, never accent).
const BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-pill border border-ink bg-canvas px-6 py-3 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-90"

export default function FacebookLogin({
  onPrefillName,
  loginHref = DEFAULT_LOGIN_HREF,
  className = "",
}: FacebookLoginProps) {
  // Keep the latest callback without re-running the mount-only prefill effect.
  const onPrefillNameRef = useRef(onPrefillName)
  onPrefillNameRef.current = onPrefillName

  useEffect(() => {
    let active = true

    // The FB round-trip is a full navigation, so the customer session (if any)
    // is read once on mount. retrieveCustomer already swallows errors → null.
    void (async () => {
      const customer = await retrieveCustomer()
      if (!active || !customer) {
        return
      }
      const name = [customer.first_name, customer.last_name]
        .filter(Boolean)
        .join(" ")
        .trim()
      if (name) {
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
      Continue with Facebook
    </a>
  )
}
