/**
 * Telegram order alert — BACKEND-09.
 *
 * Subscriber on the `order.placed` event (emitted by `completeCartWorkflow` for
 * both the COD path — BACKEND-04 — and the KHQR path — BACKEND-03B). On every
 * placed order it posts the full order details to the team's PRIVATE Telegram
 * chat via the Telegram Bot API: order #, line items (variant + qty), total
 * (USD + KHR), payment method (KHQR/COD), customer name, phone, address, note.
 *
 * Config (deploy-time `.env` secrets, never committed — CLARIFY-06):
 *  - `TELEGRAM_BOT_TOKEN` — the bot token.
 *  - `TELEGRAM_CHAT_ID`   — the private team chat id.
 * Until both are provided the subscriber no-ops (logs a warning and returns),
 * so the app runs against placeholders.
 *
 * Reliability (PRD §9): the send is retried with backoff on failure. A
 * subscriber must never throw — a failed alert must not break order placement —
 * so on final failure we log (redacted) and return.
 *
 * SECURITY (security.md):
 *  - The phone/address/note ARE included in the Telegram message (that is the
 *    point: full details to the single-operator's PRIVATE chat) but are NEVER
 *    written to server logs or error messages.
 *  - The Telegram host is hard-coded (`api.telegram.org`, https only) — no
 *    user-controlled URL, so no SSRF surface. The bot token lives only in the
 *    request URL and is never logged.
 *  - In-process send budget of 30/min (security.md "Telegram send path").
 *  - Messages are sent as plain text (no `parse_mode`), so user-controlled
 *    fields cannot inject Telegram markup.
 */
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { BAKONG_PROVIDER_ID } from "../modules/bakong-payment"
import { PAYWAY_PROVIDER_ID } from "../modules/aba-payway"
import { usdToKhr } from "../lib/settings"

/** Medusa's built-in manual provider — the COD payment session (BACKEND-04). */
const MANUAL_PAYMENT_PROVIDER_ID = "pp_system_default"

/** Telegram Bot API base — hard-coded host, https only (no SSRF surface). */
const TELEGRAM_API_BASE = "https://api.telegram.org"

/** Send-failure retry policy (PRD §9: order alerts retried if send fails). */
const MAX_SEND_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500
const SEND_TIMEOUT_MS = 10_000

/** In-process send budget (security.md: Telegram send path — 30/min/process). */
const SEND_BUDGET_PER_MINUTE = 30

/** Order-graph fields needed to build the alert. */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "currency_code",
  "total",
  "metadata",
  "email",
  "items.title",
  "items.variant_title",
  "items.quantity",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.phone",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.province",
  "shipping_address.postal_code",
  "payment_collections.payments.provider_id",
]

type CodContact = {
  name?: string | null
  phone?: string | null
  address?: string | null
  note?: string | null
}

type OrderAddress = {
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
}

type OrderItem = {
  title?: string | null
  variant_title?: string | null
  quantity?: number | null
}

type PlacedOrder = {
  id: string
  display_id?: number | null
  currency_code?: string | null
  total?: unknown
  metadata?: Record<string, unknown> | null
  items?: OrderItem[]
  shipping_address?: OrderAddress | null
  payment_collections?: Array<{
    payments?: Array<{ provider_id?: string | null }>
  }>
}

/** Coerce a Medusa BigNumberValue (number | string | { numeric }) to number. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value)
  if (value && typeof value === "object" && "numeric" in value) {
    return Number((value as { numeric: unknown }).numeric)
  }
  return NaN
}

/** Module-level fixed-window counter for the 30/min process send budget. */
let sendWindowMinute = -1
let sendWindowCount = 0

function withinSendBudget(): boolean {
  const minute = Math.floor(Date.now() / 60_000)
  if (minute !== sendWindowMinute) {
    sendWindowMinute = minute
    sendWindowCount = 0
  }
  if (sendWindowCount >= SEND_BUDGET_PER_MINUTE) return false
  sendWindowCount += 1
  return true
}

function getTelegramConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return null
  return { token, chatId }
}

/** "KHQR" / "COD" / "Unknown" — prefer COD's metadata flag, else the provider. */
function resolvePaymentMethod(order: PlacedOrder): string {
  const flag = order.metadata?.["payment_method"]
  if (typeof flag === "string" && flag.toLowerCase() === "cod") return "COD"

  const providers = (order.payment_collections ?? []).flatMap((pc) =>
    (pc.payments ?? []).map((p) => p.provider_id)
  )
  if (providers.includes(PAYWAY_PROVIDER_ID)) return "KHQR (ABA PayWay)"
  if (providers.includes(BAKONG_PROVIDER_ID)) return "KHQR"
  if (providers.includes(MANUAL_PAYMENT_PROVIDER_ID)) return "COD"
  return "Unknown"
}

