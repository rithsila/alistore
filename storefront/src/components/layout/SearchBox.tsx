import Form from "next/form"

import SearchPill from "../ui/SearchPill"

/**
 * Search submit form (FRONTEND-23).
 *
 * Thin composition over the FRONTEND-03 `SearchPill`: a Next 15 `next/form` GET
 * form whose submission navigates (client-side) to `/search?q=<value>` —
 * URL-as-state, no hand-rolled router. Reused by the nav's `NavSearch` expanding
 * affordance and, prefilled, at the top of the `/search` results page. Adds no
 * colour or chrome of its own; all visuals come from `SearchPill`.
 */

const MAX_SEARCH_QUERY_LENGTH = 100

interface SearchBoxProps {
  /** Prefills the query (the active term on the results page). */
  defaultValue?: string
  /** Disables the field (collapsed nav affordance — keeps it out of tab order). */
  disabled?: boolean
  /** Extra classes for the form wrapper. */
  className?: string
}

export default function SearchBox({
  defaultValue,
  disabled = false,
  className = "",
}: SearchBoxProps) {
  return (
    <Form action="/search" className={className}>
      <SearchPill
        name="q"
        defaultValue={defaultValue}
        disabled={disabled}
        placeholder="Search products"
        aria-label="Search products"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={MAX_SEARCH_QUERY_LENGTH}
      />
    </Form>
  )
}
