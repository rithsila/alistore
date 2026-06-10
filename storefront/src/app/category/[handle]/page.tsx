import TopNav from "../../../components/layout/TopNav"
import CatalogClient from "../../../components/product/CatalogClient"
import { getCategoryProducts } from "@lib/medusa"

/**
 * Per-category product listing (FRONTEND-10, data-wired in INTEGRATION-01) —
 * route `/category/[handle]`.
 *
 * Server Component: reads the route `handle`, fetches that category and its
 * region-priced products from the Medusa backend via `@lib/medusa`, and renders
 * the result in a `ProductGrid` beside the `FilterSidebar` (FRONTEND-11) — a
 * left rail on desktop, a "Filters" drawer on mobile (the sidebar handles that
 * responsive split itself).
 *
 * INTEGRATION-01: products come from the backend, replacing the FRONTEND-10
 * placeholder arrays. An unknown handle renders a heading-only empty state.
 *
 * Scope notes:
 * - `TopNav` is composed here for navigable page chrome, matching the
 *   FRONTEND-09 precedent (pages render their own nav).
 * - The sidebar's own multi-select filters are interactive within the component
 *   but are not wired to re-filter this server-rendered grid; the grid is the
 *   route category's products, which is what the listing requires. Cross-filter
 *   wiring is out of scope for this task.
 */

interface CategoryPageProps {
  params: Promise<{ handle: string }>
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { handle } = await params

  const category = await getCategoryProducts(handle)
  const categoryName = category?.name ?? handle
  const products = category?.products ?? []

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">
          {categoryName}
        </h1>

        <div className="mt-section">
          <CatalogClient
            products={products}
            categories={[]}
            activeCategory={handle}
          />
        </div>
      </main>
    </>
  )
}
