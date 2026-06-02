import PillButton from "../ui/PillButton"

/**
 * Editorial campaign hero band (DESIGN.md campaign-tile / FRONTEND-08).
 *
 * A `soft-cloud` band carrying a caption-sm uppercase eyebrow, a display-tier
 * Bebas headline, and the "Shop now" `PillButton`. The lockup stacks
 * vertically on mobile and lays out horizontally on desktop (headline block at
 * the start, CTA at the end of the row).
 *
 * Typography (no `display-campaign` utility class exists in the project, so the
 * tier is expressed via primitives, as FRONTEND-02 anticipated):
 * - Eyebrow = caption-sm (12 / 500 / 1.5) uppercase → `text-xs font-medium`.
 * - Headline = Bebas tier, uppercase, line-height 0.9 (DESIGN.md), scaling
 *   48px (mobile) → 96px (desktop). The Bebas family is applied via the
 *   `--font-bebas-neue` CSS variable loaded in `lib/fonts.ts`; weight is the
 *   font's native 400 (Bebas ships a single weight).
 *
 * Presentational Server Component — no client interactivity. The 600px
 * stack/horizontal boundary matches DESIGN.md's 1-up (≤599) breakpoint, hit
 * with the `min-[600px]:` arbitrary variant (same convention as TopNav).
 */

interface HeroProps {
  /** Caption-sm uppercase eyebrow above the headline. */
  eyebrow?: string
  /** Display-tier campaign headline (rendered uppercase). */
  headline?: string
}

export default function Hero({
  eyebrow = "New Season",
  headline = "Own The Season",
}: HeroProps) {
  return (
    <section className="bg-soft-cloud">
      <div className="mx-auto flex max-w-8xl flex-col gap-xl px-4 py-section min-[600px]:flex-row min-[600px]:items-end min-[600px]:justify-between min-[600px]:px-6">
        <div className="flex flex-col gap-4">
          <span className="text-xs font-medium uppercase leading-normal text-ink">
            {eyebrow}
          </span>
          <h1 className="font-[family-name:var(--font-bebas-neue)] text-5xl uppercase leading-[0.9] text-ink min-[600px]:text-8xl">
            {headline}
          </h1>
        </div>

        <PillButton>Shop now</PillButton>
      </div>
    </section>
  )
}
