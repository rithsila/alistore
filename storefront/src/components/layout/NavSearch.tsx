"use client"

import { useEffect, useRef, useState } from "react"
import { MagnifyingGlass, XMark } from "@medusajs/icons"

import SearchBox from "./SearchBox"

/**
 * Expanding nav search affordance (FRONTEND-23, desktop ≥600px).
 *
 * Closed, it's just the magnifier icon. Clicking it expands a `SearchBox` (the
 * FRONTEND-03 `SearchPill` wired to a `next/form` GET form) out to the LEFT of
 * the icon and focuses it; submitting navigates to `/search?q=`. The field
 * collapses again on Escape, a pointer-down outside the affordance, or a second
 * click of the icon (now an ✕). While collapsed the input is `disabled` so it
 * stays out of the tab order and can't be submitted.
 *
 * The reveal animates `width` only — a small, single-element transition kept
 * short and subtle, consistent with the flat design system (no shadow/blur).
 */

// Mirrors TopNav's icon-button affordance (kept local so this stays standalone).
const ICON_BUTTON =
  "inline-flex h-11 w-11 items-center justify-center text-ink transition-opacity hover:opacity-70"

export default function NavSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Focus the field once it's revealed (and enabled).
  useEffect(() => {
    if (isOpen) {
      containerRef.current?.querySelector("input")?.focus()
    }
  }, [isOpen])

  // Collapse on Escape or a pointer-down outside the affordance.
  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const node = containerRef.current
      if (node && !node.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    document.addEventListener("pointerdown", handlePointerDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.removeEventListener("pointerdown", handlePointerDown)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="flex items-center">
      <div
        aria-hidden={!isOpen}
        className={`overflow-hidden transition-[width] duration-200 ease-out ${
          isOpen ? "w-40" : "w-0"
        }`}
      >
        <SearchBox disabled={!isOpen} />
      </div>

      <button
        type="button"
        aria-label={isOpen ? "Close search" : "Search"}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={ICON_BUTTON}
      >
        {isOpen ? (
          <XMark className="h-6 w-6" />
        ) : (
          <MagnifyingGlass className="h-6 w-6" />
        )}
      </button>
    </div>
  )
}
