import type { ButtonHTMLAttributes } from "react"

type PillButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Primary CTA pill (DESIGN.md button-primary / FRONTEND-03).
 * Ink background, canvas (white) text, button-md type (16px / 500 / 1.5),
 * 48px height, 12×24 padding, pill radius. 48px height also meets the
 * ≥44px touch-target floor.
 */
export default function PillButton({
  className = "",
  type = "button",
  children,
  ...props
}: PillButtonProps) {
  const base =
    "inline-flex h-12 items-center justify-center rounded-pill bg-ink px-6 py-3 text-base font-medium leading-normal text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

  return (
    <button type={type} className={`${base} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}
