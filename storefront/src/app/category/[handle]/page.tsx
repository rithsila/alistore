import TopNav from "../../../components/layout/TopNav"
import FilterSidebar from "../../../components/product/FilterSidebar"
import ProductGrid from "../../../components/product/ProductGrid"
import ProductCard from "../../../components/product/ProductCard"

/**
 * Per-category product listing (FRONTEND-10) — route `/category/[handle]`.
 *
 * Server Component: reads the route `handle`, filters the placeholder catalog
 * to that category, and renders the result in a `ProductGrid` beside the
 * `FilterSidebar` (FRONTEND-11) — a left rail on desktop, a "Filters" drawer on
 * mobile (the sidebar handles that responsive split itself).
 *
 * Placeholder data, per the FRONTEND-09 pattern: product images use the Medusa
 * demo bucket already allow-listed in `next.config.js`, and each product
 * carries a `categoryHandle` so the grid can be filtered to the route category.
 *
 * Scope notes:
 * - `TopNav` is composed here for navigable page chrome, matching the
 *   FRONTEND-09 precedent (pages render their own nav; there is no shared
 *   app-layout providing it).
 * - The sidebar's own multi-select filters are interactive within the
 *   component but are not wired to re-filter this server-rendered grid; the
 *   grid is filtered by the route category, which is what the acceptance
 *   criterion ("renders only that category's products") requires. Cross-filter
 *   wiring would make this a client page and is out of scope.
 */

interface PlaceholderProduct {
  productId: string
  name: string
  imageSrc: string
  imageAlt: string
  price: string
  originalPrice?: string
  categoryHandle: string
}

// Category handle → display name (mirrors the SETUP-09 seed, English v1).
const CATEGORY_NAMES: Record<string, string> = {
  "t-shirt": "T-shirt",
  polo: "Polo",
  outerwear: "Outerwear",
  hoodie: "Hoodie",
  pants: "Pants",
  accessories: "Accessories",
}

// Demo images from the Medusa public bucket allow-listed in next.config.js.
const DEMO_IMAGE_HOST =
  "https://medusa-public-images.s3.eu-west-1.amazonaws.com"

const PLACEHOLDER_PRODUCTS: readonly PlaceholderProduct[] = [
  {
    productId: "AS-1001",
    name: "Classic Tee",
    imageSrc: `${DEMO_IMAGE_HOST}/tee-black-front.png`,
    imageAlt: "Black classic cotton t-shirt, front view",
    price: "$29.00",
    categoryHandle: "t-shirt",
  },
  {
    productId: "AS-1002",
    name: "Essential Tee",
    imageSrc: `${DEMO_IMAGE_HOST}/tee-white-front.png`,
    imageAlt: "White essential cotton t-shirt, front view",
    price: "$29.00",
    categoryHandle: "t-shirt",
  },
  {
    productId: "AS-1003",
    name: "Graphic Tee",
    imageSrc: `${DEMO_IMAGE_HOST}/tee-black-back.png`,
    imageAlt: "Black graphic cotton t-shirt, back view",
    price: "$32.00",
    originalPrice: "$42.00",
    categoryHandle: "t-shirt",
  },
  {
    productId: "AS-2001",
    name: "Vintage Hoodie",
    imageSrc: `${DEMO_IMAGE_HOST}/sweatshirt-vintage-front.png`,
    imageAlt: "Vintage hoodie, front view",
    price: "$59.00",
    originalPrice: "$79.00",
    categoryHandle: "hoodie",
  },
  {
    productId: "AS-2002",
    name: "Pullover Hoodie",
    imageSrc: `${DEMO_IMAGE_HOST}/sweatshirt-vintage-back.png`,
    imageAlt: "Pullover hoodie, back view",
    price: "$64.00",
    categoryHandle: "hoodie",
  },
  {
    productId: "AS-3001",
    name: "Relaxed Sweatpants",
    imageSrc: `${DEMO_IMAGE_HOST}/sweatpants-gray-front.png`,
    imageAlt: "Gray relaxed-fit sweatpants, front view",
    price: "$49.00",
    categoryHandle: "pants",
  },
  {
    productId: "AS-3002",
    name: "Summer Shorts",
    imageSrc: `${DEMO_IMAGE_HOST}/shorts-vintage-front.png`,
    imageAlt: "Vintage summer shorts, front view",
    price: "$35.00",
    originalPrice: "$45.00",
    categoryHandle: "pants",
  },
]

interface CategoryPageProps {
  params: Promise<{ handle: string }>
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { handle } = await params

  const categoryName = CATEGORY_NAMES[handle] ?? handle
  const products = PLACEHOLDER_PRODUCTS.filter(
    (product) => product.categoryHandle === handle
  )

  return (
    <>
      <TopNav />

      <main className="mx-auto max-w-8xl px-4 py-section min-[600px]:px-6">
        <h1 className="text-3xl font-medium uppercase text-ink">
          {categoryName}
        </h1>

        <div className="mt-section flex flex-col gap-section small:flex-row small:gap-xl">
          <FilterSidebar />

          <div className="flex-1">
            <ProductGrid>
              {products.map((product) => (
                <ProductCard
                  key={product.productId}
                  productId={product.productId}
                  name={product.name}
                  imageSrc={product.imageSrc}
                  imageAlt={product.imageAlt}
                  price={product.price}
                  originalPrice={product.originalPrice}
                />
              ))}
            </ProductGrid>
          </div>
        </div>
      </main>
    </>
  )
}
