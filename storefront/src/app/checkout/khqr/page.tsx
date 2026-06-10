"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { ArrowPath, ArrowUpRightOnBox, Spinner } from "@medusajs/icons"

import TopNav from "../../../components/layout/TopNav"
import PillButton from "../../../components/ui/PillButton"
import { startKhqr, pollKhqrStatus, type KhqrSession } from "@lib/checkout"

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
 * Data wiring (INTEGRATION-05): the live `POST /store/payments/khqr/start` and
 * `GET /store/payments/khqr/status` calls live in `src/lib/checkout.ts` and are
 * imported here as `startKhqr` / `pollKhqrStatus` (server actions). Their return
 * shapes (`KhqrSession` / status union) match the BACKEND-03 / BACKEND-03B
 * contracts the screen was built against, so the countdown / poll / redirect
 * logic below is unchanged. `paid` is reported only by the server after its own
 * Bakong verify (security.md) — the screen never fabricates payment status.
 */

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
const QR_SIZE = 240

/**
 * Official Bakong / NBC brand red — not a project design token (DESIGN.md).
 * Used only on the KHQR card header to match the Bakong payment brand identity.
 */
const KHQR_RED = "#D0021B"

/**
 * Official KHQR center mark (downloaded from bsthen/bakong-khqr sdk/assets).
 * Served from /public/images — excavate: true keeps surrounding modules intact.
 */
const KHQR_MARK_URI = "/images/khqr-mark.png"

/**
 * Optional merchant display name shown on the KHQR card.
 * Set `NEXT_PUBLIC_KHQR_MERCHANT_NAME` in `.env` to the Bakong-registered name.
 */
const KHQR_MERCHANT_NAME = process.env.NEXT_PUBLIC_KHQR_MERCHANT_NAME ?? ""

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

            {/* ── KHQR branded card (matches official Bakong card design) ── */}
            <div className="w-full overflow-hidden rounded-large border border-hairline bg-canvas">
              {/* Red header — official KHQR logo, centred */}
              <div
                className="flex items-center justify-center px-4 py-3"
                style={{ backgroundColor: KHQR_RED }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/images/khqr-logo.png"
                  alt="KHQR"
                  className="h-7 w-auto"
                />
              </div>

              {/* Card body — centred */}
              <div className="px-4 pt-3 text-center">
                {/* Merchant name */}
                {KHQR_MERCHANT_NAME && (
                  <p className="text-sm font-medium text-ink">
                    {KHQR_MERCHANT_NAME}
                  </p>
                )}

                {/* Amount + currency */}
                <p className="mt-1 text-lg font-medium text-ink">
                  {session.amount.toFixed(2)}{" "}
                  <span className="text-sm font-medium">
                    {session.currency.toUpperCase()}
                  </span>
                </p>

                {/* Dotted separator */}
                <div className="mt-3 border-t border-dashed border-hairline" />

                {/* QR code with official KHQR center mark */}
                <div className="flex items-center justify-center py-4">
                  <QRCodeSVG
                    value={session.qr}
                    title="KHQR payment code"
                    size={QR_SIZE}
                    level="M"
                    marginSize={2}
                    bgColor={QR_CANVAS}
                    fgColor={QR_INK}
                    imageSettings={{
                      src: KHQR_MARK_URI,
                      height: 44,
                      width: 44,
                      excavate: true,
                    }}
                  />
                </div>
              </div>
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
