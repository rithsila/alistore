/**
 * Currency flag glyphs for the nav toggle (FRONTEND-04).
 *
 * USD → United States flag, KHR → Cambodia flag. Rendered as inline SVG (not
 * emoji) so the flags display identically on every device — including Windows
 * desktops, where emoji regional-indicator flags fall back to plain letters.
 *
 * The fills are simplified national-flag colours: they are image content (the
 * same status as product photography), not chrome — so they sit outside the
 * DESIGN.md token system on purpose. The toggle's `aria-label` names the
 * currency, so each flag is decorative (`aria-hidden`).
 */

import type { Currency } from "@lib/price"

interface CurrencyFlagProps {
  currency: Currency
  /** Sizing/utility classes (height drives the width via the fixed ratio). */
  className?: string
}

/** United States — 13 red/white stripes, blue canton with a star field. */
function UsFlag({ className }: { className?: string }) {
  const stripe = 14 / 13
  // Red stripes sit on the even rows (top stripe red), 7 in total.
  const redStripes = [0, 2, 4, 6, 8, 10, 12].map((row) => row * stripe)
  // A light star field for the canton (decorative, not the literal 50).
  const starRows = [1.5, 3.4, 5.3]
  const starCols = [1.3, 3.0, 4.7, 6.4]

  return (
    <svg
      viewBox="0 0 20 14"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="20" height="14" fill="#ffffff" />
      {redStripes.map((y) => (
        <rect key={y} x="0" y={y} width="20" height={stripe} fill="#b22234" />
      ))}
      <rect x="0" y="0" width="8" height={7 * stripe} fill="#3c3b6e" />
      {starRows.map((cy) =>
        starCols.map((cx) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.32" fill="#ffffff" />
        ))
      )}
    </svg>
  )
}

/** Cambodia — blue/red/blue bands (1:2:1) with a white Angkor Wat. */
function KhFlag({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 14"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="20" height="14" fill="#032ea1" />
      <rect x="0" y="3.5" width="20" height="7" fill="#e00025" />
      <g fill="#ffffff">
        {/* Three spires of the temple, central one tallest. */}
        <path d="M10 4.2 L10.5 5.2 L10.5 8.6 L9.5 8.6 L9.5 5.2 Z" />
        <path d="M7.4 5.6 L7.8 6.4 L7.8 8.6 L7.0 8.6 L7.0 6.4 Z" />
        <path d="M12.6 5.6 L13.0 6.4 L13.0 8.6 L12.2 8.6 L12.2 6.4 Z" />
        {/* Tiered base. */}
        <rect x="6.4" y="8.6" width="7.2" height="0.6" />
        <rect x="7.0" y="9.2" width="6.0" height="0.5" />
      </g>
    </svg>
  )
}

export default function CurrencyFlag({
  currency,
  className,
}: CurrencyFlagProps) {
  return currency === "USD" ? (
    <UsFlag className={className} />
  ) : (
    <KhFlag className={className} />
  )
}
