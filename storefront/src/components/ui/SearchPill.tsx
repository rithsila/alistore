import type { InputHTMLAttributes } from "react"

type SearchPillProps = InputHTMLAttributes<HTMLInputElement>

/**
 * Search input pill (DESIGN.md search-pill / FRONTEND-03).
 * Soft-cloud background, ink text, pill radius, 48px height (≥44px touch
 * target). Focus state follows DESIGN.md search-pill-focused: surface flips
 * to canvas with an ink border (no shadow/glow — design.md).
 *
 * The leading magnifier icon (DESIGN.md) is intentionally omitted: the icon
 * set is chosen in a later task, so wiring an icon here would lock that
 * decision out of scope.
 */
export default function SearchPill({
  className = "",
  type = "search",
  ...props
}: SearchPillProps) {
  const base =
    "h-12 w-full rounded-pill border-2 border-transparent bg-soft-cloud px-4 text-base font-normal leading-normal text-ink outline-none placeholder:text-mute focus:border-ink focus:bg-canvas"

  return (
    <input type={type} className={`${base} ${className}`.trim()} {...props} />
  )
}
