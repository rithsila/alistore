/**
 * Minimal ABA PayWay client — Node 20+, zero dependencies.
 *
 * Implements the two endpoints needed for the alistore checkout flow:
 *   - Purchase (create transaction):  POST /api/payment-gateway/v1/payments/purchase
 *   - Check Transaction v2:           POST /api/payment-gateway/v1/payments/check-transaction-2
 *
 * Hash spec (verified against developer.payway.com.kh and seanghay/payway-js):
 *   base64( HMAC-SHA512( concatenated-fields, api_key ) )
 *
 * Purchase hash field order (24 fields; absent optional fields contribute ""):
 *   req_time, merchant_id, tran_id, amount, items, shipping, firstname,
 *   lastname, email, phone, type, payment_option, return_url, cancel_url,
 *   continue_success_url, return_deeplink, currency, custom_fields,
 *   return_params, payout, lifetime, additional_params, google_pay_token,
 *   skip_success_page
 *   (view_type and payment_gate are posted but NEVER hashed)
 *
 * Check-transaction hash field order:
 *   req_time, merchant_id, tran_id
 */
import { createHmac } from "node:crypto";

export const PURCHASE_HASH_ORDER = [
  "req_time",
  "merchant_id",
  "tran_id",
  "amount",
  "items",
  "shipping",
  "firstname",
  "lastname",
  "email",
  "phone",
  "type",
  "payment_option",
  "return_url",
  "cancel_url",
  "continue_success_url",
  "return_deeplink",
  "currency",
  "custom_fields",
  "return_params",
  "payout",
  "lifetime",
  "additional_params",
  "google_pay_token",
  "skip_success_page",
];

/** UTC timestamp in PayWay's YYYYMMDDHHmmss format. */
export function reqTime(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    date.getUTCFullYear().toString() +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds())
  );
}

export function hmacBase64(data, apiKey) {
  return createHmac("sha512", apiKey).update(data).digest("base64");
}

/** Concatenate purchase fields in canonical order; missing fields = "". */
export function purchaseHashInput(fields) {
  return PURCHASE_HASH_ORDER.map((k) => fields[k] ?? "").join("");
}

export function purchaseHash(fields, apiKey) {
  return hmacBase64(purchaseHashInput(fields), apiKey);
}

export function checkTransactionHash({ req_time, merchant_id, tran_id }, apiKey) {
  return hmacBase64(`${req_time}${merchant_id}${tran_id}`, apiKey);
}

/** Base64-encode an items array per PayWay spec: [{name, quantity, price}] */
export function encodeItems(items) {
  return Buffer.from(JSON.stringify(items), "utf8").toString("base64");
}

export class PayWayClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl    e.g. https://checkout-sandbox.payway.com.kh
   * @param {string} opts.merchantId
   * @param {string} opts.apiKey
   */
  constructor({ baseUrl, merchantId, apiKey }) {
    if (!baseUrl || !merchantId || !apiKey) {
      throw new Error("PayWayClient requires baseUrl, merchantId and apiKey");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.merchantId = merchantId;
    this.apiKey = apiKey;
  }

  /**
   * Create a purchase. All values must be strings — the hash is computed over
   * the exact strings sent, so never hash a Number and send a String.
   *
   * @param {object} params - tran_id, amount required; everything else optional
   * @returns {Promise<object>} parsed JSON (or { html } for hosted_view pages)
   */
  async purchase(params) {
    const fields = {
      req_time: reqTime(),
      merchant_id: this.merchantId,
      ...stringifyValues(params),
    };
    fields.hash = purchaseHash(fields, this.apiKey);

    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v !== "" && v !== undefined && v !== null) form.append(k, v);
    }

    const res = await fetch(`${this.baseUrl}/api/payment-gateway/v1/payments/purchase`, {
      method: "POST",
      body: form,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // hosted_view responses are an HTML checkout page, not JSON
      return { html: text, http_status: res.status };
    }
  }

  /** Server-side verification — the ONLY source of truth for "paid". */
  async checkTransaction(tranId) {
    const body = {
      req_time: reqTime(),
      merchant_id: this.merchantId,
      tran_id: tranId,
    };
    body.hash = checkTransactionHash(body, this.apiKey);

    const res = await fetch(
      `${this.baseUrl}/api/payment-gateway/v1/payments/check-transaction-2`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return res.json();
  }
}

function stringifyValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}
