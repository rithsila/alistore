import TopNav from "../components/layout/TopNav"
import Hero from "../components/layout/Hero"
import BottomBar from "../components/layout/BottomBar"
import CatalogClient from "../components/product/CatalogClient"
import { getCatalogProducts, getCategories } from "@lib/medusa"

/**
 * Catalog / home landing page (FRONTEND-09, data-wired in INTEGRATION-01).
 *
 * Composes the storefront landing shell:
 * `TopNav` → `Hero` → `CatalogClient` (filter sidebar + product grid)
 * → `BottomBar` (mobile-only cart/checkout bar).
 *
 * Server Component — it fetches the real catalog from the Medusa backend via the
 * server-side data layer (`@lib/medusa`) and passes serializable, display-ready
 * props down (the interactive bits, TopNav and CategoryTabs, are their own
 * "use client" components).
 *
 * INTEGRATION-01: products and categories come from the backend (region-priced
 * via `getCatalogProducts` / `getCategories`), replacing the FRONTEND-09
 * placeholder arrays. Product images resolve through the R2 / demo hosts
 * allow-listed in `next.config.js`.
 */

export default async function HomePage() {
  const [products, categories] = await Promise.all([
    getCatalogProducts(),
    getCategories(),
  ])

  return (
    <>
      <TopNav />

      <main>
        <Hero />

        <section className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
          <CatalogClient products={products} categories={categories} />
        </section>
      </main>

      {/* Mobile-only persistent cart/checkout bar (FRONTEND-21) — normal flow,
          hidden ≥600px inside the component. */}
      <BottomBar />
    </>
  )
}
