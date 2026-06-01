/**
 * Invoice template — BACKEND-06.
 *
 * Renders a self-contained, printable HTML invoice for an order: header, order
 * meta, line items, delivery fee, an OPTIONAL VAT line, and the total.
 *
 * VAT is "VAT-ready" but OFF by default (PRD §2 / locked CLARIFY-10: 10%
 * Cambodia standard, wired but disabled in v1; the TIN is supplied when it is
 * enabled). When disabled the VAT line and TIN are absent and the total is just
 * goods + delivery. Config is read from the environment by {@link getInvoiceConfig}:
 *   - `INVOICE_VAT_ENABLED`   "true"/"1" to show the VAT line   (default off)
 *   - `VAT_RATE`              fractional rate                   (default 0.10)
 *   - `INVOICE_TIN`           tax identification number shown when VAT is on
 *   - `INVOICE_BUSINESS_NAME` issuer name in the header         (default "Ali Store")
 *
 * SECURITY (security.md): every dynamic value is HTML-escaped before
 * interpolation — customer name/address/note are user input. No client styling
 * frameworks, no external assets: the markup is inline so it prints offline.
 */

/** A single rendered line on the invoice. */
export interface InvoiceLineItem {
  /** Product/variant label, e.g. "Cotton Tee — M / Coral". */
  title: string
  quantity: number
  /** Unit price in the order currency's major unit (e.g. 20 = $20.00). */
  unitPrice: number
  /** Line total in the order currency's major unit. */
  lineTotal: number
}

/** Optional buyer block ("Bill to"); any field may be absent. */
export interface InvoiceContact {
  name?: string | null
  phone?: string | null
  address?: string | null
}

/** Everything the template needs about one order (currency major units). */
export interface InvoiceOrder {
  /** Human order number (Medusa `display_id`). */
  displayId: number
  /** ISO timestamp the order was placed. */
  createdAt: string
  /** ISO-4217 code, uppercase (e.g. "USD"). */
  currencyCode: string
  items: InvoiceLineItem[]
  /** Sum of goods, in major units. */
  itemsSubtotal: number
  /** Delivery fee, in major units. */
  deliveryFee: number
  contact?: InvoiceContact
}

/** Invoice config resolved from the environment. */
export interface InvoiceConfig {
  businessName: string
  vatEnabled: boolean
  /** Fractional VAT rate (0.10 = 10%). */
  vatRate: number
  /** Tax identification number, shown only when VAT is enabled. */
  tin: string
}

/** Default VAT rate when `VAT_RATE` is unset (CLARIFY-10: 10% standard). */
const DEFAULT_VAT_RATE = 0.1
/** Default issuer name when `INVOICE_BUSINESS_NAME` is unset. */
const DEFAULT_BUSINESS_NAME = "Ali Store"

/** Parse an env flag: true only for "true"/"1"/"yes" (case-insensitive). */
function readFlag(value: string | undefined): boolean {
  if (!value) return false
  return ["true", "1", "yes"].includes(value.trim().toLowerCase())
}

/** Parse a fractional rate in [0, 1); fall back when unset/invalid. */
function readRate(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) return fallback
  return parsed
}

/** Read invoice config from the environment with documented defaults. */
export function getInvoiceConfig(): InvoiceConfig {
  return {
    businessName:
      process.env.INVOICE_BUSINESS_NAME?.trim() || DEFAULT_BUSINESS_NAME,
    vatEnabled: readFlag(process.env.INVOICE_VAT_ENABLED),
    vatRate: readRate(process.env.VAT_RATE, DEFAULT_VAT_RATE),
    tin: process.env.INVOICE_TIN?.trim() || "",
  }
}

/** Escape the five HTML-significant characters (XSS-safe interpolation). */
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Round to whole cents to avoid float drift in displayed totals. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Format a major-unit amount in the order currency (e.g. "$20.00"). */
function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
    }).format(amount)
  } catch {
    // Unknown currency code → plain code + 2dp fallback.
    return `${currencyCode.toUpperCase()} ${amount.toFixed(2)}`
  }
}

