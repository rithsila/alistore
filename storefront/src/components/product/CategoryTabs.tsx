"use client"

import { useState } from "react"

import Chip from "../ui/Chip"
import SearchPill from "../ui/SearchPill"

/**
 * Horizontal category selector (DESIGN.md category-tabs / FRONTEND-07).
 *
 * A leading `SearchPill` followed by a horizontally scrollable row of `Chip`s,
 * one per seeded product category (English v1 — T-shirt, Polo, Outerwear,
 * Hoodie, Pants, Accessories). The selected chip uses the active ink fill
 * (handled by the `Chip` primitive); the row scrolls on overflow so it never
 * wraps on narrow viewports.
 *
 * Presentational + interactive: a Server Component parent (FRONTEND-09) fetches
 * the categories via the Medusa SDK and passes them in; selection state lives
 * here because the active highlight needs client interactivity.
 */

interface Category {
  /** Category handle (stable id used for selection). */
  handle: string
  /** Display name (English v1). */
  name: string
}

interface CategoryTabsProps {
  /** Seeded product categories to render as chips. */
  categories: Category[]
  /** Notifies the parent when a category chip is selected. */
  onCategorySelect?: (handle: string) => void
}

export default function CategoryTabs({
  categories,
  onCategorySelect,
}: CategoryTabsProps) {
  const [activeHandle, setActiveHandle] = useState<string | null>(null)

  const handleSelect = (handle: string) => {
    setActiveHandle(handle)
    onCategorySelect?.(handle)
  }

  return (
    <div className="flex items-center gap-2 overflow-x-auto">
      <div className="w-60 shrink-0">
        <SearchPill placeholder="Search" aria-label="Search products" />
      </div>

      {categories.map((category) => (
        <Chip
          key={category.handle}
          active={activeHandle === category.handle}
          className="shrink-0"
          onClick={() => handleSelect(category.handle)}
        >
          {category.name}
        </Chip>
      ))}
    </div>
  )
}
