"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { ArrowPath, ArrowUpRightOnBox, Spinner } from "@medusajs/icons"

import TopNav from "../../../components/layout/TopNav"
import PillButton from "../../../components/ui/PillButton"

/**
 * KHQR pay screen (FRONTEND-18) — route `/checkout/khqr`.
 *
 * Shows the Bakong dynamic QR for the started payment, a live countdown to its
 * `expires_at`, and (when the proxy returned one) a "Pay with KHQR" deeplink
 * that opens the customer's banking app. While the QR is live the screen
 * auto-polls payment status; on `paid` it routes to the order confirmation
 * (FRONTEND-19), and when the QR window passes it reveals a "Regenerate" action.
 *
 * Client Component: the countdown, the status polling, and regenerate are all
 * interactive local state (Stack.md sanctions `"use client"` for KHQR polling).
 *
 * The coral accent appears exactly once here — on the "Pay with KHQR" deeplink
 * CTA — which is one of the two sanctioned accent uses in design.md. Every other
 * control (Regenerate, retry) stays on ink.
 *
 * Scope (matches the checkout page's FRONTEND-16 placeholder precedent): this
 * task delivers the SCREEN. The live `POST /store/payments/khqr/start` and
 * `GET /store/payments/khqr/status` calls are wired in INTEGRATION-05
 * (`src/lib/checkout.ts`). Until then the two seam functions below drive the
 * screen with a sample session and a perpetually-"pending" status — never a
 * fabricated "paid" (security.md: `paid` only after server verify). Their return
 * shapes already match the BACKEND-03 / BACKEND-03B contracts, so INTEGRATION-05
 * only has to replace the two function bodies with `@lib/checkout` imports.
 */

// ── INTEGRATION-05 seam ──────────────────────────────────────────────────────

/** `POST /store/payments/khqr/start` response shape (BACKEND-03). */
interface KhqrSession {
  qr: string
  deeplink: string | null
  reference: string
  expires_at: string | null
}

/** `GET /store/payments/khqr/status` response shape (BACKEND-03B). */
type KhqrStatus =
  | { status: "pending" }
  | { status: "paid"; order_id: string; invoice_token?: string }
  | { status: "expired" }

/** Placeholder QR window until the backend's real `expires_at` is wired. */
const PLACEHOLDER_WINDOW_MINUTES = 3

/**
 * Sample EMVCo KHQR payload so the screen renders a real, scannable symbol
 * before INTEGRATION-05 supplies the live one. Not a valid Bakong account — it
 * only exercises the renderer/countdown. INTEGRATION-05 replaces this with the
 * `/khqr/start` call (`src/lib/checkout.ts`).
 */
function startKhqr(): Promise<KhqrSession> {
  const expiresAt = new Date(
    Date.now() + PLACEHOLDER_WINDOW_MINUTES * 60 * 1000
  ).toISOString()
  return Promise.resolve({
    qr: "00020101021229180014alistore@aclb52045999530384054031.005802KH5909Ali Store6010Phnom Penh62150111ALISTORE-DEMO6304",
    deeplink: null,
    reference: "00000000000000000000000000000000",
    expires_at: expiresAt,
  })
}

/**
 * Placeholder status poll. Always "pending" in sandbox — the screen never
 * fabricates a "paid" (security.md: status is server-verified only).
 * INTEGRATION-05 replaces this with the `/khqr/status?reference=` call.
 */
function pollKhqrStatus(_reference: string): Promise<KhqrStatus> {
  return Promise.resolve({ status: "pending" })
}

// ── Screen ───────────────────────────────────────────────────────────────────

/**
 * Poll cadence. 3s matches the status endpoint's server-side verify cache TTL
 * (BACKEND-03B) — 20 polls/min, well under its 60/min/reference rate limit.
 */
const POLL_INTERVAL_MS = 3_000

type Phase = "loading" | "pending" | "expired" | "paid" | "error"

/** QR symbol colours — the DESIGN.md `ink`/`canvas` tokens. Passed as literal
 *  values because qrcode.react renders to SVG and cannot consume Tailwind
 *  classes; high contrast on white keeps the code reliably scannable. */
