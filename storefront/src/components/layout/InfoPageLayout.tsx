import type { ReactNode } from "react"
import TopNav from "./TopNav"

/**
 * Shared frame for the static info pages (FAQ / Delivery / Returns — FRONTEND-23).
 *
 * Renders the top nav and a centered reading column for page content passed as
 * `children`. The site Footer is mounted once globally in the root layout
 * (`app/layout.tsx`), so this layout deliberately does NOT render it — matching
 * the cart/checkout pages, which also render only `TopNav` per page.
 *
 * A Server Component: it has no interactivity of its own and only composes the
 * existing nav (TopNav is a Client Component — a Server Component may render it)
 * with page content.
 *
 * Tokens only (design.md): ink heading, mute body, canvas surface. No accent
 * (reserved for sale price + the KHQR CTA), no shadows/gradients. Inter 400/500.
 * Reading column caps at `max-w-3xl` for comfortable line length; section rhythm
 * uses the 8px-grid `section` (48px) token.
 */
interface InfoPageLayoutProps {
  title: string
  intro?: string
  children: ReactNode
}

export default function InfoPageLayout({
  title,
  intro,
  children,
}: InfoPageLayoutProps) {
  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium leading-tight text-ink">{title}</h1>
        {intro ? (
          <p className="mt-4 text-base font-normal leading-normal text-mute">
            {intro}
          </p>
        ) : null}
        <div className="mt-xl flex flex-col gap-xl">{children}</div>
      </main>
    </>
  )
}
