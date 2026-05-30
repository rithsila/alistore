# Design Rules — apply on every frontend task

Spec lives in `DESIGN.md` at project root. That file is the source of truth for tokens, components, and responsive behavior. This file enforces it.

## Tokens — non-negotiable

* ALWAYS use the named Tailwind tokens defined from `DESIGN.md`: `bg-ink`, `bg-canvas`, `bg-soft-cloud`, `text-ink`, `text-mute`, `text-accent`, `border-hairline`, `rounded-pill`, etc.
* NEVER write arbitrary hex values, RGB values, or off-token Tailwind utilities (`bg-[#abc123]`, `bg-zinc-700`, `text-gray-500`). If a color isn't in `DESIGN.md`, STOP and ask before adding one.
* NEVER use Tailwind's default color ramps (`bg-slate-*`, `text-zinc-*`, `bg-red-500`, etc.). Only the project tokens.
* The accent token is coral `#C0461F`, and it has exactly **two** uses: sale price text, and the "Pay with KHQR" CTA. Nothing else gets accent color without explicit approval.
* Spacing uses the 8px grid (`gap-2`, `p-3`, `p-4`, `p-6` etc.). NEVER use arbitrary spacing (`gap-[7px]`, `p-[13px]`).

## Components — reuse, don't reinvent

* ALWAYS use the primitives in `src/components/ui/` (`PillButton`, `SearchPill`, `Chip`) for buttons, search input, and chips. NEVER write a custom button or chip inline.
* ALWAYS use the product components in `src/components/product/` (`ProductCard`, `ProductGrid`, `VariantPicker`, `FilterSidebar`, `Gallery`, `BuyBox`, `CategoryTabs`). NEVER duplicate their patterns inline.
* If a needed component doesn't exist, STOP and ask — don't invent a new one mid-task. New components are their own task.
* NEVER add a third-party UI library (Shadcn/ui, Material UI, Chakra, etc.). The project has its own primitives mapped to `DESIGN.md` tokens.

## Product images — hard rules

* Product images are ALWAYS `aspect-ratio: 1/1` on `bg-soft-cloud`. No exceptions, no portrait/landscape product tiles in v1.
* ALWAYS use `next/image` with explicit `sizes` for responsive loading. NEVER `<img>` tags for product photos.
* NEVER set a fixed pixel size on a product image — they're driven by the grid.

## Typography

* Latin UI text uses Inter (400 / 500). Display/campaign tier uses Bebas Neue (96px / 0.9 / uppercase).
* ALWAYS use the typography classes derived from `DESIGN.md`'s scale (`heading-xl`, `body-strong`, `caption-sm`, `button-md`, etc.). NEVER use raw `text-[14px]` or arbitrary font weights.
* Body text minimum size is 12px. Never smaller except for the legal/utility row (9px).
* Two font weights only: 400 regular, 500 medium. NEVER 600 or 700.
* v1 is  **English-only** . Don't add Khmer fonts, Khmer fallback stacks, or `lang="km"` attributes until v2.

## Layout & responsive

* ALWAYS use the responsive breakpoints from `DESIGN.md`: 4-up (≥1440) / 3-up (desktop) / 2-up (≤1023) / 1-up (≤599).
* ALWAYS mobile-first — write the smallest layout first, then add breakpoint variants. Test at 360px width before declaring a frontend task done.
* The mobile bottom bar (`BottomBar`) is the persistent cart/checkout pattern. NEVER use `position: fixed`; let it sit in normal flow.
* NEVER add a new top-level navigation entry without updating `TopNav` and `Footer` together.

## Colour mode & decoration

* v1 is  **light-mode only** . Do not add dark-mode variants, `dark:` classes, or color-scheme metadata.
* NEVER add gradients, drop shadows, blur, glow, or decorative effects. The system is deliberately flat; the photography is the visual energy.
* Single hairline divider for separators (`border-hairline`). No multi-pixel borders, no dashed/dotted.

## Icons

* Use a single icon set throughout the storefront — pick one in FRONTEND-01 and stick to it. NEVER mix icon libraries across components.
* Outline style only (no filled variants) to match the editorial restraint of the system.

## Before declaring a frontend task complete — self-check

* [ ] Every color used is a named token from `DESIGN.md`. No arbitrary hex.
* [ ] Every spacing value is on the 8px grid. No arbitrary px values.
* [ ] No new component was invented — only reused or extended.
* [ ] No third-party UI library was added.
* [ ] Product images are 1:1 and use `next/image`.
* [ ] Layout was tested at 360px width.
* [ ] No `dark:` classes, no gradients, no shadows.
* [ ] Accent color appears only on sale price and KHQR CTA.

If any answer is wrong: fix before reporting done.
