"use client"

import { useMemo, useState } from "react"

import type { CatalogCategory, CatalogProduct } from "@lib/medusa"
import FilterSidebar, { type FilterSelection } from "./FilterSidebar"
import ProductGrid from "./ProductGrid"
import ProductCard from "./ProductCard"

/**
 * Client shell that wires `FilterSidebar` to `ProductGrid`.
 *
 * The server component (home page or category page) fetches `products` and
 * `categories` then passes them in. Filter state lives here; every toggle
 * re-runs the predicate against the full `products` array with no network
 * round-trip.
 *
 * Filter semantics:
 *   special.new-arrivals — products tagged "new" in Medusa Admin
 *   special.discount     — products that have an `originalAmount` (on sale)
 *   category             — products whose `categoryHandles` overlaps selection
 *   size                 — products whose `sizes` overlaps selection
 *   color                — products whose `colors` overlaps selection (case-insensitive)
 *
 * When `activeCategory` is set (category route), the sidebar's category section
 * is hidden (all products already belong to that category) and size/colour/
 * special filters still work within the fetched set.
 */

interface CatalogClientProps {
  products: CatalogProduct[]
  categories: CatalogCategory[]
  activeCategory?: string
}

const EMPTY_SELECTION: FilterSelection = {
  special: [],
  category: [],
  size: [],
  color: [],
}

export default function CatalogClient({
  products,
  categories,
  activeCategory,
}: CatalogClientProps) {
  const [selected, setSelected] = useState<FilterSelection>({
    ...EMPTY_SELECTION,
    category: activeCategory ? [activeCategory] : [],
  })

  const sizes = useMemo(() => {
    const all = products.flatMap((p) => p.sizes)
    return Array.from(new Set(all)).map((v) => ({
      value: v.toLowerCase(),
      label: v.toUpperCase(),
    }))
  }, [products])

  const colors = useMemo(() => {
    const all = products.flatMap((p) => p.colors)
    return Array.from(new Set(all)).map((v) => ({
      value: v.toLowerCase(),
      label: v,
    }))
  }, [products])

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.handle, label: c.name })),
    [categories]
  )

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (selected.special.includes("new-arrivals") && !p.isNew) return false

      if (
        selected.special.includes("discount") &&
        p.originalAmount === undefined
      )
        return false

      if (
        selected.category.length > 0 &&
        !selected.category.some((cat) => p.categoryHandles.includes(cat))
      )
        return false

      if (
        selected.size.length > 0 &&
        !selected.size.some((s) => p.sizes.some((ps) => ps.toLowerCase() === s))
      )
        return false

      if (
        selected.color.length > 0 &&
        !selected.color.some((c) =>
          p.colors.some((pc) => pc.toLowerCase() === c)
        )
      )
        return false

      return true
    })
  }, [products, selected])

  return (
    <div className="flex flex-col gap-section small:flex-row small:gap-xl">
      <FilterSidebar
        categories={activeCategory ? [] : categoryOptions}
        sizes={sizes}
        colors={colors}
        onChange={setSelected}
        initialSelection={{ category: activeCategory ? [activeCategory] : [] }}
      />

      <div className="flex-1">
        {filtered.length === 0 ? (
          <p className="py-8 text-base text-mute">
            No products match the selected filters.
          </p>
        ) : (
          <ProductGrid>
            {filtered.map((product) => (
              <ProductCard key={product.productId} {...product} />
            ))}
          </ProductGrid>
        )}
      </div>
    </div>
  )
}
