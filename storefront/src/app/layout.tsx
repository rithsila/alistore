import { getBaseURL } from "@lib/util/env"
import { bebasNeue, inter } from "@lib/fonts"
import { Metadata } from "next"
import Footer from "../components/layout/Footer"
import { CurrencyProvider } from "@lib/currency-context"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-mode="light"
      className={`${inter.variable} ${bebasNeue.variable}`}
    >
      <body className={inter.className}>
        {/* CurrencyProvider owns the USD/KHR display choice so the nav toggle and
            every price on the page share one source and switch together. */}
        <CurrencyProvider>
          <div className="relative">{props.children}</div>
          {/* Site footer (FRONTEND-20) — mounted once here so every page gets the
              same chrome (DESIGN.md: identical chrome across the page set). */}
          <Footer />
        </CurrencyProvider>
      </body>
    </html>
  )
}
