import type { Metadata } from "next"
import InfoPageLayout from "../../components/layout/InfoPageLayout"

export const metadata: Metadata = {
  title: "Returns & Exchanges — Ali Store",
  description:
    "Ali Store's exchange and size-swap policy, and how to start a return.",
}

interface PolicyPoint {
  heading: string
  body: string
}

const POLICY: readonly PolicyPoint[] = [
  {
    heading: "Exchanges & size-swaps only",
    body: "We offer exchanges or size-swaps within 3 days of delivery. We don't process cash refunds.",
  },
  {
    heading: "Item condition",
    body: "Items must be unworn, unwashed, and have their original tags attached.",
  },
  {
    heading: "How to start a return",
    body: "Message us on Telegram or Facebook (links in the footer) with your order details, and we'll arrange the swap.",
  },
  {
    heading: "Return delivery cost",
    body: "Return delivery for a size-swap is paid by the customer. If an item is defective or we sent the wrong one, we cover it.",
  },
]

export default function ReturnsPage() {
  return (
    <InfoPageLayout
      title="Returns & Exchanges"
      intro="Our exchange policy — simple, fast, and handled personally."
    >
      <div className="flex flex-col gap-xl">
        {POLICY.map((point) => (
          <section key={point.heading} className="flex flex-col gap-2">
            <h2 className="text-base font-medium text-ink">{point.heading}</h2>
            <p className="text-sm font-normal leading-normal text-mute">
              {point.body}
            </p>
          </section>
        ))}
      </div>
    </InfoPageLayout>
  )
}
