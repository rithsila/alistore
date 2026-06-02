import type { ButtonHTMLAttributes } from "react"

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state: active = ink fill, inactive = hairline border. */
  active?: boolean
}

/**
 * Selectable pill chip (DESIGN.md filter-chip / FRONTEND-03).
 * Active = ink fill with canvas text; inactive = canvas with a 1px hairline
 * border and ink text. Pill radius, button-md type, 44px height (≥44px touch
 * target).
 */
export default function Chip({
  active = false,
  className = "",
  type = "button",
  children,
  ...props
}: ChipProps) {
  const base =
    "inline-flex h-11 items-center justify-center rounded-pill px-4 text-base font-medium leading-normal transition-colors"
  const variant = active
    ? "bg-ink text-canvas"
    : "border border-hairline bg-canvas text-ink"

  return (
    <button
      type={type}
      aria-pressed={active}
      className={`${base} ${variant} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  )
}
