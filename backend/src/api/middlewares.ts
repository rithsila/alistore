/**
 * Global API middleware registration.
 *
 * Per-route validation/auth middleware arrays are defined next to their routes
 * and spread in here (see Medusa's middleware export convention).
 */
import { defineMiddlewares } from "@medusajs/framework/http"
import { khqrStartMiddlewares } from "./store/payments/khqr/start/middlewares"

export default defineMiddlewares({
  routes: [...khqrStartMiddlewares],
})
