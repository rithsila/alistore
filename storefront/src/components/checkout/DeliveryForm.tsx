"use client"

import type { ChangeEvent } from "react"

/**
 * Delivery information form (FRONTEND-16).
 *
 * Fields: Full Name, Phone (required), Address, Note. Controlled by the parent
 * checkout page via `values` + `onChange` so the page can gate its Place-order
 * CTA on phone validity (`isValidPhone`). Presentational form only — the payment
 * choice, order summary, and submit live on the checkout page (this task's other
 * deliverable). Guest checkout v1 keys on phone, no password (PRD / CLAUDE.md).
 *
 * DESIGN.md documents no checkout field component ("Form field styling … is not
 * present in the captured surfaces — only the search pill is documented"), so
 * fields reuse the `search-pill` treatment from FRONTEND-03's `SearchPill`
 * (soft-cloud fill, ink text, pill radius, ink focus border) rather than
 * inventing a new token or primitive. Single-line fields are pills; the
 * multi-line Address/Note use the same surface at `rounded-large` since a pill
 * radius reads wrong on a tall box.
 *
 * Validation: phone must match the Cambodian format enforced everywhere
 * server-side (security.md `^(\+855|0)[1-9]\d{7,8}$`). The validator is exported
 * so the page and any future server action share one source of truth. The phone
 * value is never logged (security.md: phones never in logs).
 */

const PHONE_PATTERN = /^(\+855|0)[1-9]\d{7,8}$/

/** Cambodian phone validator (security.md). Whitespace is tolerated for entry. */
export function isValidPhone(phone: string): boolean {
  return PHONE_PATTERN.test(phone.replace(/\s+/g, ""))
}

export interface DeliveryDetails {
  fullName: string
  phone: string
  address: string
  note: string
}

export const EMPTY_DELIVERY_DETAILS: DeliveryDetails = {
  fullName: "",
  phone: "",
  address: "",
  note: "",
}

interface DeliveryFormProps {
  values: DeliveryDetails
  onChange: (values: DeliveryDetails) => void
}

const LABEL = "text-base font-medium leading-normal text-ink"
const HELPER = "text-xs font-medium leading-normal text-mute"

const FIELD_BASE =
  "w-full border-2 border-transparent bg-soft-cloud text-base font-normal leading-normal text-ink outline-none placeholder:text-mute focus:border-ink focus:bg-canvas"
const INPUT = `${FIELD_BASE} h-12 rounded-pill px-4`
const TEXTAREA = `${FIELD_BASE} min-h-24 rounded-large px-4 py-3`

export default function DeliveryForm({ values, onChange }: DeliveryFormProps) {
  const update =
    (field: keyof DeliveryDetails) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange({ ...values, [field]: event.target.value })

  // Surface the format hint as an error only once the customer has typed
  // something invalid; an empty required field is conveyed by the disabled
  // Place-order CTA on the page, not a red-flagged input.
  const phoneTouchedInvalid =
    values.phone.length > 0 && !isValidPhone(values.phone)

  return (
    <form
      className="flex flex-col gap-6"
      // Submission is owned by the checkout page's Place-order CTA.
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="delivery-full-name" className={LABEL}>
          Full name
        </label>
        <input
          id="delivery-full-name"
          name="fullName"
          type="text"
          autoComplete="name"
          className={INPUT}
          value={values.fullName}
          onChange={update("fullName")}
          placeholder="Your name"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="delivery-phone" className={LABEL}>
          Phone <span className="text-mute">(required)</span>
        </label>
        <input
          id="delivery-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          aria-required="true"
          aria-invalid={phoneTouchedInvalid}
          aria-describedby="delivery-phone-help"
          className={INPUT}
          value={values.phone}
          onChange={update("phone")}
          placeholder="012 345 678"
        />
        <p id="delivery-phone-help" className={HELPER}>
          {phoneTouchedInvalid
            ? "Enter a valid Cambodian number, e.g. 012 345 678 or +855 12 345 678."
            : "Cambodian number — e.g. 012 345 678 or +855 12 345 678."}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="delivery-address" className={LABEL}>
          Address
        </label>
        <textarea
          id="delivery-address"
          name="address"
          autoComplete="street-address"
          className={TEXTAREA}
          value={values.address}
          onChange={update("address")}
          placeholder="Delivery address"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="delivery-note" className={LABEL}>
          Note <span className="text-mute">(optional)</span>
        </label>
        <textarea
          id="delivery-note"
          name="note"
          className={TEXTAREA}
          value={values.note}
          onChange={update("note")}
          placeholder="Delivery instructions, landmark, preferred time…"
        />
      </div>
    </form>
  )
}
