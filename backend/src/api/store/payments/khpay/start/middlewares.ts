/**
 * Validation for POST /store/payments/khpay/start — KHPAY-02.
 *
 * Every custom route validates its body with zod before touching the service
 * layer (security.md "API routes"). Body is `{ cart_id, currency }` — the same
 * contract as the khqr/payway start routes so the storefront cutover is a URL
 * change.
 */
import { validateAndTransformBody } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { z } from "zod"

export const StartKhpaySchema = z.object({
  // Medusa cart ids are short ULIDs (`cart_…`); cap the length so obviously
  // malformed input is rejected before it reaches the query layer.
  cart_id: z.string().min(1).max(100),
  currency: z.enum(["USD", "KHR"]),
})

export type StartKhpaySchema = z.infer<typeof StartKhpaySchema>

export const khpayStartMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/payments/khpay/start",
    method: "POST",
    middlewares: [validateAndTransformBody(StartKhpaySchema)],
  },
]
