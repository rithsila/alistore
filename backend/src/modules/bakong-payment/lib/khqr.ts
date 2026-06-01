/**
 * Vendored KHQR (Cambodia Bakong) QR generation — BACKEND-03.
 *
 * Per `.claude/rules/security.md`: we MUST NOT depend on the `bakong-khqr`
 * npm package. The EMVCo Merchant-Presented-Mode (MPM) + NBC KHQR profile
 * logic is vendored here instead, cross-checked against the EMVCo MPM spec
 * and the `bakong-khqr` reference implementation (tag 29 = individual account,
 * tag 99 = KHQR timestamp, CRC-16/CCITT-FALSE, md5(qr) = status reference).
 *
 * This module is PURE: it builds a QR string and derives the md5 reference
 * locally — no network I/O, no Bakong call. The only outbound Bakong call in
 * the "start" flow is the deeplink lookup (see `proxy.ts`).
 *
 * SECURITY: the returned `qr` string and `reference` (md5) are sensitive and
 * MUST NOT be logged (security.md "treat `reference` as sensitive").
 */

import { createHash } from "crypto"

/** EMVCo numeric currency codes for the two currencies v1 supports. */
const CURRENCY_CODE = {
  USD: "840",
  KHR: "116",
} as const

export type KhqrCurrency = keyof typeof CURRENCY_CODE

/** EMVCo top-level tag IDs used for an individual dynamic KHQR. */
const TAG = {
  PAYLOAD_FORMAT: "00",
  POINT_OF_INITIATION: "01",
  INDIVIDUAL_ACCOUNT: "29",
  MERCHANT_CATEGORY_CODE: "52",
  TRANSACTION_CURRENCY: "53",
  TRANSACTION_AMOUNT: "54",
  COUNTRY_CODE: "58",
  MERCHANT_NAME: "59",
  MERCHANT_CITY: "60",
  ADDITIONAL_DATA: "62",
  TIMESTAMP: "99",
  CRC: "63",
} as const

/** Sub-tag under the individual-account template (29). */
const ACCOUNT_SUBTAG_ID = "00"
/** Sub-tag under additional-data (62): bill number / reference. */
const ADDITIONAL_BILL_NUMBER = "01"
/** Sub-tags under the KHQR timestamp template (99). */
const TIMESTAMP_CREATION = "00"
const TIMESTAMP_EXPIRATION = "01"

const PAYLOAD_FORMAT_VALUE = "01"
const POINT_OF_INITIATION_DYNAMIC = "12"
const DEFAULT_MCC = "5999"
const COUNTRY_KH = "KH"

/** EMVCo field-length caps we defensively enforce before encoding. */
const MAX = {
  ACCOUNT: 32,
  MERCHANT_NAME: 25,
  MERCHANT_CITY: 15,
  BILL_NUMBER: 25,
} as const

/**
 * Encode one EMVCo TLV field: `ID(2) + LENGTH(2, zero-padded) + VALUE`.
 * LENGTH is the character count of VALUE only.
 */
function tlv(id: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`KHQR field ${id} exceeds 99 chars`)
  }
  const len = value.length.toString().padStart(2, "0")
  return `${id}${len}${value}`
}

/**
 * CRC-16/CCITT-FALSE — poly 0x1021, init 0xFFFF, no reflection, xorout 0x0000.
 * Computed over UTF-8 bytes of the payload INCLUDING the trailing "6304"
 * tag+length prefix. Returns 4 uppercase hex chars.
 */
function crc16(data: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(data, "utf8")) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0")
}

/**
 * Format the transaction amount for tag 54. USD keeps up to 2 decimals with
 * trailing zeros/dot stripped (e.g. 10.50 → "10.5", 10 → "10"); KHR is whole
 * riel (the caller is responsible for passing an already-rounded integer).
 */
function formatAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("KHQR amount must be a positive number")
  }
  return amount
    .toFixed(2)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
}

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

export interface BuildKhqrInput {
  /** Bakong account id for tag 29-00, e.g. `name@bank` (BAKONG_ACCOUNT). */
  bakongAccount: string
  /** Merchant name (tag 59). */
  merchantName: string
  /** Merchant city (tag 60). */
  merchantCity: string
  /** Amount in the transaction currency (USD dollars or whole KHR riel). */
  amount: number
  /** Transaction currency. */
  currency: KhqrCurrency
  /** Bill/reference number embedded in tag 62-01 for reconciliation. */
  billNumber: string
  /** Creation time (epoch ms). Defaults to now; injectable for tests. */
  createdAtMs?: number
  /** QR lifetime in minutes (tag 99-01 expiration). */
  expiresInMinutes: number
}

export interface BuiltKhqr {
  /** Full EMVCo QR string including CRC — render as a QR code. SENSITIVE. */
  qr: string
  /** md5(qr) hex — the idempotency/status-check reference. SENSITIVE. */
  reference: string
  /** Bill number embedded in the QR (tag 62-01). */
  billNumber: string
  /** ISO timestamp when the QR expires. */
  expiresAt: string
}

/**
 * Build an individual dynamic KHQR string and derive its md5 reference.
 * Deterministic given its inputs (including `createdAtMs`).
 */
export function buildKhqr(input: BuildKhqrInput): BuiltKhqr {
  const account = clamp(input.bakongAccount, MAX.ACCOUNT)
  const merchantName = clamp(input.merchantName, MAX.MERCHANT_NAME)
  const merchantCity = clamp(input.merchantCity, MAX.MERCHANT_CITY)
  const billNumber = clamp(input.billNumber, MAX.BILL_NUMBER)

  const createdAtMs = input.createdAtMs ?? Date.now()
  const expiresAtMs = createdAtMs + input.expiresInMinutes * 60 * 1000

  const accountTemplate = tlv(
    TAG.INDIVIDUAL_ACCOUNT,
    tlv(ACCOUNT_SUBTAG_ID, account)
  )

  const additionalData = tlv(
    TAG.ADDITIONAL_DATA,
    tlv(ADDITIONAL_BILL_NUMBER, billNumber)
  )

  const timestamp = tlv(
    TAG.TIMESTAMP,
    tlv(TIMESTAMP_CREATION, String(createdAtMs)) +
      tlv(TIMESTAMP_EXPIRATION, String(expiresAtMs))
  )

  const payload =
    tlv(TAG.PAYLOAD_FORMAT, PAYLOAD_FORMAT_VALUE) +
    tlv(TAG.POINT_OF_INITIATION, POINT_OF_INITIATION_DYNAMIC) +
    accountTemplate +
    tlv(TAG.MERCHANT_CATEGORY_CODE, DEFAULT_MCC) +
    tlv(TAG.TRANSACTION_CURRENCY, CURRENCY_CODE[input.currency]) +
    tlv(TAG.TRANSACTION_AMOUNT, formatAmount(input.amount)) +
    tlv(TAG.COUNTRY_CODE, COUNTRY_KH) +
    tlv(TAG.MERCHANT_NAME, merchantName) +
    tlv(TAG.MERCHANT_CITY, merchantCity) +
    additionalData +
    timestamp

  // CRC is computed over the payload plus the literal CRC tag+length ("6304").
  const crcSeed = `${payload}${TAG.CRC}04`
  const qr = `${crcSeed}${crc16(crcSeed)}`

  const reference = createHash("md5").update(qr, "utf8").digest("hex")

  return {
    qr,
    reference,
    billNumber,
    expiresAt: new Date(expiresAtMs).toISOString(),
  }
}
