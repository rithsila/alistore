"use client"

import { useState } from "react"
import { XMark } from "@medusajs/icons"

import Chip from "../ui/Chip"
import PillButton from "../ui/PillButton"

/**
 * Product filter sidebar / drawer.
 *
 * Desktop (≥1024px): fixed-width left rail.
 * Mobile (≤1023px): hidden behind a "Filters" pill button that opens a
 * full-screen off-canvas drawer.
 *
 * Filter groups:
 *   Special  — "New Arrivals" and "Discount" pill toggles
 *   Category — checkbox-style rows
 *   Size     — Chip pills
 *   Colour   — circular colour-swatch dots
 *
 * `onChange` fires with the full `FilterSelection` on every toggle so a parent
 * (`CatalogClient`) can re-filter the product grid without a network round-trip.
 */

export interface FilterOption {
  value: string
  label: string
}

export type FilterGroupKey = "special" | "category" | "size" | "color"

export type FilterSelection = Record<FilterGroupKey, string[]>

interface FilterSidebarProps {
  categories?: FilterOption[]
  sizes?: FilterOption[]
  colors?: FilterOption[]
  onChange?: (selected: FilterSelection) => void
  initialSelection?: Partial<FilterSelection>
}

const SPECIAL_OPTIONS: readonly FilterOption[] = [
  { value: "new-arrivals", label: "New Arrivals" },
  { value: "discount", label: "Discount" },
]

const DEFAULT_CATEGORIES: readonly FilterOption[] = [
  { value: "t-shirt", label: "T-shirt" },
  { value: "polo", label: "Polo" },
  { value: "outerwear", label: "Outerwear" },
  { value: "hoodie", label: "Hoodie" },
  { value: "pants", label: "Pants" },
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
  { value: "beige", label: "Beige" },
  { value: "navy", label: "Navy" },
  { value: "gray", label: "Gray" },
]

const COLOR_HEX: Readonly<Record<string, string>> = {
  black: "#111111",
  white: "#f0f0f0",
  grey: "#9ca3af",
  gray: "#9ca3af",
  navy: "#1f2a44",
  blue: "#2563a8",
  red: "#b91c1c",
  green: "#15803d",
  beige: "#e8dcc6",
  brown: "#6b4f3a",
}
const FALLBACK_HEX = "#d4d4d4"

const EMPTY_SELECTION: FilterSelection = {
  special: [],
  category: [],
  size: [],
  color: [],
}

const FILTER_HEADING = "text-base font-medium leading-7 text-ink"
const GROUP_LABEL = "text-xs font-medium uppercase tracking-widest text-mute"
const ICON_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70"

export default function FilterSidebar({
  categories = [...DEFAULT_CATEGORIES],
  sizes = [...DEFAULT_SIZES],
  colors = [...DEFAULT_COLORS],
  onChange,
  initialSelection,
}: FilterSidebarProps) {
  const [selected, setSelected] = useState<FilterSelection>({
    ...EMPTY_SELECTION,
    ...initialSelection,
  })
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)

  const toggle = (key: FilterGroupKey, value: string) => {
    const current = selected[key]
    const nextValues = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    const next = { ...selected, [key]: nextValues }
    setSelected(next)
    onChange?.(next)
  }

  const renderSpecial = () => (
    <div className="flex flex-wrap gap-2">
      {SPECIAL_OPTIONS.map((opt) => (
        <Chip
          key={opt.value}
          active={selected.special.includes(opt.value)}
          onClick={() => toggle("special", opt.value)}
        >
          {opt.label}
        </Chip>
      ))}
    </div>
  )

  const renderCategories = () => {
    if (categories.length === 0) return null
    return (
      <div className="flex flex-col gap-3 border-t border-hairline pt-lg">
        <span className={GROUP_LABEL}>Category</span>
        <div className="flex flex-col gap-2">
          {categories.map((opt) => {
            const active = selected.category.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => toggle("category", opt.value)}
                className="flex items-center gap-2 text-left"
              >
                <span
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 rounded-soft border transition-colors ${
                    active ? "border-ink bg-ink" : "border-hairline bg-canvas"
                  }`}
                />
                <span className="text-sm text-ink">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const renderSizes = () => {
    if (sizes.length === 0) return null
    return (
      <div className="flex flex-col gap-3 border-t border-hairline pt-lg">
        <span className={GROUP_LABEL}>Size</span>
        <div className="flex flex-wrap gap-2">
          {sizes.map((opt) => (
            <Chip
              key={opt.value}
              active={selected.size.includes(opt.value)}
              onClick={() => toggle("size", opt.value)}
            >
              {opt.label}
            </Chip>
          ))}
        </div>
      </div>
    )
  }

  const renderColors = () => {
    if (colors.length === 0) return null
    return (
      <div className="flex flex-col gap-3 border-t border-hairline pt-lg">
        <span className={GROUP_LABEL}>Colour</span>
        <div className="flex flex-wrap gap-3">
          {colors.map((opt) => {
            const hex = COLOR_HEX[opt.value.toLowerCase()] ?? FALLBACK_HEX
            const active = selected.color.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                aria-label={opt.label}
                aria-pressed={active}
                onClick={() => toggle("color", opt.value)}
                className={`h-6 w-6 rounded-circle border-2 transition-transform ${
                  active
                    ? "scale-110 border-ink"
                    : "border-transparent hover:scale-105"
                }`}
                style={{ backgroundColor: hex }}
              />
            )
          })}
        </div>
      </div>
    )
  }

  const renderContent = () => (
    <div className="flex flex-col gap-0">
      {renderSpecial()}
      {renderCategories()}
      {renderSizes()}
      {renderColors()}
    </div>
  )

  return (
    <>
      {/* Desktop: fixed-width left rail (≥1024px) */}
      <aside
        aria-label="Product filters"
        className="hidden w-56 shrink-0 small:block"
      >
        <h2 className={`${FILTER_HEADING} mb-lg`}>Filter</h2>
        {renderContent()}
      </aside>

      {/* Mobile: Filters button (≤1023px) */}
      <div className="small:hidden">
        <PillButton
          onClick={() => setIsDrawerOpen(true)}
          aria-expanded={isDrawerOpen}
        >
          Filters
        </PillButton>
      </div>

      {/* Mobile: off-canvas drawer */}
      <div
        aria-hidden={!isDrawerOpen}
        className={`fixed inset-0 z-50 flex flex-col bg-canvas transition-transform small:hidden ${
          isDrawerOpen
            ? "translate-x-0"
            : "-translate-x-full pointer-events-none"
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-hairline-soft px-4">
          <span className={FILTER_HEADING}>Filter</span>
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
          {renderContent()}
        </div>
      </div>
    </>
  )
}
