"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { User } from "@medusajs/icons"

import { getAccountMenuState } from "@lib/account"
import { logout } from "@lib/data/customer"

/**
 * Account affordance in the primary nav (replaces the former dead button).
 * Signed out → a framed popover: a "Sign in" heading + benefit line above the
 * social providers (login-from-nav uses `?intent=account` so the OAuth callback
 * returns to /account), so the menu reads as designed rather than a bare two-link
 * stub (FRONTEND-29). A guest "Track your order" entry is deferred until the
 * TRACK phase (TRACK-04) ships the `/track` page — omitted here until then, never
 * pointed at `/`. Signed in → account links + logout. State is read once on mount
 * via the `getAccountMenuState` server action, the `FacebookLogin` precedent.
 *
 * design.md: ink only (no accent — accent is reserved for sale price + KHQR),
 * single hairline border, no shadow. Provider links are relative/same-origin so
 * the `/store/auth/*` proxy injects the publishable key and keeps the cookies on
 * this origin.
 */

const ICON_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70"

const MENU_LINK =
  "block px-4 py-3 text-base font-medium leading-normal text-ink transition-opacity hover:opacity-70"

const PROVIDERS: readonly { label: string; href: string }[] = [
  {
    label: "Continue with Facebook",
    href: "/store/auth/facebook?intent=account",
  },
  { label: "Continue with Google", href: "/store/auth/google?intent=account" },
]

export default function AccountMenu() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<{ name: string } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Mount-only: reflects the session present when the nav loaded.
  useEffect(() => {
    let active = true
    void (async () => {
      const next = await getAccountMenuState()
      if (active) setState(next)
    })()
    return () => {
      active = false
    }
  }, [])

  // Close on Escape / outside click while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onClick)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={ICON_BUTTON}
      >
        <User className="h-6 w-6" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 border border-hairline bg-canvas py-2"
        >
          {state ? (
            <>
              <p className="px-4 py-2 text-xs font-medium leading-normal text-mute">
                Signed in as {state.name}
              </p>
              <Link href="/account" role="menuitem" className={MENU_LINK}>
                Account
              </Link>
              <Link
                href="/account/profile"
                role="menuitem"
                className={MENU_LINK}
              >
                Profile
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  role="menuitem"
                  className={`${MENU_LINK} w-full text-left`}
                >
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="px-4 py-2">
                <p className="text-base font-medium leading-normal text-ink">
                  Sign in
                </p>
                <p className="text-xs font-normal leading-normal text-mute">
                  Faster checkout and your order history
                </p>
              </div>
              <div className="flex flex-col gap-1 px-2">
                {PROVIDERS.map((p) => (
                  <a
                    key={p.href}
                    href={p.href}
                    role="menuitem"
                    className={MENU_LINK}
                  >
                    {p.label}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
