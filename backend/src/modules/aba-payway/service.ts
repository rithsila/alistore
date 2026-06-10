/**
 * ABA PayWay payment provider — PAYWAY-02.
 *
 * Replaces Bakong as the active KHQR provider (ImplementPlan Phase 6, locked
 * 2026-06-10): same customer UX (QR + deeplink + poll), but the QR comes from
 * PayWay's Purchase API (`payment_option=abapay_khqr_deeplink`) and "paid" is
 * confirmed via PayWay's check-transaction-2 — both direct HTTPS calls, no
 * in-Cambodia proxy.
 *
 * Security invariants (security.md "Payments"):
 *  - `authorizePayment` returns "captured" ONLY after a live server-side
 *    check-transaction-2 confirms APPROVED (`payment_status_code === 0`);
 *  - it never throws on verify failure — the session stays pending and the
 *    next status poll retries, so "paid" is never fabricated;
 *  - the minted `tran_id` (≤20 chars — PayWay's limit; Medusa ids don't fit)
 *    is the idempotency/verification key;
 *  - api key, hash inputs, QR strings, and response bodies are never logged.
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
import {
  checkTransaction,
  createKhqrPurchase,
  mintTranId,
  payWayConfigFromEnv,
  type PayWayCurrency,
} from "./lib/client"

/** Provider config supplied from `medusa-config.ts` (no secrets hardcoded). */
export interface PayWayProviderOptions {
  /** Payment lifetime in minutes — pinned to the stock-reservation TTL. */
  expiresInMinutes: number
}

interface InjectedDependencies extends Record<string, unknown> {
  logger: Logger
}

/** Shape the start route passes through `createPaymentSessionsWorkflow` data. */
interface PayWaySessionInput {
  paywayAmount?: number
  paywayCurrency?: PayWayCurrency
  paywayItems?: { name: string; quantity: number; price: number }[]
}

class PayWayProviderService extends AbstractPaymentProvider<PayWayProviderOptions> {
  static identifier = "payway"

  protected readonly options_: PayWayProviderOptions
  protected readonly logger_: Logger

  constructor(container: InjectedDependencies, options: PayWayProviderOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
  }

  /**
   * Create the PayWay KHQR purchase for the payment session. Unlike Bakong
   * (local QR build) this requires one outbound PayWay call; failures surface
   * as MedusaError so the start route can map them to 502.
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as PayWaySessionInput

    const config = payWayConfigFromEnv()
    if (!config) {
      // Conditional registration should prevent this; fail closed regardless.
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "PayWay is not configured"
      )
    }

    const currency = this.resolveCurrency(input, data)
    const amount = this.formatAmount(this.resolveAmount(input, data), currency)
    const tranId = mintTranId()
    const expiresInMinutes = this.options_.expiresInMinutes
    const expiresAt = new Date(
      Date.now() + expiresInMinutes * 60_000
    ).toISOString()

    const purchase = await createKhqrPurchase(config, {
      tranId,
      amount,
      currency,
      lifetimeMinutes: expiresInMinutes,
      items: data.paywayItems,
      pushbackUrl: process.env.PAYWAY_PUSHBACK_URL || undefined,
    })

    // The minted tran_id doubles as the provider session id — it is the
    // check-transaction key (PAYWAY-03B) and the storefront `reference`.
    return {
      id: tranId,
      data: {
        qr: purchase.qrString,
        deeplink: purchase.deeplink,
        checkout_qr_url: purchase.checkoutQrUrl,
        tran_id: tranId,
        expires_at: expiresAt,
        amount,
        currency,
        status: "pending",
      },
    }
  }

  /** Status as recorded on the session; live verification is authorize/poll. */
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const status =
      (input.data?.status as GetPaymentStatusOutput["status"]) ?? "pending"
    return { status, data: input.data }
  }

  /**
   * The security-critical gate: authorized/captured ONLY after a live
   * check-transaction-2 confirms APPROVED. Called by `completeCartWorkflow` —
   * the status/pushback routes only trigger completion after their own verify,
   * so this second independent confirmation normally agrees. On any failure
   * the session stays pending and completion is retried by the next poll.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const tranId = typeof data.tran_id === "string" ? data.tran_id : undefined

    const verified = await this.verifyPaid(tranId)
    if (!verified) {
      return { status: "pending", data: input.data }
    }
    return {
      status: "captured",
      data: { ...data, status: "captured" },
    }
  }

  /**
   * Server-side verify. Returns false (never throws) when it cannot confirm —
   * unconfigured env or transient PayWay failure — so authorization stays
   * pending and "paid" is never fabricated.
   */
  private async verifyPaid(tranId?: string): Promise<boolean> {
    if (!tranId) {
      return false
    }
    const config = payWayConfigFromEnv()
    if (!config) {
      return false // not configured — cannot confirm
    }
    try {
      const result = await checkTransaction(config, tranId)
      return result.paid
    } catch {
      // PayWay unavailable / SSRF-blocked: stay pending, retry next poll.
      // No sensitive context (tran_id/credentials/body) is logged.
      this.logger_.warn("[payway] payment verify was inconclusive")
      return false
    }
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
      "PayWay refunds are handled manually in v1"
    )
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return input.data ?? {}
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Amount/cart changes start a fresh purchase via a new initiate; nothing
    // to mutate in place here.
    return { data: input.data }
  }

  /**
   * PayWay's pushback (PAYWAY-04) is handled by a dedicated store route that
   * re-verifies via check-transaction-2 — the unsigned payload itself never
   * drives a state change, so the generic webhook entry point stays inert.
   */
  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }

  private resolveCurrency(
    input: InitiatePaymentInput,
    data: PayWaySessionInput
  ): PayWayCurrency {
    if (data.paywayCurrency === "USD" || data.paywayCurrency === "KHR") {
      return data.paywayCurrency
    }
    const code = input.currency_code?.toUpperCase()
    if (code === "USD" || code === "KHR") {
      return code
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PayWay KHQR supports only USD or KHR"
    )
  }

  private resolveAmount(
    input: InitiatePaymentInput,
    data: PayWaySessionInput
  ): number {
    const raw =
      typeof data.paywayAmount === "number"
        ? data.paywayAmount
        : Number(input.amount)
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayWay amount must be a positive number"
      )
    }
    return raw
  }

  /**
   * The EXACT amount string sent to (and hashed by) PayWay: USD with two
   * decimals, KHR as whole riel (no decimals — business rule).
   */
  private formatAmount(amount: number, currency: PayWayCurrency): string {
    return currency === "KHR"
      ? String(Math.round(amount))
      : amount.toFixed(2)
  }
}

export default PayWayProviderService
