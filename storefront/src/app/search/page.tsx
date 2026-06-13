import TopNav from "../../components/layout/TopNav"
import SearchBox from "../../components/layout/SearchBox"
import ProductGrid from "../../components/product/ProductGrid"
import ProductCard from "../../components/product/ProductCard"
import { searchProducts } from "@lib/medusa"

/**
 * Product search results (FRONTEND-23) — route `/search`.
 *
 * Server Component that mirrors the `category/[handle]` shell (own `TopNav` +
 * `max-w-8xl` main). Reads the `q` search param, runs the keyword match via
 * `@lib/medusa`'s `searchProducts`, and renders the result in the same
 * `ProductGrid` / `ProductCard` the catalog uses. A prefilled `SearchBox` sits
 * at the top so the query can be refined in place (it submits back to this
 * route). Three states: empty query → prompt; query with no matches → empty
 * copy; query with matches → grid. `q` is React-escaped wherever it is echoed.
 *
 * Submit-based search only — no "search-as-you-type" (PRD §2, v2-deferred) and
 * no filter sidebar in v1 (clean fast-follow).
 */

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams
  const raw = Array.isArray(params.q) ? params.q[0] ?? "" : params.q ?? ""
  const query = raw.trim()

  const products = query ? await searchProducts(query) : []

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <SearchBox key={query} defaultValue={query} className="max-w-xl" />

        <h1 className="mt-section text-3xl font-medium uppercase text-ink">
          {query ? <>Results for &ldquo;{query}&rdquo;</> : "Search"}
        </h1>

        <div className="mt-section">
          {query === "" ? (
            <p className="text-base text-mute">Search for products by name.</p>
          ) : products.length === 0 ? (
            <p className="text-base text-mute">
              No products match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <ProductGrid>
              {products.map((product) => (
                <ProductCard key={product.productId} {...product} />
              ))}
            </ProductGrid>
          )}
        </div>
      </main>
    </>
  )
}
