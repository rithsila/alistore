import TopNav from "../components/layout/TopNav"
import Hero from "../components/layout/Hero"
import CategoryTabs from "../components/product/CategoryTabs"
import ProductGrid from "../components/product/ProductGrid"
import ProductCard from "../components/product/ProductCard"

/**
 * Catalog / home landing page (FRONTEND-09).
 *
 * Composes the storefront landing shell from the existing components:
 * `TopNav` (FRONTEND-04) → `Hero` (FRONTEND-08) → `CategoryTabs` (FRONTEND-07)
 * → `ProductGrid` of `ProductCard`s (FRONTEND-06 / FRONTEND-05).
 *
 * Server Component — it only renders placeholder data and passes serializable
 * props down (the interactive bits, TopNav and CategoryTabs, are their own
 * "use client" components).
 *
 * Placeholder data, per the acceptance criterion:
 * - Categories mirror the SETUP-09 seed (English v1).
 * - Product images use the Medusa demo image bucket already allow-listed in
 *   `next.config.js` (`images.remotePatterns`), so `next/image` resolves them.
 *
 * Scope note: the Requirements reference a "mobile bottom bar (FRONTEND-21)",
 * but `BottomBar` is FRONTEND-21's deliverable and is not a dependency of this
 * task (deps: FRONTEND-04/06/07/08). It does not exist yet, so it is wired in
 * when FRONTEND-21 is built; this page composes only the four available
 * sections.
 */

interface PlaceholderCategory {
  handle: string
  name: string
}

interface PlaceholderProduct {
  productId: string
  name: string
  imageSrc: string
  imageAlt: string
  price: string
  originalPrice?: string
}

// Mirrors the SETUP-09 seeded categories (English v1).
const PLACEHOLDER_CATEGORIES: readonly PlaceholderCategory[] = [
  { handle: "t-shirt", name: "T-shirt" },
  { handle: "polo", name: "Polo" },
  { handle: "outerwear", name: "Outerwear" },
  { handle: "hoodie", name: "Hoodie" },
  { handle: "pants", name: "Pants" },
  { handle: "accessories", name: "Accessories" },
]

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
  },
  {
    productId: "AS-1002",
    name: "Essential Tee",
    imageSrc: `${DEMO_IMAGE_HOST}/tee-white-front.png`,
    imageAlt: "White essential cotton t-shirt, front view",
    price: "$29.00",
  },
  {
    productId: "AS-2001",
    name: "Vintage Sweatshirt",
    imageSrc: `${DEMO_IMAGE_HOST}/sweatshirt-vintage-front.png`,
    imageAlt: "Vintage sweatshirt, front view",
    price: "$59.00",
    originalPrice: "$79.00",
  },
  {
    productId: "AS-3001",
    name: "Relaxed Sweatpants",
    imageSrc: `${DEMO_IMAGE_HOST}/sweatpants-gray-front.png`,
    imageAlt: "Gray relaxed-fit sweatpants, front view",
    price: "$49.00",
  },
  {
    productId: "AS-3002",
    name: "Summer Shorts",
    imageSrc: `${DEMO_IMAGE_HOST}/shorts-vintage-front.png`,
    imageAlt: "Vintage summer shorts, front view",
    price: "$35.00",
    originalPrice: "$45.00",
  },
  {
    productId: "AS-1003",
    name: "Long Sleeve Tee",
    imageSrc: `${DEMO_IMAGE_HOST}/longsleeve-vintage-front.png`,
    imageAlt: "Vintage long-sleeve t-shirt, front view",
    price: "$39.00",
  },
]

export default function HomePage() {
  return (
    <>
      <TopNav />

      <main>
        <Hero />

        <section className="mx-auto flex max-w-8xl flex-col gap-xl px-4 py-section min-[600px]:px-6">
          <CategoryTabs categories={[...PLACEHOLDER_CATEGORIES]} />

          <ProductGrid>
            {PLACEHOLDER_PRODUCTS.map((product) => (
              <ProductCard key={product.productId} {...product} />
            ))}
          </ProductGrid>
        </section>
      </main>
    </>
  )
}
