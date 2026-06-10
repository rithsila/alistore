/**
 * KHPAY payment provider — KHPAY-01.
 *
 * Replaces direct ABA PayWay as the active KHQR provider (ImplementPlan
 * Phase 7, locked 2026-06-10 — ABA declined the direct PayWay merchant
 * application pending a business license; KHPAY's Bakong rail settles to our
 * own Bakong account instead). Same customer UX (in-store QR + 3s poll): the
 * EMV KHQR string comes from KHPAY's `POST /bakong/generate` and "paid" is
 * confirmed via `POST /bakong/check` — both direct HTTPS calls, polling only
 * (no webhook).
 *
 * Security invariants (security.md "Payments"):
 *  - `authorizePayment` returns "captured" ONLY after a live server-side
 *    /bakong/check confirms paid;
 *  - it never throws on verify failure — the session stays pending and the
 *    next status poll retries, so "paid" is never fabricated;
 *  - the KHPAY `transaction_id` (`bk_…`) is the idempotency/verification key;
 *  - the api key, QR strings, and response bodies are never logged.
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
  checkBakongPayment,
  generateBakongQr,
  khpayConfigFromEnv,
  KHPAY_REFERENCE_PATTERN,
  type KhpayCurrency,
} from "./lib/client"

/** Display-only note shown in the payer's banking app. No PII (security.md). */
const PAYMENT_NOTE = "Ali Store"

/** Provider config supplied from `medusa-config.ts` (no secrets hardcoded). */
export interface KhpayProviderOptions {
  /** Payment lifetime in minutes — pinned to the stock-reservation TTL. */
  expiresInMinutes: number
}

interface InjectedDependencies extends Record<string, unknown> {
  logger: Logger
}

/** Shape the start route passes through `createPaymentSessionsWorkflow` data. */
interface KhpaySessionInput {
  khpayAmount?: number
  khpayCurrency?: KhpayCurrency
}

class KhpayProviderService extends AbstractPaymentProvider<KhpayProviderOptions> {
  static identifier = "khpay"

  protected readonly options_: KhpayProviderOptions
  protected readonly logger_: Logger

  constructor(container: InjectedDependencies, options: KhpayProviderOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
  }

  /**
   * Create the KHPAY Bakong KHQR for the payment session. Like PayWay (and
   * unlike the local Bakong QR build) this requires one outbound call;
   * failures surface as MedusaError so the start route can map them to 502.
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const data = (input.data ?? {}) as KhpaySessionInput

    const config = khpayConfigFromEnv()
    if (!config) {
      // Conditional registration should prevent this; fail closed regardless.
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "KHPAY is not configured"
      )
    }

    const currency = this.resolveCurrency(input, data)
    const amount = this.normalizeAmount(this.resolveAmount(input, data), currency)
    const expiresInMinutes = this.options_.expiresInMinutes
    // KHPAY returns its own `expires_at` in a non-ISO, timezone-ambiguous
    // format — OUR window (pinned to the reservation TTL) governs the UX and
    // the lifecycle plumbing; /bakong/check stays the source of truth for paid.
    const expiresAt = new Date(
      Date.now() + expiresInMinutes * 60_000
    ).toISOString()

    const generated = await generateBakongQr(config, {
      amount,
      currency,
      note: PAYMENT_NOTE,
    })

    // The KHPAY transaction_id doubles as the provider session id — it is the
    // /bakong/check key (KHPAY-03) and the storefront `reference`.
    return {
      id: generated.transactionId,
      data: {
        qr: generated.qr,
        transaction_id: generated.transactionId,
        md5: generated.md5,
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
   * /bakong/check confirms paid. Called by `completeCartWorkflow` — the status
   * route only triggers completion after its own verify, so this second
   * independent confirmation normally agrees. On any failure the session stays
   * pending and completion is retried by the next poll.
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const data = (input.data ?? {}) as Record<string, unknown>
    const transactionId =
      typeof data.transaction_id === "string" ? data.transaction_id : undefined

    const verified = await this.verifyPaid(transactionId)
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
   * unconfigured env or transient KHPAY failure — so authorization stays
   * pending and "paid" is never fabricated.
   */
  private async verifyPaid(transactionId?: string): Promise<boolean> {
    if (!transactionId || !KHPAY_REFERENCE_PATTERN.test(transactionId)) {
      return false
    }
    const config = khpayConfigFromEnv()
    if (!config) {
      return false // not configured — cannot confirm
    }
    try {
      const result = await checkBakongPayment(config, transactionId)
      return result.paid
    } catch {
      // KHPAY unavailable / SSRF-blocked: stay pending, retry next poll.
      // No sensitive context (transaction_id/key/body) is logged.
      this.logger_.warn("[khpay] payment verify was inconclusive")
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
      "KHPAY refunds are handled manually in v1"
    )
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return input.data ?? {}
  }

  async updatePayment(input: UpdatePaymentInput): Promise<UpdatePaymentOutput> {
    // Amount/cart changes start a fresh QR via a new initiate; nothing to
    // mutate in place here.
    return { data: input.data }
  }

  /**
   * Confirmation is polling-only (locked decision): no webhook is configured
   * with KHPAY, so the generic webhook entry point stays inert. If a webhook
   * is ever added it must re-verify via /bakong/check — the signed payload
   * alone must never drive a state change.
   */
  async getWebhookActionAndData(
    _payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }

  private resolveCurrency(
    input: InitiatePaymentInput,
    data: KhpaySessionInput
  ): KhpayCurrency {
    if (data.khpayCurrency === "USD" || data.khpayCurrency === "KHR") {
      return data.khpayCurrency
    }
    const code = input.currency_code?.toUpperCase()
    if (code === "USD" || code === "KHR") {
      return code
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "KHPAY Bakong KHQR supports only USD or KHR"
    )
  }

  private resolveAmount(
    input: InitiatePaymentInput,
    data: KhpaySessionInput
  ): number {
    const raw =
      typeof data.khpayAmount === "number"
        ? data.khpayAmount
        : Number(input.amount)
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "KHPAY amount must be a positive number"
      )
    }
    return raw
  }

  /**
   * The EXACT amount number sent to KHPAY: USD with two decimals, KHR as whole
   * riel (no decimals — business rule).
   */
  private normalizeAmount(amount: number, currency: KhpayCurrency): number {
    return currency === "KHR"
      ? Math.round(amount)
      : Math.round(amount * 100) / 100
  }
}

export default KhpayProviderService