/** Format an ISO timestamp as a stable, locale-independent date (YYYY-MM-DD). */
function formatDate(iso: string): string {
  const parsed = Date.parse(iso)
  if (!Number.isFinite(parsed)) return ""
  return new Date(parsed).toISOString().slice(0, 10)
}

function renderContact(contact: InvoiceContact | undefined): string {
  if (!contact) return ""
  const lines = [contact.name, contact.phone, contact.address]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => `<div>${escapeHtml(v)}</div>`)
  if (lines.length === 0) return ""
  return `<section class="party">
      <h2>Bill to</h2>
      ${lines.join("\n      ")}
    </section>`
}

/**
 * Render the full printable invoice document. Pure: takes a fully resolved
 * {@link InvoiceOrder} + {@link InvoiceConfig} and returns an HTML string —
 * the route does the data loading and auth.
 */
export function renderInvoiceHtml(
  order: InvoiceOrder,
  config: InvoiceConfig
): string {
  const { currencyCode } = order

  const rows = order.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.title)}</td>
        <td class="num">${escapeHtml(item.quantity)}</td>
        <td class="num">${escapeHtml(formatMoney(item.unitPrice, currencyCode))}</td>
        <td class="num">${escapeHtml(formatMoney(item.lineTotal, currencyCode))}</td>
      </tr>`
    )
    .join("\n      ")

  // VAT is display-only in v1 (Medusa tax is off): computed on goods at render
  // time when enabled, so the document is "VAT-ready" without charging tax.
  const vatAmount = config.vatEnabled
    ? round2(order.itemsSubtotal * config.vatRate)
    : 0
  const grandTotal = round2(order.itemsSubtotal + order.deliveryFee + vatAmount)

  const vatPercentLabel = `${round2(config.vatRate * 100)}%`
  const vatRow = config.vatEnabled
    ? `<tr>
        <td colspan="3" class="label">VAT (${escapeHtml(vatPercentLabel)})</td>
        <td class="num">${escapeHtml(formatMoney(vatAmount, currencyCode))}</td>
      </tr>`
    : ""

  const tinLine =
    config.vatEnabled && config.tin
      ? `<div class="tin">TIN: ${escapeHtml(config.tin)}</div>`
      : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Invoice #${escapeHtml(order.displayId)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111111; margin: 0; padding: 24px; }
    .invoice { max-width: 720px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #707072; margin: 0 0 8px; }
    .meta { text-align: right; font-size: 13px; color: #707072; }
    .meta strong { color: #111111; }
    .tin { font-size: 13px; margin-top: 4px; }
    .party { margin-bottom: 24px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 8px 0; border-bottom: 1px solid #cacacb; text-align: left; }
    th.num, td.num { text-align: right; }
    tfoot td { border-bottom: none; padding: 4px 0; }
    tfoot td.label { text-align: right; color: #707072; }
    tfoot tr.total td { font-weight: bold; font-size: 16px; border-top: 1px solid #111111; padding-top: 8px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="invoice">
    <header>
      <div>
        <h1>${escapeHtml(config.businessName)}</h1>
        <div>Invoice</div>
        ${tinLine}
      </div>
      <div class="meta">
        <div><strong>Invoice #${escapeHtml(order.displayId)}</strong></div>
        <div>${escapeHtml(formatDate(order.createdAt))}</div>
      </div>
    </header>
    ${renderContact(order.contact)}
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="num">Qty</th>
          <th class="num">Unit</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
      ${rows}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="3" class="label">Subtotal</td>
          <td class="num">${escapeHtml(formatMoney(order.itemsSubtotal, currencyCode))}</td>
        </tr>
        <tr>
          <td colspan="3" class="label">Delivery</td>
          <td class="num">${escapeHtml(formatMoney(order.deliveryFee, currencyCode))}</td>
        </tr>
        ${vatRow}
        <tr class="total">
          <td colspan="3" class="label">Total</td>
          <td class="num">${escapeHtml(formatMoney(grandTotal, currencyCode))}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</body>
</html>`
}
