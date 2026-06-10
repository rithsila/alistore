/**
 * Validation for POST /store/payments/payway/start — PAYWAY-03.
 *
 * Every custom route validates its body with zod before touching the service
 * layer (security.md "API routes"). Body is `{ cart_id, currency }` — the same
 * contract as the khqr start route so the storefront cutover is a URL change.
 */
import { validateAndTransformBody } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { z } from "zod"

export const StartPaywaySchema = z.object({
  // Medusa cart ids are short ULIDs (`cart_…`); cap the length so obviously
  // malformed input is rejected before it reaches the query layer.
  cart_id: z.string().min(1).max(100),
  currency: z.enum(["USD", "KHR"]),
})

export type StartPaywaySchema = z.infer<typeof StartPaywaySchema>

export const paywayStartMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/payments/payway/start",
    method: "POST",
    middlewares: [validateAndTransformBody(StartPaywaySchema)],
  },
]
