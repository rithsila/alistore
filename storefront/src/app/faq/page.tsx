import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import InfoPageLayout from "../../components/layout/InfoPageLayout"

export const metadata: Metadata = {
  title: "FAQ — Ali Store",
  description:
    "Answers to common questions about ordering, payment, delivery, and exchanges at Ali Store.",
}

interface FaqItem {
  question: string
  answer: ReactNode
}

/** Inline link style for answers — ink underline, no accent (design.md). */
const FAQ_LINK =
  "text-ink underline underline-offset-2 transition-opacity hover:opacity-70"

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "How do I order?",
    answer:
      "Browse the catalog, add items to your bag, and check out with your phone number and delivery address. Pay by KHQR or Cash on Delivery.",
  },
  {
    question: "What payment methods do you accept?",
    answer:
      "Bakong KHQR — scan to pay from any Cambodian banking app — or Cash on Delivery.",
  },
  {
    question: "Can I pay in US Dollars or Riel?",
    answer:
      "Prices are shown in USD; switch to KHR with the currency toggle in the top bar. KHQR can be paid in either currency.",
  },
  {
    question: "Where do you deliver and how much does it cost?",
    answer: (
      <>
        We deliver across Phnom Penh and the provinces. Delivery is a flat $1.50,
        free on orders over $50. See{" "}
        <Link href="/delivery" className={FAQ_LINK}>
          Delivery Info
        </Link>{" "}
        for details.
      </>
    ),
  },
  {
    question: "Can I exchange or return an item?",
    answer: (
      <>
        Yes — size-swaps and exchanges within 3 days. See our{" "}
        <Link href="/returns" className={FAQ_LINK}>
          Returns &amp; Exchanges
        </Link>{" "}
        policy.
      </>
    ),
  },
  {
    question: "How do I contact you?",
    answer:
      "Message us on Telegram or Facebook — the links are in the footer below.",
  },
]

export default function FaqPage() {
  return (
    <InfoPageLayout
      title="Frequently Asked Questions"
      intro="Everything you need to know about ordering, paying, and delivery."
    >
      <div className="flex flex-col">
        {FAQ_ITEMS.map((item) => (
          <details
            key={item.question}
            className="group border-b border-hairline py-4"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium text-ink transition-opacity hover:opacity-70 [&::-webkit-details-marker]:hidden">
              {item.question}
              <span
                aria-hidden="true"
                className="text-mute transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <div className="mt-2 text-sm font-normal leading-normal text-mute">
              {item.answer}
            </div>
          </details>
        ))}
      </div>
    </InfoPageLayout>
  )
}