/** Join the shipping address into a single human-readable line. */
function formatAddress(addr?: OrderAddress | null): string {
  if (!addr) return ""
  return [
    addr.address_1,
    addr.address_2,
    addr.city,
    addr.province,
    addr.postal_code,
  ]
    .map((p) => (p ?? "").toString().trim())
    .filter(Boolean)
    .join(", ")
}

/** Format the order total as "$X.XX USD (≈ N KHR)" (KHR = whole riel). */
function formatTotal(order: PlacedOrder): string {
  const total = toNumber(order.total)
  const currency = (order.currency_code ?? "usd").toUpperCase()
  if (!Number.isFinite(total)) return "—"

  const khrFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
  if (currency === "USD") {
    const khr = khrFmt.format(usdToKhr(total))
    return `$${total.toFixed(2)} USD (≈ ${khr} KHR)`
  }
  // Non-USD order (shop base is USD per PRD; show the native amount as-is).
  return `${total.toFixed(2)} ${currency}`
}

/** Build the plain-text alert body. Sent without parse_mode (no markup risk). */
function buildMessage(order: PlacedOrder): string {
  const cod = (order.metadata?.["cod_contact"] ?? {}) as CodContact
  const addr = order.shipping_address

  const orderNo = order.display_id ?? order.id
  const paymentMethod = resolvePaymentMethod(order)

  const name =
    (cod.name ?? "").toString().trim() ||
    [addr?.first_name, addr?.last_name]
      .map((p) => (p ?? "").toString().trim())
      .filter(Boolean)
      .join(" ") ||
    "—"
  const phone = (cod.phone ?? addr?.phone ?? "").toString().trim() || "—"
  const address = (cod.address ?? "").toString().trim() || formatAddress(addr) || "—"
  const note = (cod.note ?? "").toString().trim() || "—"

  const items = (order.items ?? [])
    .map((item) => {
      const title = (item.title ?? "Item").toString().trim()
      const variant = (item.variant_title ?? "").toString().trim()
      const qty = toNumber(item.quantity)
      const label = variant ? `${title} — ${variant}` : title
      return `• ${label} ×${Number.isFinite(qty) ? qty : "?"}`
    })
    .join("\n")

  return [
    `🛍️ New order #${orderNo}`,
    `Payment: ${paymentMethod}`,
    "",
    "Items:",
    items || "• (no line items)",
    "",
    `Total: ${formatTotal(order)}`,
    "",
    `Customer: ${name}`,
    `Phone: ${phone}`,
    `Address: ${address}`,
    `Note: ${note}`,
  ].join("\n")
}

/** One Telegram sendMessage POST. Throws on transport error or non-2xx. */
async function postOnce(
  token: string,
  chatId: string,
  text: string
): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      // Never surface the response body — it can echo the chat id / token path.
      throw new Error(`telegram_http_${res.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Send with retry/backoff. Returns true on success, false after exhausting. */
async function sendWithRetry(
  token: string,
  chatId: string,
  text: string,
  logger: Logger,
  orderId: string
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      await postOnce(token, chatId, text)
      return true
    } catch {
      // Redacted: only the (non-sensitive) order id + attempt count are logged.
      logger.warn(
        `[order-placed] Telegram send attempt ${attempt}/${MAX_SEND_ATTEMPTS} failed for order ${orderId}`
      )
      if (attempt < MAX_SEND_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt)
      }
    }
  }
  return false
}

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>): Promise<void> {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER)

  const telegram = getTelegramConfig()
  if (!telegram) {
    logger.warn(
      "[order-placed] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set — skipping order alert"
    )
    return
  }

  if (!withinSendBudget()) {
    logger.warn(
      `[order-placed] Telegram send budget (${SEND_BUDGET_PER_MINUTE}/min) exceeded — skipping alert for order ${data.id}`
    )
    return
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { id: data.id },
    })
    const order = orders?.[0] as PlacedOrder | undefined
    if (!order) {
      logger.error(`[order-placed] order ${data.id} not found — no alert sent`)
      return
    }

    const message = buildMessage(order)
    const sent = await sendWithRetry(
      telegram.token,
      telegram.chatId,
      message,
      logger,
      order.id
    )
    if (sent) {
      logger.info(`[order-placed] Telegram alert sent for order ${order.id}`)
    } else {
      logger.error(
        `[order-placed] Telegram alert FAILED after ${MAX_SEND_ATTEMPTS} attempts for order ${order.id}`
      )
    }
  } catch (err) {
    // Subscriber must never throw — a failed alert can't break order placement.
    const reason = err instanceof Error ? err.message : "unknown_error"
    logger.error(
      `[order-placed] alert handler error for order ${data.id}: ${reason}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
