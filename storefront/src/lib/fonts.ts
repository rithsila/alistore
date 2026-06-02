import { Bebas_Neue, Inter } from "next/font/google"

/**
 * Latin font stack — English-first v1 (DESIGN.md, CLARIFY-02).
 * Khmer font is deferred to v2; no Khmer fallback stack here.
 *
 * Both fonts are self-hosted/optimized by `next/font` (no runtime request to
 * Google), and expose CSS variables consumed across the design system.
 */

// UI text — Inter. Two weights only per DESIGN.md: 400 (regular) / 500 (medium).
export const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
  display: "swap",
})

// Campaign/display tier — Bebas Neue (96px / 0.9 / uppercase). Single weight 400.
export const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas-neue",
  display: "swap",
})
