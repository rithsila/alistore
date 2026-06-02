import Link from "next/link"

/**
 * Site footer (DESIGN.md `footer` / FRONTEND-20).
 *
 * Layout:
 * - `canvas` surface with a single 1px `hairline` top divider.
 * - Four link columns — Help, Delivery, Telegram, Facebook (FRONTEND-20
 *   Requirements). Each column = a `body-strong` ink header over a
 *   `caption-md` mute link list (DESIGN.md `footer`).
 * - A second 1px `hairline` rule below the columns, then the `utility-xs`
 *   copyright fine-print row in `mute`.
 *
 * Typography (no typography utility classes exist in the project, so each tier
 * is expressed via primitives — same convention as TopNav / Hero):
 * - Column header = body-strong (16 / 500) → `text-base font-medium`.
 * - Link = caption-md (14 / 500 / 1.5) → `text-sm font-medium leading-normal`.
 * - Copyright = utility-xs (9 / 500 / 1.75) → `text-[9px] font-medium
 *   leading-[1.75]`. 9px is the explicit legal/fine-print exception to the
 *   12px body minimum (DESIGN.md); it is the exact utility-xs token value, hit
 *   with arbitrary values because no `utility-xs` class exists and this task's
 *   Deliverables don't include `tailwind.config.js` (same pattern as Hero's
 *   `leading-[0.9]`).
 *
 * Presentational Server Component — no client interactivity. The 600 / 1024
 * column breakpoints match the project's 1-up→2-up→4-up convention. Links use
 * placeholder `/` hrefs (real Help/Delivery routes and the Telegram/Facebook
 * channel URLs are not wired yet), consistent with TopNav's placeholder nav.
 */

interface FooterLink {
  label: string
  href: string
}

interface FooterColumn {
  heading: string
  links: FooterLink[]
}

const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    heading: "Help",
    links: [
      { label: "FAQ", href: "/" },
      { label: "Contact Us", href: "/" },
      { label: "Size Guide", href: "/" },
    ],
  },
  {
    heading: "Delivery",
    links: [
      { label: "Delivery Info", href: "/" },
      { label: "Track Order", href: "/" },
      { label: "Returns", href: "/" },
    ],
  },
  {
    heading: "Telegram",
    links: [{ label: "Chat on Telegram", href: "/" }],
  },
  {
    heading: "Facebook",
    links: [{ label: "Visit Facebook", href: "/" }],
  },
]

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-hairline bg-canvas text-mute">
      <div className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <div className="grid grid-cols-1 gap-xl min-[600px]:grid-cols-2 min-[1024px]:grid-cols-4">
          {FOOTER_COLUMNS.map((column) => (
            <nav
              key={column.heading}
              aria-label={column.heading}
              className="flex flex-col gap-4"
            >
              <h2 className="text-base font-medium text-ink">
                {column.heading}
              </h2>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm font-medium leading-normal text-mute transition-opacity hover:opacity-70"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <hr className="my-xl border-0 border-t border-hairline" />

        <p className="text-[9px] font-medium leading-[1.75] text-mute">
          © {year} Ali Store. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
