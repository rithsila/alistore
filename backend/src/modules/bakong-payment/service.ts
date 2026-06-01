/**
 * Bakong KHQR payment provider — BACKEND-03.
 *
 * A custom Medusa Payment Module provider (PRD §4: "Bakong via custom payment
 * provider"). At session start it generates a dynamic individual KHQR locally
 * (vendored `lib/khqr.ts` — no `bakong-khqr` package, no network) and stores
 * the QR + md5 reference + expiry on the payment session's `data`.
 *
 * Scope note: this task (BACKEND-03) implements `initiatePayment` (QR
 * generation) only. Server-side payment verification — polling Bakong by
 * md5/reference via the proxy, flipping the session to authorized/captured,
 * and writing `stock_movement(out)` — is BACKEND-03B. Until then the other
 * lifecycle methods intentionally keep the session unauthorized (never report
 * "paid" without a server verify — security.md "Payments").
 */

import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/types"
import { buildKhqr, type KhqrCurrency } from "./lib/khqr"
import { checkTransactionByMd5 } from "./lib/proxy"

/** Provider config supplied from `medusa-config.ts` (no secrets hardcoded). */
export interface BakongProviderOptions {
  /** Bakong account id for tag 29-00, e.g. `name@bank` (BAKONG_ACCOUNT). */
  bakongAccount: string
  /** Merchant name shown in banking apps (tag 59). */
  merchantName: string
  /** Merchant city (tag 60). */
  merchantCity: string
  /** QR lifetime in minutes (KHQR expiry; aligns with reservation TTL). */
  expiresInMinutes: number
}

interface InjectedDependencies extends Record<string, unknown> {
  logger: Logger
}

/** Shape the start route passes through `createPaymentSessionsWorkflow` data. */
interface KhqrSessionInput {
  khqrAmount?: number
  khqrCurrency?: KhqrCurrency
  billNumber?: string
}

const SANDBOX_PLACEHOLDER_ACCOUNT = "sandbox@dev"

class BakongProviderService extends AbstractPaymentProvider<BakongProviderOptions> {
  static identifier = "bakong"

  protected readonly options_: BakongProviderOptions
  protected readonly logger_: Logger

  constructor(
    container: InjectedDependencies,
    options: BakongProviderOptions
  ) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
  }

  /**
   * Generate a dynamic KHQR for the payment session. Pure + local: no Bakong
   * call. The deeplink (the only outbound Bakong call in "start") is fetched
   * by the route after the session exists, so it can map proxy failure → 502.
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as KhqrSessionInput

    const currency = this.resolveCurrency(input, data)
    const amount = this.resolveAmount(input, data)
    const billNumber = data.billNumber ?? this.fallbackBillNumber(input)

    const khqr = buildKhqr({
      bakongAccount: this.options_.bakongAccount || SANDBOX_PLACEHOLDER_ACCOUNT,
      merchantName: this.options_.merchantName,
      merchantCity: this.options_.merchantCity,
      amount,
      currency,
      billNumber,
      expiresInMinutes: this.options_.expiresInMinutes,
    })

    // The md5 reference doubles as the provider session id (it is the Bakong
    // status-check key used in BACKEND-03B). Sensitive — never logged.
    return {
      id: khqr.reference,
      data: {
        qr: khqr.qr,
        reference: khqr.reference,
        bill_number: khqr.billNumber,
        expires_at: khqr.expiresAt,
        amount,
        currency,
        status: "pending",
      },
    }
  }

  /**
   * Payment status. Real verification (poll Bakong by md5 via the proxy) is
   * BACKEND-03B; until then the session stays `pending` — we never report a
   * payment as captured without a server-side verify.
   */
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const status =
      (input.data?.status as GetPaymentStatusOutput["status"]) ?? "pending"
    return { status, data: input.data }
  }

  /**
   * Authorize the payment (BACKEND-03B). This is the security-critical gate:
   * the session becomes authorized ONLY after a server-side Bakong verify by
   * the QR's md5 reference through the in-Cambodia proxy — never on a
   * client-reported status (security.md "Payments"). Returning "captured"
   * lets the Payment Module create and capture the payment in one step, so the
   * resulting order is fully paid.
   *
   * Medusa's `completeCartWorkflow` calls this at the end of cart completion;
   * the storefront only triggers completion after `/khqr/status` has already
   * confirmed payment, so the live verify here normally agrees. If it cannot
   * confirm (sandbox without a proxy, or a transient proxy failure) the session
   * stays "pending" and completion is retried on the next status poll.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const reference =
      typeof data.reference === "string" ? data.reference : undefined

    const verified = await this.verifyPaidViaProxy(reference)
    if (!verified) {
      return { status: "pending", data: input.data }
    }
    return {
      status: "captured",
      data: { ...data, status: "captured" },
    }
  }

  /**
   * Server-side verify of a KHQR payment by its md5 reference via the proxy.
   * Returns false (never throws) when it cannot confirm — sandbox/no proxy
   * configured, or a transient proxy error — so authorization simply stays
   * pending and is retried, and "paid" is never fabricated.
   */
  private async verifyPaidViaProxy(reference?: string): Promise<boolean> {
    if (!reference) {
      return false
    }
    const proxyBaseUrl = process.env.BAKONG_PROXY_URL
    const token = process.env.BAKONG_TOKEN
    if (!proxyBaseUrl || !token) {
      return false // sandbox / not configured — cannot confirm
    }
    try {
      return await checkTransactionByMd5({
        proxyBaseUrl,
        token,
        reference,
        allowedHosts: this.proxyAllowedHosts(),
      })
    } catch {
      // Proxy unavailable / SSRF-blocked: stay pending, retry next poll.
      // No sensitive context (reference/token/body) is logged.
      this.logger_.warn("[bakong] payment verify via proxy was inconclusive")
      return false
    }
  }

  /** Allowlisted Bakong proxy hosts (security.md SSRF), from env. */
  private proxyAllowedHosts(): string[] | undefined {
    const raw = process.env.BAKONG_PROXY_ALLOWED_HOSTS
    if (!raw) {
      return undefined
    }
    const hosts = raw
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
    return hosts.length > 0 ? hosts : undefined
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  async cancelPayment(input: CancelPaymentInput): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async deletePayment(input: DeletePaymentInput): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  /** Refunds are out of scope for v1 (returns/refunds are manual — PRD §10). */
  async refundPayment(
    _input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Bakong refunds are handled manually in v1"
    )
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return input.data ?? {}
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Amount/cart changes regenerate the QR via a fresh initiate; nothing to
    // mutate in place here.
    return { data: input.data }
  }

  /** Bakong confirmation is poll-based (BACKEND-03B), not webhook-driven. */
  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }

  private resolveCurrency(
    input: InitiatePaymentInput,
    data: KhqrSessionInput
  ): KhqrCurrency {
    if (data.khqrCurrency === "USD" || data.khqrCurrency === "KHR") {
      return data.khqrCurrency
    }
    const code = input.currency_code?.toUpperCase()
    if (code === "USD" || code === "KHR") {
      return code
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "KHQR supports only USD or KHR"
    )
  }

  private resolveAmount(
    input: InitiatePaymentInput,
    data: KhqrSessionInput
  ): number {
    const raw =
      typeof data.khqrAmount === "number"
        ? data.khqrAmount
        : Number(input.amount)
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "KHQR amount must be a positive number"
      )
    }
    return raw
  }

  private fallbackBillNumber(input: InitiatePaymentInput): string {
    const sessionId = (input.data?.session_id as string) ?? ""
    return sessionId.slice(0, 25) || `ALI${Date.now()}`
  }
}

export default BakongProviderService
