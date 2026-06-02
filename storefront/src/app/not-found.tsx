import { ArrowUpRightMini } from "@medusajs/icons"
import { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "404",
  description: "Something went wrong",
}

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-8xl flex-col items-center justify-center gap-4 px-4 py-section text-center min-[600px]:px-6">
      <h1 className="text-2xl font-medium text-ink">Page not found</h1>
      <p className="text-base font-normal text-mute">
        The page you tried to access does not exist.
      </p>
      <Link
        href="/"
        className="group inline-flex items-center gap-1 text-base font-medium text-ink transition-opacity hover:opacity-70"
      >
        Go to frontpage
        <ArrowUpRightMini className="transition-transform duration-150 ease-in-out group-hover:rotate-45" />
      </Link>
    </main>
  )
}
