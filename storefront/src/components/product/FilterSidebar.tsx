"use client"

import { useState } from "react"
import { XMark } from "@medusajs/icons"

import Chip from "../ui/Chip"
import PillButton from "../ui/PillButton"

/**
 * Product filter sidebar / drawer (DESIGN.md filter-sidebar / FRONTEND-11).
 *
 * Filters by category / size / color / price. Each group has a `heading-md`
 * header (16 / 500 / 1.75 → `text-base font-medium leading-7`) and its options
 * are `Chip`s (multi-select; active = ink fill). Groups are separated by 1px
 * hairline dividers with `spacing.lg` (18px) vertical rhythm.
 *
 * Responsive (DESIGN.md breakpoints — the config's `small` screen is 1024px,
 * matching the ≤1023 / ≥1024 boundary exactly):
 * - Desktop (≥1024px): a fixed-width left rail (`w-56` ≈ 220px; `w-56` keeps
 *   the width on the 8px grid, which the design rule requires over an exact
 *   arbitrary 220px).
 * - Mobile (≤1023px): the rail is hidden behind a "Filters" `PillButton` that
 *   opens a full-screen off-canvas drawer.
 *
 * Colors are filtered by name (reusing `Chip`), not swatch dots — swatch dots
 * belong to the PDP `VariantPicker` (FRONTEND-13) and are out of scope here.
 *
 * Selection lives in this client component; an optional `onChange` surfaces the
 * selected values per group so a parent (FRONTEND-10) can drive the filtered
 * grid.
 */

interface FilterOption {
  /** Stable filter value (e.g. category handle, size code). */
  value: string
  /** Display label. */
  label: string
}

type FilterGroupKey = "category" | "size" | "color" | "price"

type FilterSelection = Record<FilterGroupKey, string[]>

interface FilterSidebarProps {
  categories?: FilterOption[]
  sizes?: FilterOption[]
  colors?: FilterOption[]
  prices?: FilterOption[]
  /** Notifies the parent when the selected filters change. */
  onChange?: (selected: FilterSelection) => void
}

// Placeholder options (a parent can override via props).
const DEFAULT_CATEGORIES: readonly FilterOption[] = [
  { value: "t-shirt", label: "T-shirt" },
  { value: "polo", label: "Polo" },
  { value: "outerwear", label: "Outerwear" },
  { value: "hoodie", label: "Hoodie" },
  { value: "pants", label: "Pants" },
  { value: "accessories", label: "Accessories" },
]

const DEFAULT_SIZES: readonly FilterOption[] = [
  { value: "xs", label: "XS" },
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
  { value: "xl", label: "XL" },
]

const DEFAULT_COLORS: readonly FilterOption[] = [
  { value: "black", label: "Black" },
  { value: "white", label: "White" },
  { value: "gray", label: "Gray" },
  { value: "navy", label: "Navy" },
  { value: "beige", label: "Beige" },
]

const DEFAULT_PRICES: readonly FilterOption[] = [
  { value: "under-25", label: "Under $25" },
  { value: "25-50", label: "$25–$50" },
  { value: "50-100", label: "$50–$100" },
  { value: "100-plus", label: "$100+" },
]

// heading-md (DESIGN.md): 16px / 500 / 1.75.
const HEADING_MD = "text-base font-medium leading-7 text-ink"

const ICON_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70"

const EMPTY_SELECTION: FilterSelection = {
  category: [],
  size: [],
  color: [],
  price: [],
}

export default function FilterSidebar({
  categories = [...DEFAULT_CATEGORIES],
  sizes = [...DEFAULT_SIZES],
  colors = [...DEFAULT_COLORS],
  prices = [...DEFAULT_PRICES],
  onChange,
}: FilterSidebarProps) {
  const [selected, setSelected] = useState<FilterSelection>(EMPTY_SELECTION)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const groups: {
    key: FilterGroupKey
    label: string
    options: FilterOption[]
  }[] = [
    { key: "category", label: "Category", options: categories },
    { key: "size", label: "Size", options: sizes },
    { key: "color", label: "Color", options: colors },
    { key: "price", label: "Price", options: prices },
  ]

  const toggle = (key: FilterGroupKey, value: string) => {
    setSelected((prev) => {
      const current = prev[key]
      const nextValues = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      const next = { ...prev, [key]: nextValues }
      onChange?.(next)
      return next
    })
  }

  const renderGroups = () => (
    <div className="divide-y divide-hairline">
      {groups.map((group) => (
        <fieldset key={group.key} className="py-lg first:pt-0 last:pb-0">
          <legend className={HEADING_MD}>{group.label}</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {group.options.map((option) => (
              <Chip
                key={option.value}
                active={selected[group.key].includes(option.value)}
                onClick={() => toggle(group.key, option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )

  return (
    <>
      {/* Desktop: fixed-width left rail (≥1024px). */}
      <aside
        aria-label="Product filters"
        className="hidden w-56 shrink-0 bg-canvas small:block"
      >
        {renderGroups()}
      </aside>

      {/* Mobile: Filters button + full-screen off-canvas drawer (≤1023px). */}
      <div className="small:hidden">
        <PillButton
          onClick={() => setIsDrawerOpen(true)}
          aria-expanded={isDrawerOpen}
        >
          Filters
        </PillButton>
      </div>

      <div
        aria-hidden={!isDrawerOpen}
        className={`fixed inset-0 z-50 flex flex-col bg-canvas transition-transform small:hidden ${
          isDrawerOpen
            ? "translate-x-0"
            : "-translate-x-full pointer-events-none"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-hairline-soft px-4">
          <span className={HEADING_MD}>Filters</span>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setIsDrawerOpen(false)}
            className={`${ICON_BUTTON} -mr-3`}
          >
            <XMark className="h-6 w-6" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-lg">
          {renderGroups()}
        </div>
      </div>
    </>
  )
}
