import type { Metadata } from "next"
import InfoPageLayout from "../../components/layout/InfoPageLayout"
import { HOW_TO_MEASURE, SIZE_CHARTS, SIZE_NOTE } from "@lib/size-guide"
import FitFinder from "./FitFinder"

export const metadata: Metadata = {
  title: "Size Guide — Ali Store",
  description:
    "Body-measurement charts for tops and bottoms, with US, EU, and UK size equivalents.",
}

/**
 * Size Guide info page (FRONTEND-24).
 *
 * Server Component reusing `InfoPageLayout` (the FAQ/Delivery/Returns frame, so
 * the single `<h1>` and reading column are shared). Everything below the intro
 * is derived from `@lib/size-guide` — the Asia-fit note, the interactive
 * `FitFinder` (the page's only Client Component), the measure tips, and one
 * semantic `<table>` per chart — so no measurement value is hardcoded here.
 *
 * Each table sits in an `overflow-x-auto` wrapper: at 360px the wide chart
 * scrolls inside its own box instead of pushing the page wider. Tokens only —
 * `soft-cloud` header row, `hairline` row dividers, ink/mute text, Inter 400/500.
 * No accent (reserved for sale price + the KHQR CTA), no shadows/gradients/`dark:`.
 */
export default function SizeGuidePage() {
  return (
    <InfoPageLayout
      title="Size Guide"
      intro="Find your fit — body measurements in centimetres, with US, EU, and UK equivalents."
    >
      <p className="border border-hairline bg-soft-cloud p-4 text-sm font-normal leading-normal text-ink">
        {SIZE_NOTE}
      </p>

      <FitFinder />

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-medium text-ink">How to measure</h2>
        <dl className="flex flex-col gap-4">
          {HOW_TO_MEASURE.map((tip) => (
            <div
              key={tip.part}
              className="flex flex-col gap-1 border-b border-hairline pb-4 min-[600px]:flex-row min-[600px]:gap-6"
            >
              <dt className="text-base font-medium text-ink min-[600px]:w-32 min-[600px]:shrink-0">
                {tip.part}
              </dt>
              <dd className="text-sm font-normal leading-normal text-mute">
                {tip.how}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {SIZE_CHARTS.map((chart) => (
        <section key={chart.title} className="flex flex-col gap-4">
          <h2 className="text-base font-medium text-ink">{chart.title}</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-soft-cloud">
                  {chart.columns.map((col) => (
                    <th
                      key={col.key}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 text-sm font-medium text-ink"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chart.rows.map((row) => (
                  <tr key={row.size} className="border-b border-hairline">
                    {chart.columns.map((col, colIndex) =>
                      colIndex === 0 ? (
                        <th
                          key={col.key}
                          scope="row"
                          className="whitespace-nowrap px-3 py-2 text-sm font-medium text-ink"
                        >
                          {row[col.key]}
                        </th>
                      ) : (
                        <td
                          key={col.key}
                          className="whitespace-nowrap px-3 py-2 text-sm font-normal text-mute"
                        >
                          {row[col.key]}
                        </td>
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </InfoPageLayout>
  )
}
