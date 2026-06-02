import { getBaseURL } from "@lib/util/env"
import { bebasNeue, inter } from "@lib/fonts"
import { Metadata } from "next"
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
        <div className="relative">{props.children}</div>
      </body>
    </html>
  )
}
