import type { Metadata } from "next"
import InfoPageLayout from "../../components/layout/InfoPageLayout"
import { DELIVERY_FEE, FREE_DELIVERY_THRESHOLD } from "@lib/delivery"

export const metadata: Metadata = {
  title: "Delivery Info — Ali Store",
  description:
    "Delivery coverage, timing, and fees for Ali Store orders across Cambodia.",
}

/** USD labels from the shared constants — single source of truth (@lib/delivery). */
const FEE_LABEL = `$${DELIVERY_FEE.toFixed(2)}`
const FREE_LABEL = `$${FREE_DELIVERY_THRESHOLD}`

interface InfoRow {
  term: string
  detail: string
}

const DELIVERY_ROWS: readonly InfoRow[] = [
  { term: "Coverage", detail: "Phnom Penh and all provinces across Cambodia." },
  { term: "Phnom Penh", detail: "1–2 business days." },
  { term: "Provinces", detail: "2–4 business days via local courier." },
  {
    term: "Delivery fee",
    detail: `Flat ${FEE_LABEL} — free on orders of ${FREE_LABEL} or more.`,
  },
  {
    term: "Cash on Delivery",
    detail: "Available — pay in cash when your order arrives.",
  },
]

export default function DeliveryPage() {
  return (
    <InfoPageLayout
      title="Delivery Information"
      intro="How and when your order reaches you, and what delivery costs."
    >
      <dl className="flex flex-col gap-4">
        {DELIVERY_ROWS.map((row) => (
          <div
            key={row.term}
            className="flex flex-col gap-1 border-b border-hairline pb-4 min-[600px]:flex-row min-[600px]:gap-6"
          >
            <dt className="text-base font-medium text-ink min-[600px]:w-48 min-[600px]:shrink-0">
              {row.term}
            </dt>
            <dd className="text-sm font-normal leading-normal text-mute">
              {row.detail}
            </dd>
          </div>
        ))}
      </dl>
    </InfoPageLayout>
  )
}
