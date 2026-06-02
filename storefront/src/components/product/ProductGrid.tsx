/**
 * Responsive product grid (DESIGN.md PLP grid / FRONTEND-06).
 *
 * Reflows column count at the DESIGN.md breakpoints:
 *   - 1-up  at  ≤599px   (mobile, base)
 *   - 2-up  at  ≥600px   (mobile-landscape / small tablet)
 *   - 3-up  at  ≥1024px  (desktop)
 *   - 4-up  at  ≥1440px  (desktop-large)
 *
 * These pixel boundaries match `ProductCard`'s `IMAGE_SIZES` (1440 / 1024 /
 * 600) so the image `sizes` hint stays in lock-step with the rendered column
 * width. No named breakpoint tokens exist in `tailwind.config.js`, so the exact
 * pixel boundaries are hit with Tailwind's `min-[Npx]:` arbitrary variants
 * (same approach as TopNav / FRONTEND-04).
 *
 * Gutters use `gap-2` (8px) — on the 8px spacing grid (DESIGN.md PLP gutter).
 *
 * Purely presentational layout container: it owns only the grid; callers pass
 * `ProductCard`s (or any tiles) as children.
 */

import type { ReactNode } from "react"

interface ProductGridProps {
  /** Product tiles to lay out — typically `ProductCard` elements. */
  children: ReactNode
}

export default function ProductGrid({ children }: ProductGridProps) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[600px]:grid-cols-2 min-[1024px]:grid-cols-3 min-[1440px]:grid-cols-4">
      {children}
    </div>
  )
}
