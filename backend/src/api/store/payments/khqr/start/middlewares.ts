/**
 * Validation for POST /store/payments/khqr/start — BACKEND-03.
 *
 * Every custom route validates its body with zod before touching the service
 * layer (security.md "API routes"). Body is `{ cart_id, currency }`.
 */
import { validateAndTransformBody } from "@medusajs/framework/http"
import type { MiddlewareRoute } from "@medusajs/framework/http"
import { z } from "zod"

export const StartKhqrSchema = z.object({
  // Medusa cart ids are short ULIDs (`cart_…`); cap the length so obviously
  // malformed input is rejected before it reaches the query layer.
  cart_id: z.string().min(1).max(100),
  currency: z.enum(["USD", "KHR"]),
})

export type StartKhqrSchema = z.infer<typeof StartKhqrSchema>

export const khqrStartMiddlewares: MiddlewareRoute[] = [
  {
    matcher: "/store/payments/khqr/start",
    method: "POST",
    middlewares: [validateAndTransformBody(StartKhqrSchema)],
  },
]
