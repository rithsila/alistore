import TopNav from "../components/layout/TopNav"
import Hero from "../components/layout/Hero"
import BottomBar from "../components/layout/BottomBar"
import CategoryTabs from "../components/product/CategoryTabs"
import ProductGrid from "../components/product/ProductGrid"
import ProductCard from "../components/product/ProductCard"
import { getCatalogProducts, getCategories } from "@lib/medusa"

/**
 * Catalog / home landing page (FRONTEND-09, data-wired in INTEGRATION-01).
 *
 * Composes the storefront landing shell from the existing components:
 * `TopNav` (FRONTEND-04) → `Hero` (FRONTEND-08) → `CategoryTabs` (FRONTEND-07)
 * → `ProductGrid` of `ProductCard`s (FRONTEND-06 / FRONTEND-05)
 * → `BottomBar` (FRONTEND-21, mobile-only cart/checkout bar).
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

        <section className="mx-auto flex max-w-8xl flex-col gap-xl px-4 py-section min-[600px]:px-6">
          <CategoryTabs categories={categories} />

          <ProductGrid>
            {products.map((product) => (
              <ProductCard key={product.productId} {...product} />
            ))}
          </ProductGrid>
        </section>
      </main>

      {/* Mobile-only persistent cart/checkout bar (FRONTEND-21) — normal flow,
          hidden ≥600px inside the component. */}
      <BottomBar />
    </>
  )
}