const QR_INK = "#111111"
const QR_CANVAS = "#ffffff"
const QR_SIZE = 256

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export default function KhqrPayPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [session, setSession] = useState<KhqrSession | null>(null)
  const [remainingMs, setRemainingMs] = useState<number | null>(null)

  const start = useCallback(async () => {
    setPhase("loading")
    setSession(null)
    setRemainingMs(null)
    try {
      const next = await startKhqr()
      setSession(next)
      setRemainingMs(
        next.expires_at ? Date.parse(next.expires_at) - Date.now() : null
      )
      setPhase("pending")
    } catch {
      setPhase("error")
    }
  }, [])

  // Start a QR on mount.
  useEffect(() => {
    void start()
  }, [start])

  // Live countdown; flips to "expired" when the QR window closes.
  useEffect(() => {
    if (phase !== "pending" || !session?.expires_at) {
      return
    }
    const expiresAtMs = Date.parse(session.expires_at)
    const tick = () => {
      const ms = expiresAtMs - Date.now()
      if (ms <= 0) {
        setRemainingMs(0)
        setPhase("expired")
        return
      }
      setRemainingMs(ms)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [phase, session?.expires_at])

  // Auto-poll payment status while the QR is live.
  useEffect(() => {
    if (phase !== "pending" || !session?.reference) {
      return
    }
    const reference = session.reference
    let active = true
    let inFlight = false
    const poll = async () => {
      if (inFlight) {
        return
      }
      inFlight = true
      try {
        const result = await pollKhqrStatus(reference)
        if (!active) {
          return
        }
        if (result.status === "paid") {
          setPhase("paid")
          router.push(`/order/${result.order_id}`)
        } else if (result.status === "expired") {
          setPhase("expired")
        }
      } catch {
        // Transient — the status endpoint is idempotent, so keep polling.
      } finally {
        inFlight = false
      }
    }
    const id = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [phase, session?.reference, router])

  return (
    <>
      <TopNav />

      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">
          Pay with KHQR
        </h1>

        {phase === "loading" && (
          <div className="mt-section flex flex-col items-center gap-3 text-mute">
            <Spinner className="h-6 w-6 animate-spin" />
            <p className="text-base font-medium leading-normal">
              Generating your QR…
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-section flex flex-col items-center gap-4">
            <p className="text-base font-medium leading-normal text-ink">
              We couldn’t start your payment.
            </p>
            <p className="text-xs font-medium leading-normal text-mute">
              Please try again in a moment.
            </p>
            <PillButton onClick={() => void start()}>Try again</PillButton>
          </div>
        )}

        {phase === "expired" && (
          <div className="mt-section flex flex-col items-center gap-4">
            <p className="text-base font-medium leading-normal text-ink">
              This QR has expired.
            </p>
            <p className="text-xs font-medium leading-normal text-mute">
              Generate a fresh code to continue your payment.
            </p>
            <PillButton onClick={() => void start()}>
              <ArrowPath className="mr-2 h-5 w-5" />
              Regenerate QR
            </PillButton>
          </div>
        )}

        {phase === "paid" && (
          <div className="mt-section flex flex-col items-center gap-3 text-mute">
            <Spinner className="h-6 w-6 animate-spin" />
            <p className="text-base font-medium leading-normal">
              Payment confirmed — redirecting…
            </p>
          </div>
        )}

        {phase === "pending" && session && (
          <div className="mt-section flex w-full flex-col items-center gap-6">
            <p className="text-center text-base font-medium leading-normal text-mute">
              Scan with any Cambodian banking app, or tap the button to pay.
            </p>

            <div className="rounded-large border border-hairline bg-canvas p-6">
              <QRCodeSVG
                value={session.qr}
                title="Bakong KHQR payment code"
                size={QR_SIZE}
                level="M"
                marginSize={2}
                bgColor={QR_CANVAS}
                fgColor={QR_INK}
              />
            </div>

            {remainingMs !== null && (
              <p
                aria-live="polite"
                className="text-base font-medium leading-normal text-ink"
              >
                Expires in{" "}
                <span className="tabular-nums">
                  {formatCountdown(remainingMs)}
                </span>
              </p>
            )}

            {/* The one sanctioned accent CTA (design.md): "Pay with KHQR". */}
            {session.deeplink && (
              <a
                href={session.deeplink}
                className="inline-flex h-12 w-full items-center justify-center rounded-pill bg-accent px-6 py-3 text-base font-medium leading-normal text-canvas transition-opacity hover:opacity-90"
              >
                <ArrowUpRightOnBox className="mr-2 h-5 w-5" />
                Pay with KHQR
              </a>
            )}

            <div className="flex items-center gap-2 text-mute">
              <Spinner className="h-4 w-4 animate-spin" />
              <span className="text-xs font-medium leading-normal">
                Waiting for payment… keep this screen open.
              </span>
            </div>
          </div>
        )}
      </main>
    </>
  )
}
